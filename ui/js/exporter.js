// Exportdialog: PNG / JPG / WebP / PDF (vektor eller raster) / SVG.
// PDF kan innehålla alla sidor; bilder blir en fil per sida; SVG är en sida.
import { state, pageView, allElements } from './state.js';
import { fitElements } from './actions.js';
import { SIZE_PRESETS } from './leftpanel.js';
import { h, canvasToBlob, round, deepClone } from './util.js';
import { modal, toast } from './dialogs.js';
import { renderDoc, drawBackground } from './render.js';
import { buildSVG, rasterSVG } from './svgexport.js';
import { ensureAllImages } from './images.js';
import { ensureDocFonts } from './fonts.js';
import { isTauri, invoke, saveBlob, saveBlobs } from './bridge.js';
import { finishTextEdit, finishCrop } from './editor.js';

let last = { format: 'png', scale: 1, quality: 92, transparent: false, bleed: 3, marks: true, raster: false, pages: 'all', multi: false, sizes: [] };
try { Object.assign(last, JSON.parse(localStorage.getItem('motiv.export') || '{}')); } catch { /* ignore */ }

const MAX_SIDE = 16000;
const safeName = () => (state.fileName || 'design').replace(/\.(motiv|ediholio)$/i, '').replace(/[\\/:*?"<>|]+/g, '_');

// Format man kan exportera till på en gång (sociala medier och skärm, i pixlar)
const MULTI_SIZES = SIZE_PRESETS.flatMap(([, items]) => items).filter(([, , , u]) => u === 'px')
  .filter(([name], i, all) => all.findIndex(([n]) => n === name) === i);
const fileSafe = (s) => s.replace(/[åä]/gi, 'a').replace(/ö/gi, 'o').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');

/**
 * En sida omgjord till ett annat format: innehållet skalas proportionellt och
 * centreras, bakgrunden fyller hela ytan. Originalet ändras inte.
 */
export function resizedView(page, w, h) {
  const d = state.doc;
  const p = d.pages[page];
  const elements = deepClone(p.elements);
  fitElements(elements, d.width, d.height, w, h, true);
  return { width: w, height: h, dpi: 72, assets: d.assets, elements, background: deepClone(p.background) };
}

/** Renderar en sida (ev. med utfall) till en canvas i given skala. */
export async function renderExportCanvas(scale, { transparent = false, bleedPx = 0, background = null, page = state.doc.pageIndex, view = null } = {}) {
  await ensureAllImages();
  await ensureDocFonts(allElements());
  const d = view || pageView(state.doc, page);
  const W = Math.round((d.width + bleedPx * 2) * scale), H = Math.round((d.height + bleedPx * 2) * scale);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, W, H); }
  ctx.scale(scale, scale);
  ctx.translate(bleedPx, bleedPx);
  if (!transparent) drawBackground(ctx, d, scale, bleedPx, { exact: true });
  renderDoc(ctx, d, scale, { transparent: true, exact: true });
  return c;
}

