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

  panel.append(
    head('Format & mallar'),
    h('div', { class: 'lp-section' },
      h('h4', null, 'Startmallar'),
      h('div', { class: 'tpl-grid' }, TEMPLATES.map((t) => h('button', {
        class: 'tpl', onclick: async () => {
          if (state.doc.elements.length && !(await confirmDialog('Använd mall', 'Mallen ersätter din nuvarande design. Fortsätta?', { ok: 'Använd mall' }))) return;
          const doc = t.build();
          loadDoc(doc, { fileName: t.name, filePath: null });
          await ensureDocFonts(doc.elements);
          A.relayoutAllText();
          emit('doc');
        },
      }, h('span', { class: 'tpl-thumb', style: { background: t.thumb } }, h('span', { class: 'tpl-t', style: t.tstyle || {} }, t.short)), h('span', { class: 'tpl-name' }, t.name)))),
    ),
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
    b.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-ediholio-shape', k));
    return b;
  };
  panel.append(
    head('Element', 'Klicka för att lägga till, eller dra ut på sidan.'),
    h('div', { class: 'lp-section' }, h('h4', null, 'Former'), h('div', { class: 'shape-grid' }, SHAPE_LIST.map((k) => item(k, () => A.addShape(k))))),
    h('div', { class: 'lp-section' }, h('h4', null, 'Linjer & pilar'), h('div', { class: 'shape-grid' },
      item('line', () => A.addShape('line')),
      item('arrow', () => A.addShape('arrow')),
      item('dashed', () => { const e = A.addShape('line'); e.stroke.dash = 'dashed'; emit('doc'); commit(); }),
      item('dotted', () => { const e = A.addShape('line'); e.stroke.dash = 'dotted'; emit('doc'); commit(); }),
    )),
    h('div', { class: 'lp-section' }, h('h4', null, 'Färgklickar'), h('div', { class: 'swatch-grid' }, GRADIENT_PRESETS.slice(0, 8).map((g) => h('button', {
      class: 'big-swatch', style: { background: paintCss(g) }, onclick: () => { const e = A.addShape('blob', { fill: deepClone(g) }); e.fill = deepClone(g); emit('doc'); commit(); },
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
    im.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-ediholio-asset', id));
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

const TEMPLATES = [
  {
    name: 'Konsertaffisch', short: 'LIVE', thumb: 'linear-gradient(170deg,#1e1b4b,#9333ea 60%,#f97316)', tstyle: { color: '#fff', textShadow: '0 0 8px #ff2bd6' },
    build() {
      const d = newDoc(2480, 3508, 300);
      d.background.fill = { type: 'linear', angle: 170, stops: [{ offset: 0, color: '#1e1b4b' }, { offset: 0.6, color: '#9333ea' }, { offset: 1, color: '#f97316' }] };
      d.elements.push(
        placeShape(S('ellipse', { fill: { type: 'radial', stops: [{ offset: 0, color: '#fde68aee' }, { offset: 1, color: '#f9731600' }] } }), 1240, 2350, 2200, 2200),
        place(T({ text: 'SOMMAR\nFESTIVAL', fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 520, lineHeight: 0.9, width: 2200, fill: { type: 'solid', color: '#fff7fe' }, glow: { enabled: true, color: '#ff2bd6', blur: 160 }, letterSpacing: 30 }), 1240, 1100),
        place(T({ text: 'LIVE PÅ STORA SCENEN', fontFamily: 'Montserrat', fontWeight: 800, fontSize: 92, width: 2000, letterSpacing: 300, curve: { mode: 'arc', amount: 18 }, fill: { type: 'solid', color: '#fde68a' } }), 1240, 470),
        place(T({ text: '12–14 JULI · GÖTEBORG', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 110, width: 2200, letterSpacing: 120, fill: { type: 'solid', color: '#1e1b4b' }, background: { enabled: true, color: '#fde68a', padding: 0.35, radius: 0.5 } }), 1240, 2900),
        place(T({ text: 'Biljetter på ediholio.se', fontFamily: 'Poppins', fontWeight: 500, fontSize: 70, width: 2000, fill: { type: 'solid', color: '#ffffffcc' } }), 1240, 3250),
      );
      return d;
    },
  },
  {
    name: 'Citat', short: '“ ”', thumb: '#f4ede4', tstyle: { color: '#7c2d12', fontFamily: 'Georgia, serif' },
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
    name: 'Rea-skylt', short: '−50%', thumb: '#facc15', tstyle: { color: '#dc2626', fontWeight: 900 },
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
    name: 'Inbjudan', short: 'Fest', thumb: 'linear-gradient(160deg,#fdf2f8,#fbcfe8)', tstyle: { color: '#9d174d', fontFamily: 'cursive', fontStyle: 'italic' },
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
];

export { createImage };
