// Flytande verktygsrad vid markeringen: de vanligaste ändringarna nära det
// man arbetar med, så att man slipper gå till högerpanelen för småsaker.
// Innehållet beror på vad som är markerat; raden följer markeringen och
// göms medan man drar.
import { state, on, selected } from './state.js';
import { h, round, clamp, deepClone } from './util.js';
import { Binder, icon, toggleBtn, segmented, colorBtn } from './controls.js';
import * as A from './actions.js';
import { selectionScreenRect, isDragging, startCrop, textRange, rangeStyle } from './editor.js';
import { applyToSelection, setRunStyle, loadSelectedFonts, chooseImageFor } from './properties.js';
import { clearRunProp } from './richtext.js';
import { openBgRemoval } from './bgremoval.js';

let bar, stage;
let B = new Binder();
let sig = '';

const first = () => selected()[0];
const signature = () => selected().map((e) => `${e.id}:${e.type}:${e.locked}:${e.type === 'image' ? !!e.assetId : ''}`).join(',') + '|' + state.cropId;

const btn = (iconName, title, onclick, cls = '') => h('button', { class: 'icon-btn ' + cls, title, onclick }, icon(iconName));
const sep = () => h('span', { class: 'st-sep' });

/** Stegar textstorleken i lagom stora steg för storleken. */
function sizeStep(v, dir) {
  const step = v < 40 ? 1 : v < 100 ? 2 : v < 300 ? 10 : 20;
  return Math.max(1, Math.round((v + dir * step) / step) * step);
}

function textTools() {
  const size = () => round(first().fontSize * (rangeStyle('size') ?? 1), 1);
  const setSize = (v, f = true) => {
    v = clamp(v, 1, 5000);
    if (textRange()) setRunStyle('size', v / first().fontSize, f);
    else applyToSelection((e) => { if (e.type === 'text') e.fontSize = v; }, f);
  };
  const inp = h('input', { class: 'st-size', type: 'text', inputmode: 'decimal', title: 'Textstorlek' });
  inp.addEventListener('change', () => { const v = parseFloat(inp.value.replace(',', '.')); if (!Number.isNaN(v)) setSize(v); else inp.value = size(); });
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); });
  B.add(() => { if (document.activeElement !== inp) inp.value = Math.round(size()); });
  const weight = () => rangeStyle('weight') ?? (first().fontWeight || 400);
  return [
    colorBtn(B, {
      title: 'Textfärg', allowGradient: true, allowNone: true,
      get: () => { const c = rangeStyle('color'); return c ? { type: 'solid', color: c } : first()?.fill; },
      set: (v, f) => { if (v.type === 'solid' && textRange()) setRunStyle('color', v.color, f); else applyToSelection((e) => { if (e.type === 'text') { e.fill = deepClone(v); clearRunProp(e, 'color'); } }, f); },
    }),
    h('span', { class: 'st-stepper' }, btn('minus', 'Mindre text', () => setSize(sizeStep(size(), -1))), inp, btn('plus', 'Större text', () => setSize(sizeStep(size(), 1)))),
    toggleBtn(B, { iconName: 'bold', title: 'Fet (Ctrl+B)', get: () => weight() >= 600, set: (v) => { setRunStyle('weight', v ? 700 : 400, true, (e) => { e.fontWeight = v ? 700 : 400; }); loadSelectedFonts(); } }),
    toggleBtn(B, { iconName: 'italic', title: 'Kursiv (Ctrl+I)', get: () => rangeStyle('italic') ?? first()?.italic, set: (v) => { setRunStyle('italic', v, true, (e) => { e.italic = v; }); loadSelectedFonts(); } }),
    segmented(B, { options: [['left', 'textLeft', 'Vänster'], ['center', 'textCenter', 'Centrerad'], ['right', 'textRight', 'Höger']], get: () => first()?.align, set: (v) => applyToSelection((e) => { if (e.type === 'text') e.align = v; }, true) }),
  ];
}

