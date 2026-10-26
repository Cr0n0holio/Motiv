// Vänster sidopanel: format & mallar, text, element, bilder, bakgrund, lager.
import { state, on, emit, commit, select, createText, createShape, newDoc, loadDoc, elementLabel, markDirty } from './state.js';
import { h, round, deepClone, debounce } from './util.js';
import { icon } from './controls.js';
import * as A from './actions.js';
import { shapeD } from './shapes.js';
import { paintCss, GRADIENT_PRESETS } from './paint.js';
import { drawText, layoutText, syncTextBox } from './text.js';
import { ensureFamily, ensureDocFonts } from './fonts.js';
import { renderElementThumb } from './render.js';
import { pickImages } from './bridge.js';
import { toast, confirmDialog } from './dialogs.js';
import { openColorPicker } from './colorpicker.js';
import { createImage } from './state.js';

const TABS = [
  ['format', 'layout', 'Format'],
  ['text', 'text', 'Text'],
  ['elements', 'shapes', 'Element'],
  ['uploads', 'upload', 'Bilder'],
  ['background', 'palette', 'Bakgrund'],
  ['layers', 'layers', 'Lager'],
];

let rail, panel, current = null;
const builders = {};

export function initLeftPanel(railEl, panelEl) {
  rail = railEl; panel = panelEl;
  for (const [k, ic, label] of TABS) {
    const b = h('button', { class: 'rail-btn', 'data-k': k, onclick: () => openTab(k === current && !panel.classList.contains('collapsed') ? null : k) }, icon(ic), h('span', null, label));
    rail.append(b);
  }
  on('open-tab', (k) => openTab(k));
  on('assets', () => { if (current === 'uploads' || current === 'background') openTab(current, true); });
  const refreshLayers = debounce(() => { if (current === 'layers') builders.layers(true); }, 120);
  on('doc', refreshLayers);
  on('selection', () => { if (current === 'layers') builders.layers(true); });
  on('fonts', () => { if (current === 'text') drawPresetCanvases(); });
  openTab('text');
}

export function openTab(k, force = false) {
  if (!k) { panel.classList.add('collapsed'); rail.querySelectorAll('.rail-btn').forEach((b) => b.classList.remove('active')); emit('layout'); return; }
  if (k === current && !panel.classList.contains('collapsed') && !force) return;
  current = k;
  panel.classList.remove('collapsed');
  rail.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.k === k));
  panel.innerHTML = '';
  builders[k]();
  emit('layout');
}

const head = (title, sub) => h('div', { class: 'lp-head' }, h('h3', null, title), sub ? h('p', { class: 'muted small' }, sub) : null);

// ---------------- Format & mallar ----------------
export const SIZE_PRESETS = [
  ['Tryck', [
    ['A4 stående', 210, 297, 'mm'], ['A4 liggande', 297, 210, 'mm'], ['A3 stående', 297, 420, 'mm'], ['A5 stående', 148, 210, 'mm'],
    ['Affisch 50×70 cm', 500, 700, 'mm'], ['Affisch 30×40 cm', 300, 400, 'mm'], ['Affisch 70×100 cm', 700, 1000, 'mm'], ['Vykort 10×15 cm', 148, 105, 'mm'],
  ]],
  ['Sociala medier', [
    ['Instagram-inlägg', 1080, 1080, 'px'], ['Instagram porträtt', 1080, 1350, 'px'], ['Story / Reels', 1080, 1920, 'px'],
    ['Facebook-omslag', 1640, 624, 'px'], ['YouTube-miniatyr', 1280, 720, 'px'], ['LinkedIn-banner', 1584, 396, 'px'],
  ]],
  ['Skärm', [
    ['Full HD 1920×1080', 1920, 1080, 'px'], ['4K 3840×2160', 3840, 2160, 'px'], ['Mobilbakgrund', 1170, 2532, 'px'], ['Presentation 16:9', 1920, 1080, 'px'],
  ]],
];

function toPx(v, unit, dpi) { return unit === 'mm' ? (v / 25.4) * dpi : unit === 'cm' ? (v / 2.54) * dpi : unit === 'in' ? v * dpi : v; }

builders.format = () => {
  const d = state.doc;
  let unit = 'px';
  const wIn = h('input', { class: 'num-input', value: d.width });
  const hIn = h('input', { class: 'num-input', value: d.height });
  const dpiIn = h('input', { class: 'num-input', value: d.dpi });
  const unitSel = h('select', { class: 'select' }, ['px', 'mm', 'cm', 'in'].map((u) => h('option', { value: u }, u)));
  const scaleChk = h('input', { type: 'checkbox', checked: true });
  unitSel.addEventListener('change', () => {
    const dpi = +dpiIn.value || 300;
    const wPx = toPx(+wIn.value, unit, dpi), hPx = toPx(+hIn.value, unit, dpi);
    unit = unitSel.value;
    const from = (px) => (unit === 'mm' ? (px / dpi) * 25.4 : unit === 'cm' ? (px / dpi) * 2.54 : unit === 'in' ? px / dpi : px);
    wIn.value = round(from(wPx), unit === 'px' ? 0 : 1); hIn.value = round(from(hPx), unit === 'px' ? 0 : 1);
  });
  const applyCustom = () => {
    const dpi = Math.max(36, +dpiIn.value || 300);
    A.resizeDocument(toPx(+wIn.value, unit, dpi), toPx(+hIn.value, unit, dpi), dpi, scaleChk.checked);
    toast('Storleken är ändrad', 'ok');
  };
  const applyPreset = (w, hh, u) => {
    const dpi = u === 'mm' ? 300 : 72;
    A.resizeDocument(toPx(w, u, dpi), toPx(hh, u, dpi), dpi, scaleChk.checked);
    openTab('format', true);
  };

  const useTemplate = async (t) => {
    if (state.doc.elements.length && !(await confirmDialog('Använd mall', 'Mallen ersätter din nuvarande design. Fortsätta?', { ok: 'Använd mall' }))) return;
    const doc = t.build();
    loadDoc(doc, { fileName: t.name, filePath: null });
    await ensureDocFonts(doc.elements);
    A.relayoutAllText();
    emit('doc');
  };

  panel.append(
    head('Format & mallar'),
    ...TEMPLATE_CATS.map((cat) => h('div', { class: 'lp-section' },
      h('h4', null, cat),
      h('div', { class: 'tpl-grid' }, TEMPLATES.filter((t) => t.cat === cat).map((t) => h('button', { class: 'tpl', title: `${t.name} – ${t.fmt}`, onclick: () => useTemplate(t) },
        templateThumb(t),
        h('span', { class: 'tpl-name' }, t.name),
        h('span', { class: 'tpl-fmt muted small' }, t.fmt)))),
    )),
    h('div', { class: 'lp-section' },
      h('h4', null, 'Egen storlek'),
      h('div', { class: 'grid3' },
        h('label', { class: 'field' }, h('span', null, 'Bredd'), wIn),
        h('label', { class: 'field' }, h('span', null, 'Höjd'), hIn),
        h('label', { class: 'field' }, h('span', null, 'Enhet'), unitSel),
      ),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, 'Upplösning (dpi)'), dpiIn),
        h('button', { class: 'btn', title: 'Byt plats på bredd och höjd', onclick: () => { const t = wIn.value; wIn.value = hIn.value; hIn.value = t; } }, '⇄ Vrid'),
      ),
      h('label', { class: 'check' }, scaleChk, 'Skala innehållet'),
      h('button', { class: 'btn primary full', onclick: applyCustom }, 'Ändra storlek'),
    ),
    ...SIZE_PRESETS.map(([group, items]) => h('div', { class: 'lp-section' },
      h('h4', null, group),
      h('div', { class: 'size-list' }, items.map(([name, w, hh, u]) => h('button', { class: 'size-item', onclick: () => applyPreset(w, hh, u) },
        h('span', { class: 'size-icon', style: { width: `${Math.round(22 * Math.min(1, w / hh))}px`, height: `${Math.round(22 * Math.min(1, hh / w))}px` } }),
        h('span', { class: 'size-name' }, name),
        h('span', { class: 'muted small' }, u === 'mm' ? `${w}×${hh} mm` : `${w}×${hh}`)))),
    )),
  );
};