export function openExportDialog() {
  finishTextEdit();
  finishCrop(true);
  const d = state.doc;
  const o = { ...last };
  const n = d.pages.length;

  const fmtSeg = h('div', { class: 'seg wide export-formats' });
  const FORMATS = [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP'], ['pdf', 'PDF'], ['svg', 'SVG']];
  const opts = h('div', { class: 'export-opts' });
  const info = h('div', { class: 'export-info muted small' });

  const multiInfo = () => {
    const pages = n > 1 && o.pages === 'all' ? n : 1;
    const k = o.sizes.length * pages;
    if (!k) return 'Välj minst ett format';
    return `${k} ${k === 1 ? 'fil' : 'filer'} (${o.sizes.length} format${pages > 1 ? ` × ${pages} sidor` : ''})`;
  };

  const render = () => {
    fmtSeg.innerHTML = '';
    FORMATS.forEach(([k, l]) => fmtSeg.append(h('button', { class: o.format === k ? 'active' : '', onclick: () => { o.format = k; render(); } }, l)));
    opts.innerHTML = '';
    const raster = ['png', 'jpg', 'webp'].includes(o.format);
    // Vilka sidor (bara när det finns fler än en, och inte för SVG)
    if (n > 1 && o.format !== 'svg') {
      const pageSel = h('div', { class: 'seg wide' },
        [['all', `Alla sidor (${n})`], ['current', `Den här sidan (${d.pageIndex + 1})`]].map(([k, l]) => h('button', { class: o.pages === k ? 'active' : '', onclick: () => { o.pages = k; render(); } }, l)));
      opts.append(h('div', { class: 'field' }, h('span', null, 'Sidor'), pageSel));
    }
    const many = n > 1 && o.pages === 'all';
    if (raster) {
      // Designens storlek (med skala) eller flera färdiga format på en gång
      const modeSel = h('div', { class: 'seg wide' },
        [[false, 'Designens storlek'], [true, 'Flera format']].map(([k, l]) => h('button', { class: o.multi === k ? 'active' : '', onclick: () => { o.multi = k; render(); } }, l)));
      opts.append(h('div', { class: 'field' }, h('span', null, 'Storlek'), modeSel));
      if (!o.multi) {
        const scaleSel = h('div', { class: 'seg wide' }, [0.5, 1, 2, 3, 4].map((s) => h('button', { class: o.scale === s ? 'active' : '', onclick: () => { o.scale = s; render(); } }, `${s}×`)));
        opts.append(scaleSel);
      } else {
        const list = h('div', { class: 'size-checks' }, MULTI_SIZES.map(([name, w, hh]) => {
          const cb = h('input', { type: 'checkbox', checked: o.sizes.includes(name), onchange: () => { o.sizes = cb.checked ? [...o.sizes, name] : o.sizes.filter((x) => x !== name); info.textContent = multiInfo(); } });
          return h('label', { class: 'check' }, cb, h('span', null, name), h('span', { class: 'muted small' }, `${w}×${hh}`));
        }));
        opts.append(list, h('p', { class: 'muted small' }, 'Innehållet skalas och centreras i varje format; bakgrunden fyller hela bilden.'));
      }
      if (o.format !== 'png') {
        const q = h('input', { type: 'range', min: 40, max: 100, value: o.quality, class: 'range' });
        const qv = h('span', null, `${o.quality}%`);
        q.addEventListener('input', () => { o.quality = +q.value; qv.textContent = `${o.quality}%`; });
        opts.append(h('div', { class: 'slider-row' }, h('div', { class: 'slider-head' }, h('span', null, 'Kvalitet'), qv), q));
      }
      if (o.format !== 'jpg') {
        const t = h('input', { type: 'checkbox', checked: o.transparent, onchange: () => { o.transparent = t.checked; } });
        opts.append(h('label', { class: 'check' }, t, 'Genomskinlig bakgrund'));
      }
      const W = Math.round(d.width * o.scale), H = Math.round(d.height * o.scale);
      if (o.multi) { info.textContent = multiInfo(); return; }
      info.textContent = `${W} × ${H} px` + (many ? ` · ${n} filer (${safeName()}-1 … ${safeName()}-${n})` : '') + (W > MAX_SIDE || H > MAX_SIDE ? ' – för stort, minska storleken' : '');
    } else if (o.format === 'pdf') {
      const bleed = h('input', { class: 'num-input', type: 'number', min: 0, max: 20, step: 0.5, value: o.bleed });
      bleed.addEventListener('change', () => { o.bleed = Math.max(0, +bleed.value || 0); });
      const marks = h('input', { type: 'checkbox', checked: o.marks, onchange: () => { o.marks = marks.checked; } });
      const rast = h('input', { type: 'checkbox', checked: o.raster, onchange: () => { o.raster = rast.checked; } });
      opts.append(
        h('label', { class: 'field' }, h('span', null, 'Utfall (mm)'), bleed),
        h('label', { class: 'check' }, marks, 'Skärmärken'),
        h('label', { class: 'check' }, rast, 'Rastrera allt (exakt utseende, ingen vektortext)'),
        h('p', { class: 'muted small' }, 'Vektor-PDF behåller text och former skarpa i alla storlekar. Utfallet fylls med bakgrunden och element som sticker ut över kanten.'),
      );
      const mm = (px) => round((px / d.dpi) * 25.4, 1);
      info.textContent = `${mm(d.width)} × ${mm(d.height)} mm (${d.dpi} dpi)` + (many ? ` · ${n} sidor i en fil` : '');
      if (!isTauri) info.textContent += ' – PDF kräver skrivbordsappen';
    } else {
      opts.append(h('p', { class: 'muted small' }, 'SVG kan öppnas och redigeras vidare i t.ex. Inkscape, Illustrator eller Figma. Bilder och filtereffekter bäddas in. Egna och nedladdade fonter bäddas in.'));
      info.textContent = `${d.width} × ${d.height}` + (n > 1 ? ` · sida ${d.pageIndex + 1} (SVG rymmer en sida)` : '');
    }
  };
  render();

  modal({
    title: 'Exportera',
    width: 460,
    body: h('div', null, fmtSeg, opts, info),
    actions: [
      { label: 'Avbryt' },
      {
        label: 'Exportera', primary: true, onClick: async (btn) => {
          btn.textContent = 'Exporterar…';
          last = { ...o };
          try { localStorage.setItem('motiv.export', JSON.stringify(last)); } catch { /* ignore */ }
          await doExport(o, (txt) => { btn.textContent = txt; });
          return true;
        },
      },
    ],
  });
}

async function doExport(o, progress) {
  const d = state.doc;
  const name = safeName();
  const list = d.pages.length > 1 && o.pages === 'all' && o.format !== 'svg' ? d.pages.map((_, i) => i) : [d.pageIndex];
  const step = (i) => { if (list.length > 1) progress(`Sida ${i + 1} av ${list.length}…`); };
  if (['png', 'jpg', 'webp'].includes(o.format)) {
    let scale = o.scale;
    const maxS = Math.min(MAX_SIDE / d.width, MAX_SIDE / d.height);
    if (scale > maxS) { scale = maxS; toast('Storleken begränsades till max 16000 px', 'info'); }
    const transparent = o.transparent && o.format !== 'jpg';
    const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[o.format];
    const ext = o.format;
    const filters = [{ name: ext.toUpperCase(), extensions: [ext] }];
    const blobs = [];
    if (o.multi) {
      // Flera format: en fil per format (och sida), t.ex. Design-Instagram-inlagg.png
      const sizes = MULTI_SIZES.filter(([nm]) => o.sizes.includes(nm));
      if (!sizes.length) throw new Error('Välj minst ett format');
      const suffixes = [];
      for (const page of list) {
        for (const [nm, w, hh] of sizes) {
          progress(`${nm}${list.length > 1 ? ` (sida ${page + 1})` : ''}…`);
          const c = await renderExportCanvas(1, { transparent, background: o.format === 'jpg' ? '#ffffff' : null, view: resizedView(page, w, hh) });
          blobs.push(await canvasToBlob(c, mime, o.format === 'png' ? undefined : o.quality / 100));
          suffixes.push(`${fileSafe(nm)}${list.length > 1 ? `-sida${page + 1}` : ''}`);
        }
      }
      const saved = await saveBlobs(blobs, `${name}.${ext}`, filters, suffixes);
      if (saved) toast(`${saved} bilder sparade i ${sizes.length} format`, 'ok');
      return;
    }
    for (const [k, page] of list.entries()) {
      step(k);
      const c = await renderExportCanvas(scale, { transparent, background: o.format === 'jpg' ? '#ffffff' : null, page });
      blobs.push(await canvasToBlob(c, mime, o.format === 'png' ? undefined : o.quality / 100));
    }
    if (blobs.length > 1) {
      const saved = await saveBlobs(blobs, `${name}.${ext}`, filters);
      if (saved) toast(`${saved} bilder sparade (${name}-1 … ${name}-${saved})`, 'ok');
    } else {
      const path = await saveBlob(blobs[0], `${name}.${ext}`, filters);
      if (path) toast(`Sparad: ${path.split(/[\/]/).pop()}`, 'ok');
    }
  } else if (o.format === 'svg') {
    const svg = await buildSVG(pageView(d, d.pageIndex), { embedFonts: true, imgScale: 1 });
    const path = await saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`, [{ name: 'SVG', extensions: ['svg'] }]);
    if (path) toast(`Sparad: ${path.split(/[\/]/).pop()}`, 'ok');
  } else if (o.format === 'pdf') {
    if (!isTauri) throw new Error('PDF-export kräver skrivbordsappen');
    const path = await invoke('save_file_dialog', { defaultName: `${name}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!path) return;
    const bleedPx = (o.bleed / 25.4) * d.dpi;
    await ensureDocFonts(allElements());
    const svgs = [];
    for (const [k, page] of list.entries()) {
      step(k);
      const pv = pageView(d, page);
      if (o.raster) {
        const c = await renderExportCanvas(1, { bleedPx, page });
        svgs.push(rasterSVG(c.toDataURL('image/jpeg', 0.95), pv, { bleedMm: o.bleed, cropMarks: o.marks }));
      } else {
        svgs.push(await buildSVG(pv, { forPdf: true, bleedMm: o.bleed, cropMarks: o.marks, imgScale: 1 }));
      }
    }
    progress('Skapar PDF…');
    await invoke('export_pdf', { path, svgs });
    toast(`PDF sparad: ${path.split(/[\/]/).pop()}` + (svgs.length > 1 ? ` (${svgs.length} sidor)` : ''), 'ok');
  }
}