/** Färgknapp för former (fyllning) samt ikoner och QR-koder (linjefärg). */
function colorTools(els) {
  if (els.every((e) => e.type === 'shape' && e.fill && !['line', 'arrow'].includes(e.kind))) {
    return [colorBtn(B, { title: 'Fyllning', allowGradient: true, allowNone: true, get: () => first()?.fill, set: (v, f) => applyToSelection((e) => { e.fill = deepClone(v); }, f) })];
  }
  if (els.every((e) => e.type === 'icon' || e.type === 'qr')) {
    return [colorBtn(B, { title: 'Färg', get: () => first()?.color, set: (v, f) => applyToSelection((e) => { e.color = v; }, f) })];
  }
  return [];
}

function build() {
  sig = signature();
  B = new Binder();
  bar.innerHTML = '';
  const els = selected();
  if (!els.length || state.cropId) return;
  const el = els.length === 1 ? els[0] : null;
  const locked = els.some((e) => e.locked);
  const tools = [];
  if (!locked) {
    if (els.every((e) => e.type === 'text')) tools.push(...textTools());
    else tools.push(...colorTools(els));
    if (el?.type === 'image') {
      if (el.assetId) tools.push(btn('crop', 'Beskär (dubbelklick)', () => startCrop(el)), btn('replace', 'Byt bild', () => chooseImageFor(el)), btn('magic', 'Ta bort bakgrund…', () => openBgRemoval(el)));
      else tools.push(h('button', { class: 'btn small primary', onclick: () => chooseImageFor(el) }, icon('image'), 'Välj bild'));
    }
    if (el?.type === 'group') tools.push(btn('ungroup', 'Dela upp grupp (Ctrl+Shift+G)', A.ungroupSelection));
    if (els.length > 1) tools.push(btn('group', 'Gruppera (Ctrl+G)', A.groupSelection));
    if (tools.length) tools.push(sep());
    if (el && el.type !== 'group') {
      const brush = btn('brush', 'Kopiera stil – klicka sedan på elementet som ska få den (Ctrl+Alt+C)', () => A.setStylePainter(!state.stylePainter));
      B.add(() => brush.classList.toggle('armed', state.stylePainter));
      tools.push(brush);
    }
    tools.push(btn('copy', 'Duplicera (Ctrl+D)', () => A.duplicateSelection()));
  }
  tools.push(btn(locked ? 'unlock' : 'lock', locked ? 'Lås upp (Ctrl+L)' : 'Lås (Ctrl+L)', A.toggleLock, locked ? 'active' : ''));
  if (!locked) tools.push(btn('trash', 'Ta bort (Delete)', A.deleteSelection, 'danger'));
  bar.append(...tools);
  B.refresh();
}

/** Lägger raden ovanför markeringen, eller under den om det inte finns plats. */
function place() {
  const r = bar.childElementCount && !state.cropId && !isDragging() ? selectionScreenRect() : null;
  bar.classList.toggle('on', !!r);
  if (!r) return;
  const W = stage.clientWidth, H = stage.clientHeight, bw = bar.offsetWidth, bh = bar.offsetHeight;
  const x = clamp((r.l + r.r) / 2 - bw / 2, 8, Math.max(8, W - bw - 8));
  let y = r.t - bh - 16;
  if (y < 8) y = r.b + 56;           // under rotationshandtaget
  if (y > H - bh - 8) y = 8;         // markeringen fyller hela ytan
  bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function initToolbar(stageEl) {
  stage = stageEl;
  bar = h('div', { id: 'seltools' });
  // Klick på raden ska inte ta fokus från texten som redigeras
  bar.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
  stage.append(bar);
  const sync = () => { if (signature() !== sig) build(); else B.refresh(); };
  on('selection', build);
  on('crop', build);
  on('doc:replaced', build);
  on('doc', sync);
  on('doc:live', () => B.refresh());
  on('textsel', () => B.refresh());
  on('styleclip', () => B.refresh());
  on('frame', place);
  build();
}