// ---------------- Text ----------------
export const TEXT_PRESETS = [
  { name: 'Neon', o: { text: 'NEON', fontFamily: 'Righteous', fontWeight: 400, fill: { type: 'solid', color: '#fff7fe' }, glow: { enabled: true, color: '#ff2bd6', blur: 0.35 }, letterSpacing: 80 } },
  { name: 'Kontur', o: { text: 'KONTUR', fontFamily: 'Anton', fontWeight: 400, fill: { type: 'none' }, stroke: { enabled: true, color: '#111111', width: 0.03 }, letterSpacing: 40 } },
  { name: 'Retro', o: { text: 'Retro', fontFamily: 'Alfa Slab One', fontWeight: 400, fill: { type: 'solid', color: '#ff7a1a' }, shadow: { enabled: true, color: '#3b1f78', blur: 0, x: 0.06, y: 0.06 } } },
  { name: 'Guld', o: { text: 'Guld', fontFamily: 'Cinzel', fontWeight: 700, fill: { type: 'linear', angle: 180, stops: [{ offset: 0, color: '#fff3b0' }, { offset: 0.5, color: '#d4af37' }, { offset: 1, color: '#8a6a12' }] }, shadow: { enabled: true, color: '#00000066', blur: 0.1, x: 0, y: 0.04 } } },
  { name: 'Elegant', o: { text: 'Elegant', fontFamily: 'Playfair Display', fontWeight: 400, italic: true, fill: { type: 'solid', color: '#1d1d24' } } },
  { name: 'Handskrift', o: { text: 'Hej då!', fontFamily: 'Pacifico', fontWeight: 400, fill: { type: 'solid', color: '#e11d48' } } },
  { name: 'Etikett', o: { text: 'NYHET', fontFamily: 'Bebas Neue', fontWeight: 400, fill: { type: 'solid', color: '#111111' }, background: { enabled: true, color: '#ffd166', padding: 0.3, radius: 0.15 }, letterSpacing: 60 } },
  { name: 'Pop', o: { text: 'POW!', fontFamily: 'Bangers', fontWeight: 400, fill: { type: 'solid', color: '#ffe14d' }, stroke: { enabled: true, color: '#111111', width: 0.045 }, shadow: { enabled: true, color: '#111111', blur: 0, x: 0.05, y: 0.06 }, letterSpacing: 30 } },
  { name: 'Båge', o: { text: 'I EN BÅGE', fontFamily: 'Montserrat', fontWeight: 800, letterSpacing: 120, curve: { mode: 'arc', amount: 45 }, fill: { type: 'solid', color: '#7c3aed' } } },
  { name: 'Våg', o: { text: 'vågig text', fontFamily: 'Fredoka', fontWeight: 600, curve: { mode: 'wave', amount: 60 }, fill: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#06b6d4' }, { offset: 1, color: '#8b5cf6' }] } } },
  { name: 'Skugga', o: { text: 'Mjuk skugga', fontFamily: 'Poppins', fontWeight: 700, fill: { type: 'solid', color: '#ffffff' }, shadow: { enabled: true, color: '#00000088', blur: 0.25, x: 0, y: 0.06 } } },
  { name: 'Graffiti', o: { text: 'Graffiti', fontFamily: 'Permanent Marker', fontWeight: 400, fill: { type: 'linear', angle: 120, stops: [{ offset: 0, color: '#22d3ee' }, { offset: 0.5, color: '#a855f7' }, { offset: 1, color: '#f43f5e' }] }, stroke: { enabled: true, color: '#0b0b10', width: 0.025 } } },
];

/** Gör om relativa effektmått (andel av fontstorlek) till pixlar. */
function presetToElement(p, fontSize) {
  const o = deepClone(p.o);
  const s = fontSize;
  if (o.glow) o.glow.blur *= s;
  if (o.stroke) o.stroke.width *= s;
  if (o.shadow) { o.shadow.blur *= s; o.shadow.x *= s; o.shadow.y *= s; }
  const el = createText({ ...o, fontSize: s });
  if (el.width < s * 6) el.width = s * 8;
  return el;
}

let presetCanvases = [];
function drawPresetCanvases() {
  for (const { c, p } of presetCanvases) {
    const el = presetToElement(p, 40);
    el.width = 400;
    syncTextBox(el, 'center');
    const L = layoutText(el);
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const pad = 14;
    const contentW = L.curved ? L.w : Math.max(...L.lines.map((l) => l.width), 1);
    const s = Math.min((c.width / dpr - pad * 2) / contentW, (c.height / dpr - pad * 2) / L.h, 1.6);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
    const offX = L.curved ? 0 : (el.align === 'center' ? (L.w - contentW) / 2 : 0);
    ctx.translate((c.width / dpr / s - contentW) / 2 - offX, (c.height / dpr / s - L.h) / 2);
    drawText(ctx, el, dpr * s);
  }
}

builders.text = () => {
  presetCanvases = [];
  const dpr = window.devicePixelRatio || 1;
  panel.append(
    head('Text', 'Dubbelklicka på en text för att redigera den direkt på sidan.'),
    h('div', { class: 'lp-section' },
      h('button', { class: 'add-text big', onclick: () => A.addText('heading') }, 'Lägg till en rubrik'),
      h('button', { class: 'add-text mid', onclick: () => A.addText('subheading') }, 'Lägg till en underrubrik'),
      h('button', { class: 'add-text small', onclick: () => A.addText('body') }, 'Lägg till brödtext'),
    ),
    h('div', { class: 'lp-section' },
      h('h4', null, 'Textstilar'),
      h('div', { class: 'preset-text-grid' }, TEXT_PRESETS.map((p) => {
        const c = h('canvas', { width: Math.round(150 * dpr), height: Math.round(84 * dpr), style: { width: '150px', height: '84px' } });
        presetCanvases.push({ c, p });
        return h('button', {
          class: 'preset-text', title: p.name, onclick: async () => {
            const size = Math.round(Math.min(state.doc.width, state.doc.height) * 0.1);
            const el = presetToElement(p, size);
            el.width = Math.round(state.doc.width * 0.8);
            A.addElement(el);
            await ensureFamily(el.fontFamily);
            syncTextBox(el, 'center');
            emit('doc');
          },
        }, c, h('span', null, p.name));
      })),
    ),
  );
  // Förladda fonterna för stilarna i bakgrunden
  [...new Set(TEXT_PRESETS.map((p) => p.o.fontFamily))].forEach((f) => ensureFamily(f));
  drawPresetCanvases();
};

// ---------------- Element ----------------
const SHAPE_LIST = ['rect', 'rounded', 'ellipse', 'triangle', 'diamond', 'polygon', 'star', 'burst', 'heart', 'arrowShape', 'speech', 'cross', 'halfCircle', 'ring', 'blob', 'parallelogram'];
builders.elements = () => {
  const icon = (k) => {
    if (k === 'line') return '<svg viewBox="0 0 48 48"><path d="M6 24H42" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>';
    if (k === 'arrow') return '<svg viewBox="0 0 48 48"><path d="M6 24H36" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><path d="M44 24L33 17V31Z" fill="currentColor"/></svg>';
    if (k === 'dashed') return '<svg viewBox="0 0 48 48"><path d="M6 24H42" stroke="currentColor" stroke-width="3.5" stroke-dasharray="6 5"/></svg>';
    if (k === 'dotted') return '<svg viewBox="0 0 48 48"><path d="M6 24H42" stroke="currentColor" stroke-width="4" stroke-dasharray="0.01 8" stroke-linecap="round"/></svg>';
    const d = shapeD(k, 36, k === 'arrowShape' ? 22 : k === 'halfCircle' ? 18 : k === 'speech' ? 30 : 36, { radius: k === 'rounded' ? 8 : 0, points: k === 'star' ? 5 : k === 'burst' ? 16 : 6, innerRatio: k === 'ring' ? 0.55 : undefined });
    const oy = k === 'arrowShape' ? 13 : k === 'halfCircle' ? 15 : k === 'speech' ? 9 : 6;
    return `<svg viewBox="0 0 48 48"><path d="${d}" transform="translate(6 ${oy})" fill="currentColor" fill-rule="evenodd"/></svg>`;
  };
  const item = (k, add) => {
    const b = h('button', { class: 'shape-item', title: k, html: icon(k), onclick: add });
    b.draggable = true;
    b.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-motiv-shape', k));
    return b;
  };
  panel.append(
    head('Element', 'Klicka för att lägga till, eller dra ut på sidan.'),
    h('div', { class: 'lp-section' }, h('h4', null, 'Former'), h('div', { class: 'shape-grid' }, SHAPE_LIST.map((k) => item(k, () => A.addShape(k))))),
    h('div', { class: 'lp-section' }, h('h4', null, 'Linjer & pilar'), h('div', { class: 'shape-grid' },
      item('line', () => A.addShape('line')),
      item('arrow', () => A.addShape('arrow')),
      item('dashed', () => A.addShape('line', { dash: 'dashed' })),
      item('dotted', () => A.addShape('line', { dash: 'dotted' })),
    )),
    h('div', { class: 'lp-section' }, h('h4', null, 'Färgklickar'), h('div', { class: 'swatch-grid' }, GRADIENT_PRESETS.slice(0, 8).map((g) => h('button', {
      class: 'big-swatch', style: { background: paintCss(g) }, onclick: () => A.addShape('blob', { fill: deepClone(g) }),
    })))),
  );
};

// ---------------- Bilder ----------------
function imageAssets() {
  const masks = new Set();
  const walk = (els) => els.forEach((e) => { if (e.type === 'image' && e.maskAssetId) masks.add(e.maskAssetId); if (e.type === 'group') walk(e.children); });
  walk(state.doc.elements);
  if (state.doc.background.image?.maskAssetId) masks.add(state.doc.background.image.maskAssetId);
  return Object.entries(state.doc.assets).filter(([id]) => !masks.has(id) && !(state._maskIds || new Set()).has(id));
}

export async function uploadImages() {
  const files = await pickImages();
  for (const f of files) {
    try { await A.addImageFromDataURL(f.dataURL, { name: f.name }); } catch (e) { toast(`${f.name}: ${e.message}`, 'error'); }
  }
}

builders.uploads = () => {
  const grid = h('div', { class: 'asset-grid' });
  for (const [id, url] of imageAssets()) {
    const im = h('img', { src: url, draggable: true, loading: 'lazy' });
    im.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-motiv-asset', id));
    grid.append(h('button', {
      class: 'asset', title: 'Klicka för att lägga till', onclick: async () => {
        await A.addImageFromDataURL(url);
      },
    }, im));
  }
  panel.append(
    head('Bilder'),
    h('div', { class: 'lp-section' },
      h('button', { class: 'btn primary full big', onclick: uploadImages }, icon('upload'), 'Ladda upp bilder'),
      h('div', { class: 'drop-hint' }, 'Du kan också dra in bilder från Utforskaren eller klistra in med Ctrl+V.'),
    ),
    h('div', { class: 'lp-section' }, h('h4', null, 'I den här designen'), grid.children.length ? grid : h('p', { class: 'muted small' }, 'Inga bilder ännu.')),
  );
};

// ---------------- Bakgrund ----------------
const BG_COLORS = ['#ffffff', '#f5f5f4', '#fef3c7', '#fde2e4', '#e0f2fe', '#dcfce7', '#ede9fe', '#111827', '#000000', '#1e3a8a', '#7c2d12', '#14532d', '#831843', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899', '#ef4444'];
builders.background = () => {
  const d = state.doc;
  const setFill = (p) => { d.background.fill = deepClone(p); emit('doc'); commit(); };
  const custom = h('button', { class: 'btn full' }, icon('palette'), 'Egen färg eller gradient…');
  custom.addEventListener('click', () => openColorPicker(custom, { value: d.background.fill, allowGradient: true, allowNone: true, onChange: (v, final) => { d.background.fill = v; markDirty(); emit('render'); if (final) commit(); } }));
  panel.append(
    head('Bakgrund'),
    h('div', { class: 'lp-section' }, h('h4', null, 'Färger'), h('div', { class: 'swatch-grid' }, BG_COLORS.map((c) => h('button', { class: 'big-swatch', style: { background: c }, title: c, onclick: () => setFill({ type: 'solid', color: c }) })),
      h('button', { class: 'big-swatch transparent', title: 'Genomskinlig', onclick: () => setFill({ type: 'none' }) }))),
    h('div', { class: 'lp-section' }, h('h4', null, 'Gradienter'), h('div', { class: 'swatch-grid' }, GRADIENT_PRESETS.map((g) => h('button', { class: 'big-swatch', style: { background: paintCss(g) }, onclick: () => setFill(g) })))),
    h('div', { class: 'lp-section' }, custom),
    h('div', { class: 'lp-section' }, h('h4', null, 'Bild som bakgrund'),
      imageAssets().length ? h('div', { class: 'asset-grid' }, imageAssets().map(([id, url]) => h('button', {
        class: 'asset', title: 'Använd som bakgrund', onclick: () => { d.background.image = { assetId: id, maskAssetId: null, filters: {}, opacity: 1 }; emit('doc'); commit(); },
      }, h('img', { src: url })))) : h('p', { class: 'muted small' }, 'Ladda upp en bild under "Bilder" först.'),
      d.background.image ? h('button', { class: 'btn full danger-ghost', onclick: () => { d.background.image = null; emit('doc'); commit(); openTab('background', true); } }, 'Ta bort bakgrundsbild') : null,
    ),
  );
};

// ---------------- Lager ----------------
builders.layers = (refresh = false) => {
  let list = panel.querySelector('.layer-list');
  if (!refresh || !list) {
    panel.innerHTML = '';
    list = h('div', { class: 'layer-list' });
    panel.append(head('Lager', 'Överst i listan = längst fram. Dra för att ändra ordning.'), list);
  }
  list.innerHTML = '';
  const els = [...state.doc.elements].reverse();
  if (!els.length) list.append(h('p', { class: 'muted small pad' }, 'Inga element ännu.'));
  let dragId = null;
  els.forEach((el) => {
    const thumb = renderElementThumb(el, 36);
    thumb.className = 'layer-thumb';
    const name = h('span', { class: 'layer-name' }, elementLabel(el));
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const inp = h('input', { class: 'layer-rename', value: el.type === 'text' && el.name === 'Text' ? elementLabel(el) : el.name });
      name.replaceWith(inp);
      inp.focus(); inp.select();
      const done = () => { el.name = inp.value.trim() || el.name; commit(); builders.layers(true); };
      inp.addEventListener('blur', done);
      inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') builders.layers(true); });
    });
    const row = h('div', { class: 'layer' + (state.selection.includes(el.id) ? ' active' : '') + (el.visible ? '' : ' hidden-el'), draggable: true },
      thumb, name,
      h('button', { class: 'icon-btn', title: el.locked ? 'Lås upp' : 'Lås', onclick: (e) => { e.stopPropagation(); el.locked = !el.locked; emit('doc'); commit(); } }, icon(el.locked ? 'lock' : 'unlock', el.locked ? 'on' : 'dim')),
      h('button', { class: 'icon-btn', title: el.visible ? 'Dölj' : 'Visa', onclick: (e) => { e.stopPropagation(); el.visible = !el.visible; emit('doc'); commit(); } }, icon(el.visible ? 'eye' : 'eyeOff', el.visible ? 'dim' : 'on')),
    );
    row.addEventListener('click', (e) => {
      if (e.shiftKey || e.ctrlKey) select(state.selection.includes(el.id) ? state.selection.filter((i) => i !== el.id) : [...state.selection, el.id]);
      else select([el.id]);
    });
    row.addEventListener('dragstart', (e) => { dragId = el.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', el.id); row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      const r = row.getBoundingClientRect();
      row.classList.toggle('drop-above', e.clientY < r.top + r.height / 2);
      row.classList.toggle('drop-below', e.clientY >= r.top + r.height / 2);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drop-above', 'drop-below');
      const id = dragId || e.dataTransfer.getData('text/plain');
      if (!id || id === el.id) return;
      const r = row.getBoundingClientRect();
      const above = e.clientY < r.top + r.height / 2;
      const arr = state.doc.elements.filter((x) => x.id !== id);
      let idx = arr.findIndex((x) => x.id === el.id);
      // Listan är omvänd: "ovanför" i listan = efter i arrayen
      if (above) idx += 1;
      const moving = state.doc.elements.find((x) => x.id === id);
      arr.splice(idx, 0, moving);
      state.doc.elements = arr;
      emit('doc');
      commit();
    });
    list.append(row);
  });
};

// ---------------- Mallar ----------------
const T = (o) => createText(o);
const S = (k, o) => createShape(k, o);
function place(el, x, y) { syncTextBox(el, 'center'); el.x = x - el.w / 2; el.y = y - el.h / 2; return el; }
function placeShape(el, x, y, w, hh) { el.w = w; el.h = hh; el.x = x - w / 2; el.y = y - hh / 2; return el; }
const solid = (color) => ({ type: 'solid', color });
const lin = (angle, ...colors) => ({ type: 'linear', angle, stops: colors.map((color, i) => ({ offset: i / (colors.length - 1), color })) });
const WEEKDAYS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];
const DAY_COLORS = ['#e76f51', '#f4a261', '#d4a017', '#2a9d8f', '#264653', '#6a994e', '#b56576'];
const line = (x, y, w, color, width, rotation = 0) => placeShape(S('line', { rotation, stroke: { enabled: true, color, width, dash: 'solid' } }), x, y, w, Math.max(20, width * 3));

