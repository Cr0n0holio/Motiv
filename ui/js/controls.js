// Små UI-kontroller som binds till getters/setters. Varje kontroll
// registrerar en "refresh" som uppdaterar värdet när dokumentet ändras.
import { h, clamp, round } from './util.js';
import { openColorPicker } from './colorpicker.js';
import { paintCss } from './paint.js';

export class Binder {
  constructor() { this.refreshers = []; }
  add(fn) { this.refreshers.push(fn); return fn; }
  refresh() { for (const r of this.refreshers) r(); }
}

export const ICONS = {
  alignLeft: '<path d="M4 4v16M8 7h10M8 12h6M8 17h12"/>',
  alignCenterH: '<path d="M12 4v16M6 7h12M8 12h8M5 17h14"/>',
  alignRight: '<path d="M20 4v16M6 7h10M10 12h6M4 17h12"/>',
  alignTop: '<path d="M4 4h16M7 8v10M12 8v6M17 8v12"/>',
  alignMiddle: '<path d="M4 12h16M7 6v12M12 8v8M17 5v14"/>',
  alignBottom: '<path d="M4 20h16M7 6v10M12 10v6M17 4v12"/>',
  textLeft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  textCenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  textRight: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
  italic: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
  underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/>',
  caps: '<path d="M3 18l4.5-12L12 18M4.6 14h5.8M14 18l3.5-9 3.5 9M15 15h5"/>',
  flipH: '<path d="M12 3v18M8 7l-5 5 5 5V7zM16 7l5 5-5 5V7z"/>',
  flipV: '<path d="M3 12h18M7 8l5-5 5 5H7zM7 16l5 5 5-5H7z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
  front: '<rect x="8" y="8" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
  back: '<rect x="4" y="4" width="12" height="12" rx="1.5"/><path d="M8 20h11a1 1 0 0 0 1-1V8"/>',
  forward: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  backward: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  group: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M14 4h6v6M4 14v6h6" stroke-dasharray="2 2"/>',
  ungroup: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>',
  magic: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M12.2 6.2l-1.4-1.4M3 21l9-9"/>',
  distH: '<path d="M4 4v16M20 4v16M9 8h6v8H9z"/>',
  distV: '<path d="M4 4h16M4 20h16M8 9h8v6H8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  shapes: '<circle cx="8" cy="8" r="5"/><rect x="12" y="12" width="9" height="9" rx="1.5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.2-1-1.4-1-2.5 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4c0-4.6-4-8.3-9-8.3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  dots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  replace: '<path d="M4 7h12l-3-3M20 17H8l3 3"/>',
  bg: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/>',
};
export const icon = (name, cls = '') => h('span', { class: `ic ${cls}`, html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>` });

/** Numeriskt fält med "skrubbning": dra i etiketten för att ändra värdet. */
export function numField(B, { label, get, set, min = -Infinity, max = Infinity, step = 1, unit = '', decimals = 0, title }) {
  const inp = h('input', { class: 'num-input', type: 'text', inputmode: 'decimal' });
  const lab = h('span', { class: 'num-label', title: title || 'Dra för att ändra' }, label);
  const wrap = h('label', { class: 'num-field' }, lab, inp, unit ? h('span', { class: 'num-unit' }, unit) : null);
  const fmt = (v) => (v == null || Number.isNaN(v) ? '' : String(round(v, decimals)));
  const apply = (v, final) => { v = clamp(v, min, max); set(v, final); inp.value = fmt(v); };
  inp.addEventListener('change', () => { const v = parseFloat(inp.value.replace(',', '.')); if (!Number.isNaN(v)) apply(v, true); else inp.value = fmt(get()); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') inp.blur();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const k = (e.shiftKey ? 10 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
      apply((get() || 0) + k, true);
    }
  });
  lab.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const x0 = e.clientX, v0 = get() || 0;
    lab.setPointerCapture(e.pointerId);
    document.body.classList.add('scrubbing');
    const mv = (ev) => apply(v0 + Math.round((ev.clientX - x0) / 2) * step * (ev.shiftKey ? 10 : 1), false);
    const up = () => { lab.removeEventListener('pointermove', mv); lab.removeEventListener('pointerup', up); document.body.classList.remove('scrubbing'); set(clamp(get(), min, max), true); };
    lab.addEventListener('pointermove', mv);
    lab.addEventListener('pointerup', up);
  });
  B.add(() => { if (document.activeElement !== inp) inp.value = fmt(get()); });
  return wrap;
}

/** Skjutreglage med värde. */
export function slider(B, { label, get, set, min = 0, max = 100, step = 1, unit = '', decimals = 0 }) {
  const r = h('input', { type: 'range', min, max, step, class: 'range' });
  const v = h('input', { class: 'range-val', type: 'text' });
  const fill = () => r.style.setProperty('--p', `${((+r.value - min) / (max - min)) * 100}%`);
  r.addEventListener('input', () => { set(+r.value, false); v.value = round(+r.value, decimals) + unit; fill(); });
  r.addEventListener('change', () => set(+r.value, true));
  r.addEventListener('dblclick', () => { /* dubbelklick återställs av anroparen via reset */ });
  v.addEventListener('change', () => { const n = parseFloat(v.value.replace(',', '.')); if (!Number.isNaN(n)) { set(clamp(n, min, max), true); } });
  v.addEventListener('keydown', (e) => { if (e.key === 'Enter') v.blur(); });
  B.add(() => {
    const val = get();
    if (document.activeElement !== r) { r.value = val; fill(); }
    if (document.activeElement !== v) v.value = round(val, decimals) + unit;
  });
  return h('div', { class: 'slider-row' }, h('div', { class: 'slider-head' }, h('span', null, label), v), r);
}

export function select(B, { label, options, get, set, cls = '' }) {
  const s = h('select', { class: 'select ' + cls }, options.map(([v, t]) => h('option', { value: v }, t)));
  s.addEventListener('change', () => set(s.value, true));
  B.add(() => { if (document.activeElement !== s) s.value = get(); });
  return label ? h('label', { class: 'field' }, h('span', null, label), s) : s;
}

export function toggleBtn(B, { iconName, label, title, get, set }) {
  const b = h('button', { class: 'tog', title }, iconName ? icon(iconName) : null, label || null);
  b.addEventListener('click', () => set(!get(), true));
  B.add(() => b.classList.toggle('active', !!get()));
  return b;
}

export function segmented(B, { options, get, set, cls = '' }) {
  const wrap = h('div', { class: 'seg ' + cls });
  const btns = options.map(([v, content, title]) => {
    const b = h('button', { title }, typeof content === 'string' && ICONS[content] ? icon(content) : content);
    b.addEventListener('click', () => set(v, true));
    wrap.append(b);
    return [v, b];
  });
  B.add(() => { const cur = get(); btns.forEach(([v, b]) => b.classList.toggle('active', v === cur)); });
  return wrap;
}

/** Färgknapp. Om allowGradient hanteras ett paint-objekt. */
export function colorBtn(B, { get, set, allowGradient = false, allowNone = false, title = 'Färg', label }) {
  const sw = h('span', { class: 'swatch-inner' });
  const b = h('button', { class: 'swatch', title }, sw);
  b.addEventListener('click', () => openColorPicker(b, { value: get(), allowGradient, allowNone, onChange: (v, final) => set(v, final) }));
  B.add(() => {
    const v = get();
    sw.style.background = allowGradient ? paintCss(v) : v;
    b.classList.toggle('is-none', allowGradient ? (!v || v.type === 'none') : false);
  });
  return label ? h('div', { class: 'field color-field' }, h('span', null, label), b) : b;
}

/** Sektion med på/av-knapp (t.ex. effekter). */
export function effectSection(B, { title, get, set, body }) {
  const chk = h('input', { type: 'checkbox', class: 'switch' });
  const content = h('div', { class: 'effect-body' }, body);
  chk.addEventListener('change', () => set(chk.checked, true));
  B.add(() => { const on = !!get(); chk.checked = on; content.style.display = on ? '' : 'none'; });
  return h('div', { class: 'effect' }, h('label', { class: 'effect-head' }, h('span', null, title), chk), content);
}

export function section(title, ...children) {
  return h('section', { class: 'psec' }, title ? h('h4', null, title) : null, ...children);
}
export const row = (...c) => h('div', { class: 'row' }, ...c);
