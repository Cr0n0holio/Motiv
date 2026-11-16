// Massproduktion: skapar en sida per rad i en lista (CSV, Excel eller
// inklistrat), med den aktuella sidan som mall. Texter, QR-koder och bilder
// kopplas till kolumner; i texter kan man också skriva {Kolumnnamn} där
// värdet ska stå, t.ex. "Hej {Namn}!".
import { state, pageView, reId } from './state.js';
import { h, deepClone, uid, loadImage, mimeFromExt } from './util.js';
import { icon } from './controls.js';
import { modal, toast } from './dialogs.js';
import { layoutText, syncTextBox, isCurved } from './text.js';
import { replaceText } from './richtext.js';
import { renderToCanvas } from './render.js';
import { ensureImage, coverCrop } from './images.js';
import { addAsset, prepareUpload } from './actions.js';
import { insertPages, currentPage } from './pages.js';
import { isTauri, invoke, pickTableFile } from './bridge.js';
import { parseDelimited, parseTableFile } from './tabledata.js';

export const MAX_ROWS = 500;
const MIN_SHRINK = 0.5; // text krymps som mest till halva storleken

// ---------- Kärnan (utan gränssnitt, testas i verktyg/tester.js) ----------

const walk = (els, fn) => els.forEach((e) => { fn(e); if (e.type === 'group') walk(e.children, fn); });
const norm = (s) => String(s).trim().toLocaleLowerCase('sv-SE');

/** Fält på sidan som kan kopplas till en kolumn: [{ id, type, label }]. */
export function pageFields(elements) {
  const out = [];
  walk(elements, (e) => {
    if (e.type === 'text') out.push({ id: e.id, type: 'text', label: e.text.replace(/\s+/g, ' ').slice(0, 40) || 'Tom text' });
    else if (e.type === 'qr') out.push({ id: e.id, type: 'qr', label: 'QR-kod' });
    else if (e.type === 'image') out.push({ id: e.id, type: 'image', label: e.assetId ? e.name || 'Bild' : 'Fotoram' });
  });
  return out;
}

/** Kolumner som används som {platshållare} i en text. */
export function placeholdersIn(text, headers) {
  const names = headers.map(norm);
  return [...String(text).matchAll(/\{([^{}\n]+)\}/g)].map((m) => names.indexOf(norm(m[1]))).filter((i) => i >= 0);
}

/** Förslag på koppling: en text som heter som en kolumn kopplas till den. */
export function guessMapping(elements, headers) {
  const names = headers.map(norm), map = {};
  walk(elements, (e) => {
    if (e.type !== 'text') return;
    const i = names.indexOf(norm(e.text));
    if (i >= 0) map[e.id] = i;
  });
  return map;
}

/** Byter {Kolumn} mot radens värden; formatering på delar av texten följer med. */
function fillPlaceholders(el, headers, row) {
  const names = headers.map(norm);
  let from = 0;
  for (;;) {
    const m = /\{([^{}\n]+)\}/.exec(el.text.slice(from));
    if (!m) return;
    const at = from + m.index, i = names.indexOf(norm(m[1]));
    if (i < 0) { from = at + m[0].length; continue; }
    const value = row[i] ?? '';
    replaceText(el, el.text.slice(0, at) + value + el.text.slice(at + m[0].length), at + value.length);
    from = at + value.length;
  }
}

/** Krymper texten tills den tar lika många rader som i mallen. Returnerar false om det inte räckte. */
function fitText(el, lines0, h0) {
  const fits = () => { const L = layoutText(el); return L.lines.length <= lines0 && L.h <= h0 + 0.5; };
  const size0 = el.fontSize;
  while (!fits() && el.fontSize > size0 * MIN_SHRINK) el.fontSize = Math.max(size0 * MIN_SHRINK, el.fontSize * 0.96);
  return fits();
}

/**
 * En kopia av sidan med radens värden. mapping: { elementId: kolumnindex };
 * images: { sökväg: { assetId, w, h } } för bildkolumner.
 * Returnerar { page, warnings: [text] }.
 */
export function fillPage(page, headers, row, mapping, { shrink = true, images = {} } = {}) {
  const elements = deepClone(page.elements);
  const warnings = [];
  walk(elements, (el) => {
    const col = mapping[el.id];
    const value = col >= 0 ? (row[col] ?? '') : null;
    if (el.type === 'text') {
      const before = isCurved(el) ? null : layoutText(el);
      if (value !== null) { el.text = value; delete el.runs; } else if (placeholdersIn(el.text, headers).length) fillPlaceholders(el, headers, row); else return;
      if (before && shrink && !fitText(el, before.lines.length, before.h)) warnings.push(`"${el.text.slice(0, 30)}" får inte plats`);
      else if (before && !shrink && layoutText(el).lines.length > before.lines.length) warnings.push(`"${el.text.slice(0, 30)}" tar fler rader än i mallen`);
      syncTextBox(el, 'center');
    } else if (el.type === 'qr') {
      if (value !== null) el.text = value; else if (placeholdersIn(el.text, headers).length) fillPlaceholders(el, headers, row);
    } else if (el.type === 'image' && value !== null && value !== '') {
      const img = images[value];
      if (!img) { warnings.push(`Bilden "${value.slice(-40)}" hittades inte`); return; }
      el.assetId = img.assetId;
      el.maskAssetId = null;
      el.crop = coverCrop(img.w, img.h, el.w, el.h);
    }
  });
  return { page: { id: uid('p'), background: deepClone(page.background), elements: elements.map(reId) }, warnings };
}