const TEMPLATES = [
  {
    name: 'Konsertaffisch', cat: 'Affischer', fmt: 'A4', short: 'LIVE', thumb: 'linear-gradient(170deg,#1e1b4b,#9333ea 60%,#f97316)', tstyle: { color: '#fff', textShadow: '0 0 8px #ff2bd6' },
    build() {
      const d = newDoc(2480, 3508, 300);
      d.background.fill = { type: 'linear', angle: 170, stops: [{ offset: 0, color: '#1e1b4b' }, { offset: 0.6, color: '#9333ea' }, { offset: 1, color: '#f97316' }] };
      d.elements.push(
        placeShape(S('ellipse', { fill: { type: 'radial', stops: [{ offset: 0, color: '#fde68aee' }, { offset: 1, color: '#f9731600' }] } }), 1240, 2350, 2200, 2200),
        place(T({ text: 'SOMMAR\nFESTIVAL', fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 520, lineHeight: 0.9, width: 2200, fill: { type: 'solid', color: '#fff7fe' }, glow: { enabled: true, color: '#ff2bd6', blur: 160 }, letterSpacing: 30 }), 1240, 1100),
        place(T({ text: 'LIVE PÅ STORA SCENEN', fontFamily: 'Montserrat', fontWeight: 800, fontSize: 92, width: 2000, letterSpacing: 300, curve: { mode: 'arc', amount: 18 }, fill: { type: 'solid', color: '#fde68a' } }), 1240, 470),
        place(T({ text: '12–14 JULI · GÖTEBORG', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 110, width: 2200, letterSpacing: 120, fill: { type: 'solid', color: '#1e1b4b' }, background: { enabled: true, color: '#fde68a', padding: 0.35, radius: 0.5 } }), 1240, 2900),
        place(T({ text: 'Biljetter på exempel.se', fontFamily: 'Poppins', fontWeight: 500, fontSize: 70, width: 2000, fill: { type: 'solid', color: '#ffffffcc' } }), 1240, 3250),
      );
      return d;
    },
  },
  {
    name: 'Citat', cat: 'Sociala medier', fmt: 'Instagram 1080×1080', short: '“ ”', thumb: '#f4ede4', tstyle: { color: '#7c2d12', fontFamily: 'Georgia, serif' },
    build() {
      const d = newDoc(1080, 1080, 72);
      d.background.fill = { type: 'solid', color: '#f4ede4' };
      d.elements.push(
        placeShape(S('ellipse', { fill: { type: 'solid', color: '#e9d5c3' } }), 860, 230, 520, 520),
        place(T({ text: '“', fontFamily: 'Playfair Display', fontWeight: 700, fontSize: 360, width: 300, fill: { type: 'solid', color: '#c2410c' } }), 200, 250),
        place(T({ text: 'Gör det du kan, med det du har, där du är.', fontFamily: 'Playfair Display', fontWeight: 400, italic: true, fontSize: 76, width: 820, lineHeight: 1.25, align: 'left', fill: { type: 'solid', color: '#2b2118' } }), 520, 560),
        place(T({ text: '— THEODORE ROOSEVELT', fontFamily: 'Montserrat', fontWeight: 600, fontSize: 30, width: 820, align: 'left', letterSpacing: 200, fill: { type: 'solid', color: '#c2410c' } }), 520, 850),
      );
      return d;
    },
  },
  {
    name: 'Rea-skylt', cat: 'Affischer', fmt: 'A4', short: '−50%', thumb: '#facc15', tstyle: { color: '#dc2626', fontWeight: 900 },
    build() {
      const d = newDoc(2480, 3508, 300);
      d.background.fill = { type: 'solid', color: '#facc15' };
      d.elements.push(
        placeShape(S('burst', { points: 20, innerRatio: 0.82, fill: { type: 'solid', color: '#dc2626' }, shadow: { enabled: true, color: '#00000040', blur: 40, x: 0, y: 30 } }), 1240, 1700, 1900, 1900),
        place(T({ text: '−50%', fontFamily: 'Anton', fontWeight: 400, fontSize: 620, width: 1800, fill: { type: 'solid', color: '#ffffff' }, shadow: { enabled: true, color: '#7f1d1d', blur: 0, x: 20, y: 24 } }), 1240, 1650),
        place(T({ text: 'STOR REA', fontFamily: 'Anton', fontWeight: 400, fontSize: 300, width: 2200, letterSpacing: 60, fill: { type: 'solid', color: '#111111' } }), 1240, 450),
        place(T({ text: 'BARA DENNA HELG', fontFamily: 'Montserrat', fontWeight: 800, fontSize: 110, width: 2200, letterSpacing: 200, fill: { type: 'solid', color: '#facc15' }, background: { enabled: true, color: '#111111', padding: 0.4, radius: 0 } }), 1240, 3000),
      );
      return d;
    },
  },
  {
    name: 'Inbjudan', cat: 'Inbjudningar & kort', fmt: 'A5', short: 'Fest', thumb: 'linear-gradient(160deg,#fdf2f8,#fbcfe8)', tstyle: { color: '#9d174d', fontFamily: 'cursive', fontStyle: 'italic' },
    build() {
      const d = newDoc(1748, 2480, 300);
      d.background.fill = { type: 'linear', angle: 160, stops: [{ offset: 0, color: '#fdf2f8' }, { offset: 1, color: '#fbcfe8' }] };
      d.elements.push(
        placeShape(S('rounded', { radius: 40, fill: { type: 'none' }, stroke: { enabled: true, color: '#be185d', width: 8, dash: 'solid' } }), 874, 1240, 1500, 2230),
        place(T({ text: 'Du är bjuden på', fontFamily: 'Montserrat', fontWeight: 500, fontSize: 70, width: 1400, letterSpacing: 250, uppercase: true, fill: { type: 'solid', color: '#9d174d' } }), 874, 560),
        place(T({ text: 'Fest!', fontFamily: 'Great Vibes', fontWeight: 400, fontSize: 480, width: 1400, fill: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#be185d' }, { offset: 1, color: '#7c3aed' }] } }), 874, 1000),
        place(T({ text: 'Lördag 21 mars kl. 18\nStorgatan 1, Stockholm', fontFamily: 'Playfair Display', fontWeight: 400, fontSize: 80, width: 1400, lineHeight: 1.5, fill: { type: 'solid', color: '#3f1d2b' } }), 874, 1600),
        place(T({ text: 'OSA senast 1 mars', fontFamily: 'Montserrat', fontWeight: 600, fontSize: 54, width: 1400, letterSpacing: 150, fill: { type: 'solid', color: '#be185d' } }), 874, 2050),
      );
      return d;
    },
  },
  {
    name: 'Lansering', cat: 'Sociala medier', fmt: 'Instagram 1080×1080', short: 'NYHET', thumb: '#0f172a', tstyle: { color: '#22d3ee', letterSpacing: '2px' },
    build() {
      const d = newDoc(1080, 1080, 72);
      d.background.fill = solid('#0f172a');
      d.elements.push(
        placeShape(S('blob', { fill: lin(135, '#22d3ee', '#a855f7') }), 800, 280, 620, 620),
        placeShape(S('ring', { innerRatio: 0.7, fill: solid('#f472b6') }), 960, 960, 220, 220),
        place(T({ text: 'NYHET', fontFamily: 'Unbounded', fontWeight: 800, fontSize: 56, width: 900, align: 'left', letterSpacing: 400, fill: solid('#22d3ee') }), 540, 470),
        place(T({ text: 'Vår nya\nkollektion\när här', fontFamily: 'Unbounded', fontWeight: 800, fontSize: 104, width: 900, align: 'left', lineHeight: 1.05, fill: solid('#ffffff') }), 540, 680),
        placeShape(S('rounded', { radius: 45, fill: solid('#ffffff') }), 250, 950, 320, 90),
        place(T({ text: 'Läs mer →', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 38, width: 300, fill: solid('#0f172a') }), 250, 950),
      );
      return d;
    },
  },
  {
    name: 'Dagens tips', cat: 'Sociala medier', fmt: 'Story 1080×1920', short: 'Tips', thumb: 'linear-gradient(180deg,#fef3c7,#fbcfe8)', tstyle: { color: '#be185d', fontFamily: 'Georgia, serif' },
    build() {
      const d = newDoc(1080, 1920, 72);
      d.background.fill = lin(180, '#fef3c7', '#fbcfe8');
      d.elements.push(
        placeShape(S('ellipse', { fill: solid('#fde68a') }), 920, 230, 520, 520),
        placeShape(S('ring', { innerRatio: 0.7, fill: solid('#f9a8d4') }), 140, 1720, 360, 360),
        place(T({ text: 'DAGENS TIPS', fontFamily: 'Montserrat', fontWeight: 800, fontSize: 46, width: 900, letterSpacing: 400, fill: solid('#be185d') }), 540, 420),
        place(T({ text: 'Drick ett glas vatten innan kaffet', fontFamily: 'Fraunces', fontWeight: 700, fontSize: 116, width: 900, lineHeight: 1.1, fill: solid('#3b0a2a') }), 540, 760),
        placeShape(S('rounded', { radius: 40, fill: solid('#ffffffcc') }), 540, 1300, 900, 380),
        place(T({ text: 'Kroppen har klarat sig utan vätska hela natten. Ett glas direkt på morgonen ger mer energi än du tror.', fontFamily: 'Poppins', fontWeight: 400, fontSize: 42, width: 780, lineHeight: 1.45, fill: solid('#3b0a2a') }), 540, 1300),
        place(T({ text: '@dittkonto', fontFamily: 'Poppins', fontWeight: 600, fontSize: 40, width: 600, fill: solid('#be185d') }), 540, 1720),
      );
      return d;
    },
  },
  {
    name: 'YouTube-miniatyr', cat: 'Sociala medier', fmt: '1280×720', short: 'SÅ GÖR DU', thumb: '#facc15', tstyle: { color: '#111', fontSize: '20px' },
    build() {
      const d = newDoc(1280, 720, 72);
      d.background.fill = solid('#facc15');
      d.elements.push(
        placeShape(S('ellipse', { fill: solid('#111111') }), 1030, 370, 500, 500),
        place(T({ text: '?', fontFamily: 'Luckiest Guy', fontWeight: 400, fontSize: 340, width: 400, fill: solid('#facc15') }), 1030, 390),
        place(T({ text: 'SÅ GÖR DU', fontFamily: 'Luckiest Guy', fontWeight: 400, fontSize: 150, width: 760, align: 'left', lineHeight: 0.95, fill: solid('#111111') }), 430, 230),
        place(T({ text: 'PÅ 5 MINUTER', fontFamily: 'Luckiest Guy', fontWeight: 400, fontSize: 92, width: 760, align: 'left', fill: solid('#ffffff'), stroke: { enabled: true, color: '#111111', width: 6 } }), 430, 450),
        placeShape(S('arrowShape', { rotation: -18, fill: solid('#dc2626'), stroke: { enabled: true, color: '#111111', width: 6, dash: 'solid' } }), 640, 610, 240, 130),
      );
      return d;
    },
  },
  {
    name: 'Facebook-omslag', cat: 'Sociala medier', fmt: '1640×624', short: 'Café', thumb: 'linear-gradient(90deg,#0ea5e9,#6366f1)', tstyle: { color: '#fff', fontFamily: 'Georgia, serif' },
    build() {
      const d = newDoc(1640, 624, 72);
      d.background.fill = lin(90, '#0ea5e9', '#6366f1');
      d.elements.push(
        placeShape(S('ellipse', { fill: solid('#ffffff22') }), 1460, 110, 380, 380),
        placeShape(S('ellipse', { fill: solid('#ffffff1a') }), 1320, 560, 240, 240),
        placeShape(S('ring', { innerRatio: 0.75, fill: solid('#ffffff33') }), 170, 110, 220, 220),
        place(T({ text: 'Välkommen till', fontFamily: 'Poppins', fontWeight: 500, fontSize: 46, width: 1200, fill: solid('#ffffffdd') }), 820, 210),
        place(T({ text: 'Café Solsidan', fontFamily: 'Playfair Display', fontWeight: 700, fontSize: 130, width: 1300, fill: solid('#ffffff') }), 820, 320),
        place(T({ text: 'Öppet alla dagar 8–18', fontFamily: 'Montserrat', fontWeight: 600, fontSize: 34, width: 1200, letterSpacing: 250, uppercase: true, fill: solid('#ffffff') }), 820, 450),
      );
      return d;
    },
  },
  {
    name: 'Vi söker', cat: 'Jobb & företag', fmt: 'Instagram 1080×1350', short: 'VI SÖKER', thumb: '#ecfdf5', tstyle: { color: '#065f46', fontSize: '20px' },
    build() {
      const d = newDoc(1080, 1350, 72);
      d.background.fill = solid('#ecfdf5');
      d.elements.push(
        placeShape(S('blob', { fill: solid('#6ee7b7') }), 920, 170, 440, 440),
        place(T({ text: 'VI SÖKER', fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 60, width: 900, align: 'left', letterSpacing: 200, fill: solid('#065f46') }), 540, 270),
        place(T({ text: 'Junior\nutvecklare', fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 124, width: 900, align: 'left', lineHeight: 1.0, fill: solid('#022c22') }), 540, 470),
        place(T({ text: 'till vårt team i Umeå', fontFamily: 'Poppins', fontWeight: 500, fontSize: 46, width: 900, align: 'left', fill: solid('#065f46') }), 540, 670),
        place(T({ text: '•  Hybridjobb\n•  Friskvårdsbidrag\n•  Trevliga kollegor', fontFamily: 'Poppins', fontWeight: 500, fontSize: 44, width: 900, align: 'left', lineHeight: 1.6, fill: solid('#022c22') }), 540, 890),
        placeShape(S('rounded', { radius: 50, fill: solid('#059669') }), 310, 1170, 440, 100),
        place(T({ text: 'Ansök senast 30/11', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 34, width: 420, fill: solid('#ffffff') }), 310, 1170),
      );
      return d;
    },
  },
  {
    name: 'Presentation', cat: 'Jobb & företag', fmt: '16:9 1920×1080', short: 'Q3', thumb: 'linear-gradient(135deg,#1e3a8a,#0f172a)', tstyle: { color: '#93c5fd' },
    build() {
      const d = newDoc(1920, 1080, 72);
      d.background.fill = lin(135, '#1e3a8a', '#0f172a');
      d.elements.push(
        placeShape(S('ellipse', { fill: { type: 'radial', stops: [{ offset: 0, color: '#60a5fa66' }, { offset: 1, color: '#60a5fa00' }] } }), 1620, 200, 1200, 1200),
        placeShape(S('rect', { fill: solid('#60a5fa') }), 210, 300, 100, 10),
        place(T({ text: 'KVARTALSRAPPORT', fontFamily: 'Inter', fontWeight: 700, fontSize: 38, width: 1400, align: 'left', letterSpacing: 300, fill: solid('#93c5fd') }), 860, 380),
        place(T({ text: 'Resultat och\nfokus framåt', fontFamily: 'Inter', fontWeight: 800, fontSize: 128, width: 1400, align: 'left', lineHeight: 1.05, fill: solid('#ffffff') }), 860, 565),
        place(T({ text: 'Q3 2026 · Ledningsgruppen', fontFamily: 'Inter', fontWeight: 400, fontSize: 42, width: 1400, align: 'left', fill: solid('#cbd5e1') }), 860, 790),
      );
      return d;
    },
  },
  {
    name: 'Föreläsning', cat: 'Affischer', fmt: 'A4', short: 'Design', thumb: 'linear-gradient(180deg,#e63946 55%,#f5f5f0 55%)', tstyle: { color: '#f5f5f0' },
    build() {
      const d = newDoc(2480, 3508, 300);
      d.background.fill = solid('#f5f5f0');
      d.elements.push(
        placeShape(S('rect', { fill: solid('#e63946') }), 1240, 900, 2480, 1800),
        placeShape(S('ellipse', { fill: solid('#111111') }), 2000, 1800, 600, 600),
        place(T({ text: 'Design\nsom\nfungerar', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 380, width: 2100, align: 'left', lineHeight: 0.95, fill: solid('#f5f5f0') }), 1240, 900),
        place(T({ text: 'FÖRELÄSNING', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 80, width: 2100, align: 'left', letterSpacing: 300, fill: solid('#e63946') }), 1240, 2150),
        place(T({ text: 'Maria Holm om enkelhet,\nform och funktion', fontFamily: 'Space Grotesk', fontWeight: 500, fontSize: 130, width: 2100, align: 'left', lineHeight: 1.15, fill: solid('#111111') }), 1240, 2500),
        place(T({ text: 'Tor 9 okt · 18.00\nStadsbiblioteket, Malmö\nFri entré', fontFamily: 'Space Grotesk', fontWeight: 400, fontSize: 80, width: 2100, align: 'left', lineHeight: 1.4, fill: solid('#111111') }), 1240, 3060),
      );
      return d;
    },
  },
  {
    name: 'Loppis', cat: 'Affischer', fmt: 'A4', short: 'LOPPIS', thumb: '#efe3c8', tstyle: { color: '#b91c1c', fontFamily: 'Impact, sans-serif' },
    build() {
      const d = newDoc(2480, 3508, 300);
      d.background.fill = solid('#efe3c8');
      d.elements.push(
        placeShape(S('rounded', { radius: 60, fill: { type: 'none' }, stroke: { enabled: true, color: '#1f2937', width: 10, dash: 'dashed' } }), 1240, 1754, 2280, 3308),
        placeShape(S('star', { rotation: 12, fill: solid('#f59e0b') }), 330, 330, 240, 240),
        placeShape(S('heart', { rotation: 10, fill: solid('#f97316') }), 2160, 2080, 260, 240),
        place(T({ text: 'LOPPIS', fontFamily: 'Amatic SC', fontWeight: 700, fontSize: 760, width: 2300, fill: solid('#b91c1c') }), 1240, 880),
        place(T({ text: 'på gården', fontFamily: 'Caveat', fontWeight: 700, fontSize: 220, width: 2000, rotation: -6, fill: solid('#1f2937') }), 1240, 1500),
        place(T({ text: 'Lördag 14 juni\nkl. 10–15', fontFamily: 'Montserrat', fontWeight: 800, fontSize: 150, width: 2000, lineHeight: 1.2, fill: solid('#1f2937') }), 1240, 2150),
        place(T({ text: 'Kläder · Böcker · Leksaker · Prylar', fontFamily: 'Montserrat', fontWeight: 600, fontSize: 80, width: 2100, fill: solid('#b91c1c') }), 1240, 2650),
        place(T({ text: 'Ekvägen 7, Uppsala', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 90, width: 2000, fill: solid('#efe3c8'), background: { enabled: true, color: '#1f2937', padding: 0.4, radius: 0.5 } }), 1240, 3050),
      );
      return d;
    },
  },
  {
    name: 'Lopp', cat: 'Affischer', fmt: 'A4', short: 'SPRING', thumb: 'linear-gradient(170deg,#0b0b0f 60%,#f97316 60%,#f97316 75%,#facc15 75%)', tstyle: { color: '#fff', fontStyle: 'italic' },
    build() {
      const d = newDoc(2480, 3508, 300);
      d.background.fill = solid('#0b0b0f');
      d.elements.push(
        placeShape(S('parallelogram', { rotation: -12, fill: solid('#f97316') }), 1240, 2300, 3200, 260),
        placeShape(S('parallelogram', { rotation: -12, fill: solid('#facc15') }), 1240, 2620, 3200, 140),
        place(T({ text: 'SPRING', fontFamily: 'Oswald', fontWeight: 700, italic: true, fontSize: 700, width: 2400, fill: solid('#ffffff') }), 1240, 950),
        place(T({ text: 'MILEN', fontFamily: 'Oswald', fontWeight: 700, italic: true, fontSize: 520, width: 2400, fill: { type: 'none' }, stroke: { enabled: true, color: '#f97316', width: 8 } }), 1240, 1620),
        place(T({ text: 'Söndag 7 sep · Start 10.00 · Slottsparken', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 80, width: 2300, letterSpacing: 60, fill: solid('#ffffff') }), 1240, 3060),
        place(T({ text: 'Anmälan: exempel.se/milen', fontFamily: 'Montserrat', fontWeight: 500, fontSize: 64, width: 2300, fill: solid('#facc15') }), 1240, 3270),
      );
      return d;
    },
  },
  {
    name: 'Meny', cat: 'Jobb & företag', fmt: 'A4', short: 'MENY', thumb: '#14301f', tstyle: { color: '#f5e9d3', fontFamily: 'Georgia, serif', letterSpacing: '3px' },
    build() {
      const d = newDoc(2480, 3508, 300);
      d.background.fill = solid('#14301f');
      const dish = { fontFamily: 'Playfair Display', fontWeight: 400, fontSize: 80, lineHeight: 1.6, fill: solid('#f5e9d3') };
      const heading = { fontFamily: 'Montserrat', fontWeight: 700, fontSize: 70, width: 2000, letterSpacing: 300, fill: solid('#d4a373') };
      // Rätter och priser är två textrutor med samma radavstånd så att raderna linjerar
      const course = (title, names, prices, y) => [
        place(T({ ...heading, text: title }), 1240, y),
        place(T({ ...dish, text: names, width: 1600, align: 'left' }), 1040, y + 300),
        place(T({ ...dish, text: prices, width: 400, align: 'right' }), 2040, y + 300),
      ];
      d.elements.push(
        place(T({ text: 'MENY', fontFamily: 'Playfair Display', fontWeight: 700, fontSize: 260, width: 2000, letterSpacing: 200, fill: solid('#f5e9d3') }), 1240, 440),
        place(T({ text: 'Bistro Linnea', fontFamily: 'Dancing Script', fontWeight: 700, fontSize: 140, width: 2000, fill: solid('#d4a373') }), 1240, 700),
        line(1240, 850, 600, '#d4a373', 4),
        ...course('FÖRRÄTTER', 'Toast Skagen\nRödbetscarpaccio\nSvampsoppa', '145 kr\n125 kr\n115 kr', 1050),
        ...course('VARMRÄTTER', 'Helstekt torskrygg\nRaggmunk med fläsk\nSvamprisotto', '265 kr\n195 kr\n215 kr', 1700),
        ...course('EFTERRÄTTER', 'Kladdkaka med grädde\nRabarberpaj\nOstbricka', '95 kr\n95 kr\n135 kr', 2350),
        place(T({ text: 'Fråga personalen om allergener', fontFamily: 'Poppins', fontWeight: 400, italic: true, fontSize: 56, width: 2000, fill: solid('#f5e9d3aa') }), 1240, 3200),
      );
      return d;
    },
  },
  {
    name: 'Födelsedag', cat: 'Inbjudningar & kort', fmt: 'A5', short: 'Grattis!', thumb: '#fff7ed', tstyle: { color: '#e11d48', fontFamily: 'cursive', fontSize: '22px' },
    build() {
      const d = newDoc(1748, 2480, 300);
      d.background.fill = solid('#fff7ed');
      const confetti = [
        [180, 220, 60, '#f43f5e', 'ellipse'], [1560, 260, 50, '#3b82f6', 'star'], [300, 1100, 44, '#facc15', 'ellipse'],
        [1500, 1250, 70, '#10b981', 'star'], [150, 1650, 56, '#a855f7', 'star'], [1600, 1650, 40, '#f97316', 'ellipse'],
        [260, 2300, 50, '#3b82f6', 'ellipse'], [1480, 2280, 64, '#f43f5e', 'star'], [880, 2330, 36, '#10b981', 'ellipse'],
      ];
      d.elements.push(
        ...confetti.map(([x, y, s, c, k]) => placeShape(S(k, { rotation: (x + y) % 40, fill: solid(c) }), x, y, s, s)),
        line(720, 1060, 500, '#94a3b8', 4, 90),
        line(1060, 1150, 520, '#94a3b8', 4, 90),
        placeShape(S('ellipse', { fill: solid('#facc15') }), 890, 470, 270, 340),
        placeShape(S('ellipse', { fill: solid('#f43f5e') }), 720, 620, 340, 420),
        placeShape(S('ellipse', { fill: solid('#3b82f6') }), 1060, 720, 300, 380),
        place(T({ text: 'Grattis', fontFamily: 'Pacifico', fontWeight: 400, fontSize: 340, width: 1500, fill: solid('#e11d48') }), 874, 1520),
        place(T({ text: 'PÅ FÖDELSEDAGEN!', fontFamily: 'Montserrat', fontWeight: 800, fontSize: 96, width: 1500, letterSpacing: 100, fill: solid('#1e293b') }), 874, 1830),
        place(T({ text: 'Hipp hipp hurra – idag är det din dag', fontFamily: 'Caveat', fontWeight: 600, fontSize: 92, width: 1500, fill: solid('#475569') }), 874, 2050),
      );
      return d;
    },
  },
  {
    name: 'Save the date', cat: 'Inbjudningar & kort', fmt: 'A5', short: 'A & E', thumb: '#faf7f2', tstyle: { color: '#b08d57', fontFamily: 'Georgia, serif', fontStyle: 'italic' },
    build() {
      const d = newDoc(1748, 2480, 300);
      d.background.fill = solid('#faf7f2');
      const gold = '#b08d57';
      d.elements.push(
        placeShape(S('rect', { fill: { type: 'none' }, stroke: { enabled: true, color: gold, width: 4, dash: 'solid' } }), 874, 1240, 1548, 2280),
        placeShape(S('rect', { fill: { type: 'none' }, stroke: { enabled: true, color: gold, width: 2, dash: 'solid' } }), 874, 1240, 1484, 2216),
        place(T({ text: 'SAVE THE DATE', fontFamily: 'Cinzel', fontWeight: 600, fontSize: 88, width: 1400, letterSpacing: 300, fill: solid(gold) }), 874, 600),
        line(874, 730, 300, gold, 3),
        place(T({ text: 'Anna & Erik', fontFamily: 'Cormorant Garamond', fontWeight: 600, italic: true, fontSize: 220, width: 1400, fill: solid('#3f3a33') }), 874, 1050),
        place(T({ text: '06 · 09 · 2027', fontFamily: 'Cinzel', fontWeight: 400, fontSize: 116, width: 1400, letterSpacing: 150, fill: solid('#3f3a33') }), 874, 1450),
        place(T({ text: 'Göteborg', fontFamily: 'Cormorant Garamond', fontWeight: 400, italic: true, fontSize: 90, width: 1400, fill: solid('#7a6a55') }), 874, 1650),
        placeShape(S('diamond', { fill: solid(gold) }), 874, 1830, 40, 40),
        place(T({ text: 'Formell inbjudan följer', fontFamily: 'Montserrat', fontWeight: 500, fontSize: 44, width: 1400, letterSpacing: 300, uppercase: true, fill: solid(gold) }), 874, 2000),
      );
      return d;
    },
  },
  {
    name: 'Vykort', cat: 'Inbjudningar & kort', fmt: '15×10,5 cm', short: 'Gotland', thumb: 'linear-gradient(180deg,#fff1d6 70%,#0f766e 70%)', tstyle: { color: '#0f766e', fontFamily: 'cursive' },
    build() {
      const d = newDoc(1748, 1240, 300);
      d.background.fill = solid('#fff1d6');
      d.elements.push(
        placeShape(S('halfCircle', { fill: lin(180, '#f97316', '#fb7185') }), 874, 860, 1000, 500),
        // Ränder i bakgrundsfärgen över solen ger retrokänsla
        placeShape(S('rect', { fill: solid('#fff1d6') }), 874, 900, 1100, 26),
        placeShape(S('rect', { fill: solid('#fff1d6') }), 874, 975, 1100, 36),
        placeShape(S('rect', { fill: solid('#fff1d6') }), 874, 1055, 1100, 46),
        placeShape(S('rect', { fill: solid('#0f766e') }), 874, 1175, 1748, 130),
        place(T({ text: 'Hälsningar från', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 58, width: 1500, letterSpacing: 300, uppercase: true, fill: solid('#9a3412') }), 874, 170),
        place(T({ text: 'Gotland', fontFamily: 'Lobster', fontWeight: 400, fontSize: 300, width: 1500, fill: solid('#0f766e'), shadow: { enabled: true, color: '#f97316', blur: 0, x: 10, y: 10 } }), 874, 400),
      );
      return d;
    },
  },
  {
    name: 'Mobilbakgrund', cat: 'Sociala medier', fmt: '1170×2532', short: '☾', thumb: 'linear-gradient(180deg,#0f172a,#312e81 60%,#be185d)', tstyle: { color: '#fde68a' },
    build() {
      const d = newDoc(1170, 2532, 72);
      d.background.fill = { type: 'linear', angle: 180, stops: [{ offset: 0, color: '#0f172a' }, { offset: 0.6, color: '#312e81' }, { offset: 1, color: '#be185d' }] };
      const stars = [[180, 300, 34], [960, 220, 26], [1020, 1050, 30], [140, 1150, 22], [520, 260, 18], [880, 1400, 20]];
      d.elements.push(
        ...stars.map(([x, y, s]) => placeShape(S('star', { points: 4, innerRatio: 0.35, fill: solid('#ffffffcc') }), x, y, s, s)),
        placeShape(S('ellipse', { fill: solid('#fde68a'), shadow: { enabled: true, color: '#fde68a99', blur: 120, x: 0, y: 0 } }), 585, 720, 420, 420),
        place(T({ text: 'Ett steg\ni taget', fontFamily: 'DM Serif Display', fontWeight: 400, fontSize: 170, width: 1000, lineHeight: 1.05, fill: solid('#fff7ed') }), 585, 1520),
      );
      return d;
    },
  },
  {
    name: 'Veckoplanering', cat: 'Planering', fmt: 'A4', short: 'Vecka', thumb: '#faf7f2', tstyle: { color: '#1f2937', fontFamily: 'Georgia, serif' },
    build() {
      const d = newDoc(2480, 3508, 300);
      d.background.fill = solid('#faf7f2');
      d.elements.push(
        place(T({ text: 'Veckoplanering', fontFamily: 'DM Serif Display', fontWeight: 400, fontSize: 190, width: 1500, align: 'left', fill: solid('#1f2937') }), 910, 330),
        place(T({ text: 'VECKA', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 54, width: 300, align: 'right', letterSpacing: 250, fill: solid('#9ca3af') }), 1690, 360),
        line(2090, 395, 460, '#9ca3af', 4),
      );
      // Sju dagar + "Att göra" i ett rutnät med 2 kolumner × 4 rader
      const boxes = [...WEEKDAYS.map((day, i) => ({ day, color: DAY_COLORS[i] })), { day: 'Att göra', color: '#1f2937', todo: true }];
      boxes.forEach((b, i) => {
        const cx = i % 2 ? 1795 : 685, cy = 940 + Math.floor(i / 2) * 700;
        const left = cx - 525;
        d.elements.push(
          placeShape(S('rounded', { radius: 40, fill: solid('#ffffff'), stroke: { enabled: true, color: '#e7e1d7', width: 4, dash: 'solid' } }), cx, cy, 1050, 640),
          placeShape(S('ellipse', { fill: solid(b.color) }), left + 70, cy - 240, 32, 32),
          place(T({ text: b.day, uppercase: true, fontFamily: 'Montserrat', fontWeight: 700, fontSize: 52, width: 900, align: 'left', letterSpacing: 200, fill: solid(b.color) }), left + 565, cy - 240),
        );
        if (b.todo) {
          for (const y of [cy - 120, cy - 10, cy + 100, cy + 210]) {
            d.elements.push(
              placeShape(S('rounded', { radius: 8, fill: { type: 'none' }, stroke: { enabled: true, color: '#9ca3af', width: 4, dash: 'solid' } }), left + 75, y - 18, 44, 44),
              line(cx + 30, y, 870, '#e7e1d7', 3),
            );
          }
        } else {
          for (const y of [cy - 100, cy + 30, cy + 160]) d.elements.push(line(cx, y, 930, '#e7e1d7', 3));
        }
      });
      return d;
    },
  },
  {
    name: 'Veckoschema', cat: 'Planering', fmt: 'A4 liggande', short: 'M T O T F', thumb: 'linear-gradient(90deg,#e76f51 14%,#f4a261 14% 28%,#e9c46a 28% 42%,#2a9d8f 42% 57%,#264653 57% 71%,#8ab17d 71% 85%,#b56576 85%)', tstyle: { color: '#fff', fontSize: '15px', letterSpacing: '4px' },
    build() {
      const d = newDoc(3508, 2480, 300);
      d.background.fill = solid('#f3f4f6');
      d.elements.push(
        place(T({ text: 'Veckoschema', fontFamily: 'Poppins', fontWeight: 700, fontSize: 150, width: 1800, align: 'left', fill: solid('#111827') }), 1040, 260),
        place(T({ text: 'VECKA', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 54, width: 300, align: 'right', letterSpacing: 250, fill: solid('#9ca3af') }), 2720, 290),
        line(3120, 325, 460, '#9ca3af', 4),
      );
      WEEKDAYS.forEach((day, i) => {
        const cx = 140 + 435 / 2 + i * 465;
        d.elements.push(
          placeShape(S('rounded', { radius: 24, fill: solid(DAY_COLORS[i]) }), cx, 530, 435, 140),
          place(T({ text: day, fontFamily: 'Montserrat', fontWeight: 700, fontSize: 54, width: 420, fill: solid('#ffffff') }), cx, 530),
          placeShape(S('rounded', { radius: 24, fill: solid('#ffffff'), stroke: { enabled: true, color: '#e5e7eb', width: 4, dash: 'solid' } }), cx, 1430, 435, 1540),
        );
      });
      d.elements.push(
        place(T({ text: 'Anteckningar:', fontFamily: 'Montserrat', fontWeight: 600, fontSize: 50, width: 600, align: 'left', fill: solid('#6b7280') }), 440, 2330),
        line(2134, 2350, 2468, '#d1d5db', 4),
      );
      return d;
    },
  },
  {
    name: 'Veckans meny', cat: 'Planering', fmt: 'A4', short: 'Meny', thumb: '#fffbeb', tstyle: { color: '#b45309', fontFamily: 'cursive', fontStyle: 'italic' },
    build() {
      const d = newDoc(2480, 3508, 300);
      d.background.fill = solid('#fffbeb');
      d.elements.push(
        placeShape(S('blob', { fill: solid('#fde68a') }), 2200, 260, 700, 600),
        place(T({ text: 'Veckans meny', fontFamily: 'Pacifico', fontWeight: 400, fontSize: 210, width: 2000, fill: solid('#b45309') }), 1240, 420),
      );
      WEEKDAYS.forEach((day, i) => {
        const y = 820 + i * 285;
        d.elements.push(
          place(T({ text: day, uppercase: true, fontFamily: 'Montserrat', fontWeight: 700, fontSize: 64, width: 600, align: 'left', letterSpacing: 150, fill: solid(DAY_COLORS[i]) }), 520, y),
          line(1540, y + 30, 1440, '#e7d9b8', 4),
        );
      });
      d.elements.push(
        placeShape(S('rounded', { radius: 40, fill: solid('#fef3c7') }), 1240, 3080, 2080, 560),
        place(T({ text: 'INKÖPSLISTA', fontFamily: 'Montserrat', fontWeight: 800, fontSize: 60, width: 1800, align: 'left', letterSpacing: 250, fill: solid('#b45309') }), 1240, 2900),
        line(1240, 3060, 1840, '#e7d9b8', 4),
        line(1240, 3180, 1840, '#e7d9b8', 4),
        line(1240, 3300, 1840, '#e7d9b8', 4),
      );
      return d;
    },
  },
];

const TEMPLATE_CATS = ['Affischer', 'Sociala medier', 'Inbjudningar & kort', 'Planering', 'Jobb & företag'];

/** Filnamn för mallens förhandsbild, t.ex. "Födelsedag" → "fodelsedag". */
export const templateSlug = (t) => t.name.toLowerCase()
  .replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Förhandsbilden är en färdigrenderad bild (ui/img/mallar, skapas med
 * verktyg/mallbilder.py). Saknas den visas en enkel färgruta med text.
 */
function templateThumb(t) {
  const fallback = h('span', { class: 'tpl-t', style: t.tstyle || {} }, t.short);
  const thumb = h('span', { class: 'tpl-thumb', style: { background: t.thumb } });
  const img = h('img', { src: `img/mallar/${templateSlug(t)}.webp`, alt: '', loading: 'lazy', draggable: false });
  img.addEventListener('load', () => thumb.classList.add('has-img'));
  img.addEventListener('error', () => { img.remove(); thumb.append(fallback); });
  thumb.append(img);
  return thumb;
}

export { createImage, TEMPLATES };