// ---------- Bilder från en kolumn med filnamn (skrivbordsappen) ----------

const isAbsolute = (p) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p);
const dirOf = (p) => (p ? p.replace(/[\\/][^\\/]*$/, '') : '');

/** Läser in bildfilerna som raderna pekar på. Returnerar { sökväg: { assetId, w, h } }. */
async function loadImages(values, baseDir, cache) {
  for (const v of new Set(values.filter(Boolean))) {
    if (v in cache) continue;
    cache[v] = null;
    try {
      const f = await invoke('read_binary_file', { path: isAbsolute(v) || !baseDir ? v : `${baseDir}/${v}` });
      const dataURL = await prepareUpload(`data:${mimeFromExt(f.name)};base64,${f.data}`);
      const img = await loadImage(dataURL);
      const assetId = await addAsset(dataURL);
      await ensureImage(assetId);
      cache[v] = { assetId, w: img.naturalWidth, h: img.naturalHeight };
    } catch { /* saknad eller oläslig fil ger en varning på raden */ }
  }
  return cache;
}

// ---------- Guiden ----------

let last = null; // senaste listan, så att man kan köra om utan att läsa in igen

export function openBulkDialog() {
  const tpl = state.doc.pages[currentPage()];
  const fields = pageFields(tpl.elements);
  if (!fields.length) { toast('Sidan har inga texter, QR-koder eller bilder att fylla i. Bygg först en mall, t.ex. en namnskylt.', 'info', { timeout: 6000 }); return; }

  let raw = last?.raw || [];       // alla rader, inkl. rubrikraden
  let baseDir = last?.baseDir || '';
  let hasHeader = last?.hasHeader ?? true;
  let mapping = {};
  let rowIdx = 0;
  const imageCache = {};
  const headers = () => (hasHeader && raw.length ? raw[0].map((c, i) => c || `Kolumn ${i + 1}`) : (raw[0] || []).map((_, i) => `Kolumn ${i + 1}`));
  const rows = () => (hasHeader ? raw.slice(1) : raw).slice(0, MAX_ROWS);
  const total = () => (hasHeader ? raw.length - 1 : raw.length);
  const imageCols = () => fields.filter((f) => f.type === 'image' && mapping[f.id] >= 0).map((f) => mapping[f.id]);

  // Steg 1: data
  const status = h('div', { class: 'bulk-status muted small' });
  const paste = h('textarea', { class: 'bulk-paste', placeholder: 'Klistra in rader från Excel eller Google Kalkylark här (Ctrl+V)', spellcheck: false });
  paste.addEventListener('keydown', (e) => e.stopPropagation());
  paste.addEventListener('input', () => { if (paste.value.trim()) setData(parseDelimited(paste.value), ''); });
  const headerChk = h('input', { type: 'checkbox', checked: hasHeader });
  headerChk.addEventListener('change', () => { hasHeader = headerChk.checked; mapping = guessMapping(tpl.elements, headers()); refresh(); });
  const openBtn = h('button', { class: 'btn', onclick: async () => {
    try {
      const f = await pickTableFile();
      if (!f) return;
      paste.value = '';
      setData(await parseTableFile(f.name, f.bytes), dirOf(f.path));
    } catch (e) { toast(String(e.message || e), 'error', { timeout: 7000 }); }
  } }, icon('upload'), 'Öppna CSV eller Excel…');

  // Steg 2: koppling
  const mapBox = h('div', { class: 'bulk-map' });
  // Steg 3: val
  const shrinkChk = h('input', { type: 'checkbox', checked: true });
  shrinkChk.addEventListener('change', () => preview());
  const replaceChk = h('input', { type: 'checkbox', checked: true });

  // Förhandsvisning
  const canvasBox = h('div', { class: 'bulk-canvas' });
  const rowLabel = h('span', { class: 'muted small' });
  const warnBox = h('div', { class: 'bulk-warn small' });
  const step = (d) => { rowIdx = Math.max(0, Math.min(rows().length - 1, rowIdx + d)); preview(); };
  const nav = h('div', { class: 'bulk-nav' },
    h('button', { class: 'icon-btn', title: 'Föregående rad', onclick: () => step(-1) }, '‹'), rowLabel,
    h('button', { class: 'icon-btn', title: 'Nästa rad', onclick: () => step(1) }, '›'));

  const opts = () => ({ shrink: shrinkChk.checked, images: imageCache });
  let previewRun = 0;
  async function preview() {
    const run = ++previewRun;
    const rs = rows();
    const row = rs[rowIdx] || null;
    rowLabel.textContent = rs.length ? `Rad ${rowIdx + 1} av ${rs.length}` : 'Mallen';
    if (row && isTauri) await loadImages(imageCols().map((c) => row[c]), baseDir, imageCache);
    if (run !== previewRun) return;
    const r = row ? fillPage(tpl, headers(), row, mapping, opts()) : { page: tpl, warnings: [] };
    const v = { ...pageView(state.doc, currentPage()), elements: r.page.elements, background: r.page.background };
    const c = renderToCanvas(v, 420 / Math.max(v.width, v.height), { background: '#ffffff', placeholders: true });
    canvasBox.innerHTML = '';
    canvasBox.append(c);
    warnBox.textContent = r.warnings.length ? `⚠ ${r.warnings.join(' · ')}` : '';
  }

  function refresh() {
    const hs = headers(), n = rows().length;
    status.textContent = raw.length
      ? `${total()} rader och ${hs.length} kolumner: ${hs.slice(0, 6).join(', ')}${hs.length > 6 ? ' …' : ''}${total() > MAX_ROWS ? ` – bara de första ${MAX_ROWS} används` : ''}`
      : 'Ingen lista inläst än.';
    mapBox.innerHTML = '';
    if (raw.length) {
      mapBox.append(...fields.map((f) => {
        const used = f.type !== 'image' ? placeholdersIn(findText(tpl.elements, f.id), hs) : [];
        const sel = h('select', { class: 'select' },
          h('option', { value: -1 }, used.length ? `Platshållare i texten (${used.map((i) => hs[i]).join(', ')})` : '— ändra inte —'),
          hs.map((name, i) => h('option', { value: i }, name)));
        sel.value = mapping[f.id] ?? -1;
        sel.disabled = f.type === 'image' && !isTauri;
        sel.addEventListener('change', () => { if (+sel.value >= 0) mapping[f.id] = +sel.value; else delete mapping[f.id]; preview(); });
        return h('label', { class: 'bulk-row' },
          h('span', { class: 'bulk-field', title: f.label }, h('b', null, f.type === 'text' ? 'Text' : f.type === 'qr' ? 'QR-kod' : 'Bild'), ` ${f.type === 'text' ? f.label : ''}`),
          sel);
      }));
      if (fields.some((f) => f.type === 'image')) {
        mapBox.append(h('div', { class: 'sub-label' }, isTauri
          ? 'Bilder: kolumnen ska innehålla filnamn eller sökvägar. Filnamn utan mapp söks i samma mapp som listan.'
          : 'Bilder från en kolumn fungerar bara i skrivbordsappen.'));
      }
    }
    rowIdx = Math.min(rowIdx, Math.max(0, n - 1));
    if (createBtn) { createBtn.disabled = !n; createBtn.textContent = n ? `Skapa ${n} ${n === 1 ? 'sida' : 'sidor'}` : 'Skapa sidor'; }
    preview();
  }

  function setData(data, dir) {
    raw = data;
    baseDir = dir;
    mapping = guessMapping(tpl.elements, headers());
    rowIdx = 0;
    refresh();
  }

  async function create() {
    const hs = headers(), rs = rows();
    if (!rs.length) return false;
    if (isTauri) await loadImages(rs.flatMap((r) => imageCols().map((c) => r[c])), baseDir, imageCache);
    const pages = [];
    let warned = 0;
    for (const row of rs) {
      const r = fillPage(tpl, hs, row, mapping, opts());
      pages.push(r.page);
      if (r.warnings.length) warned++;
    }
    last = { raw, baseDir, hasHeader };
    insertPages(currentPage(), pages, { replace: replaceChk.checked });
    toast(`Skapade ${pages.length} sidor${warned ? ` – ${warned} har text eller bild som behöver ses över` : ''}. Ångra med Ctrl+Z.`, warned ? 'info' : 'ok', { timeout: 7000 });
    return true;
  }

  const m = modal({
    title: 'Skapa sidor från en lista',
    width: 900,
    body: h('div', { class: 'bulk' },
      h('div', { class: 'bulk-left' },
        h('h4', null, '1. Lista'),
        h('p', { class: 'muted small' }, 'Varje rad i listan blir en sida som ser ut som den här sidan.'),
        openBtn, paste,
        h('label', { class: 'check' }, headerChk, 'Första raden är rubriker'),
        status,
        h('h4', null, '2. Koppla kolumner'),
        h('p', { class: 'muted small' }, 'Välj kolumn för varje del, eller skriv {Kolumnnamn} direkt i en text i mallen.'),
        mapBox,
        h('h4', null, '3. Skapa'),
        h('label', { class: 'check' }, shrinkChk, 'Krymp text som inte får plats'),
        h('label', { class: 'check' }, replaceChk, 'Ersätt mallsidan med de nya sidorna')),
      h('div', { class: 'bulk-right' }, canvasBox, nav, warnBox)),
    actions: [{ label: 'Avbryt' }, { label: 'Skapa sidor', primary: true, onClick: async () => (await create()) }],
  });
  const createBtn = m.el.querySelector('.modal-foot .btn.primary');
  mapping = raw.length ? guessMapping(tpl.elements, headers()) : {};
  refresh();
}

function findText(elements, id) {
  let t = '';
  walk(elements, (e) => { if (e.id === id) t = e.text || ''; });
  return t;
}
