// Färgväljare med HSV-yta, nyans, alfa, hex, pipett, dokumentfärger och
// gradientredigerare (linjär/radiell, flera stopp, vinkel).
import { h, parseColor, toHex, rgbToHsv, hsvToRgb, clamp, deepClone } from './util.js';
import { state, allElements } from './state.js';
import { addPaletteColor, removePaletteColor } from './actions.js';
import { paintCss, GRADIENT_PRESETS } from './paint.js';

const PALETTE = [
  '#000000', '#3f3f46', '#71717a', '#a1a1aa', '#d4d4d8', '#ffffff',
  '#ef4444', '#f97316', '#f59e0b', '#facc15', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#7c2d12',
];

let pop = null;
let outsideHandler = null;

export function closeColorPicker() {
  if (!pop) return;
  pop.onClose?.();
  pop.el.remove();
  pop = null;
  document.removeEventListener('pointerdown', outsideHandler, true);
}

function docColors() {
  const set = new Set();
  const addPaint = (p) => {
    if (!p) return;
    if (p.type === 'solid') set.add(p.color.toLowerCase());
    else if (p.stops) p.stops.forEach((s) => set.add(s.color.toLowerCase()));
  };
  const walk = (els) => els.forEach((e) => {
    addPaint(e.fill);
    if (e.stroke?.enabled) set.add(e.stroke.color.toLowerCase());
    if (e.type === 'group') walk(e.children);
  });
  // Färger från alla sidor, så att samma färger är lätta att återanvända
  walk(allElements());
  state.doc.pages.forEach((p) => addPaint(p.background.fill));
  return [...set].filter((c) => c.length <= 9).slice(0, 18);
}

function pushRecent(c) {
  state.recentColors = [c, ...state.recentColors.filter((x) => x !== c)].slice(0, 12);
}

/**
 * Öppnar färgväljaren vid ett ankarelement.
 * opts: { value, allowGradient, allowNone, onChange(value, final) }
 * value är en färgsträng, eller en paint ({type, ...}) om allowGradient.
 */
export function openColorPicker(anchor, opts) {
  if (pop && pop.anchor === anchor) { closeColorPicker(); return; }
  closeColorPicker();
  const isPaint = !!opts.allowGradient;
  let paint = isPaint ? deepClone(opts.value || { type: 'solid', color: '#000000' }) : { type: 'solid', color: opts.value || '#000000' };
  if (paint.type === 'none') paint = { type: 'solid', color: '#00000000' };
  let stopIdx = 0;
  const curColor = () => (paint.type === 'solid' ? paint.color : paint.stops[stopIdx].color);
  let hsv = rgbToHsv(parseColor(curColor()));
  let alpha = parseColor(curColor()).a;

  const emitChange = (final) => {
    const v = isPaint ? deepClone(paint) : paint.color;
    opts.onChange(v, final);
    if (final) pushRecent(curColor());
  };
  const setCur = (c, final = false) => {
    if (paint.type === 'solid') paint.color = c; else paint.stops[stopIdx].color = c;
    emitChange(final);
    sync();
  };

  // --- Delar ---
  const sv = h('canvas', { class: 'cp-sv', width: 232, height: 150 });
  const svDot = h('div', { class: 'cp-sv-dot' });
  const svWrap = h('div', { class: 'cp-sv-wrap' }, sv, svDot);
  const hue = h('input', { type: 'range', class: 'cp-hue', min: 0, max: 360, step: 1 });
  const alphaR = h('input', { type: 'range', class: 'cp-alpha', min: 0, max: 100, step: 1 });
  const alphaWrap = h('div', { class: 'cp-alpha-wrap' }, alphaR);
  const hex = h('input', { class: 'cp-hex', spellcheck: false, maxLength: 9 });
  const alphaNum = h('input', { class: 'cp-alpha-num', type: 'number', min: 0, max: 100 });
  const eyeBtn = 'EyeDropper' in window ? h('button', { class: 'icon-btn', title: 'Pipett – hämta färg från skärmen', html: '<svg viewBox="0 0 24 24"><path d="M19.4 4.6a2.6 2.6 0 0 0-3.7 0l-2.4 2.4-1-1-1.4 1.4 1 1L4.6 15.7A2 2 0 0 0 4 17.1V20h2.9a2 2 0 0 0 1.4-.6l7.3-7.3 1 1 1.4-1.4-1-1 2.4-2.4a2.6 2.6 0 0 0 0-3.7z"/></svg>' }) : null;

  const gradBar = h('div', { class: 'cp-grad-bar' });
  const gradAngle = h('input', { type: 'number', class: 'cp-angle', min: 0, max: 360, step: 5 });
  const gradType = h('select', { class: 'cp-gtype' }, h('option', { value: 'linear' }, 'Linjär'), h('option', { value: 'radial' }, 'Radiell'));
  const gradSection = h('div', { class: 'cp-grad' },
    gradBar,
    h('div', { class: 'cp-row' }, gradType, h('label', { class: 'cp-angle-l' }, 'Vinkel', gradAngle, '°'),
      h('button', { class: 'btn small', title: 'Vänd gradienten', onclick: () => { paint.stops.forEach((s) => { s.offset = 1 - s.offset; }); emitChange(true); sync(); } }, '⇄'),
      h('button', { class: 'btn small', title: 'Ta bort valt stopp', onclick: () => { if (paint.stops.length > 2) { paint.stops.splice(stopIdx, 1); stopIdx = 0; loadCur(); emitChange(true); sync(); } } }, '−')),
    h('div', { class: 'cp-presets' }, GRADIENT_PRESETS.map((g) => h('button', { class: 'cp-preset', style: { background: paintCss(g) }, onclick: () => { paint = deepClone(g); stopIdx = 0; loadCur(); emitChange(true); sync(); } }))),
  );

  const tabs = isPaint ? h('div', { class: 'seg cp-tabs' },
    h('button', { 'data-t': 'solid', onclick: () => toSolid() }, 'Enfärg'),
    h('button', { 'data-t': 'grad', onclick: () => toGradient() }, 'Gradient'),
    opts.allowNone ? h('button', { 'data-t': 'none', onclick: () => { opts.onChange({ type: 'none' }, true); closeColorPicker(); } }, 'Ingen') : null,
  ) : null;

  const swatches = (list) => h('div', { class: 'cp-swatches' }, list.map((c) => h('button', {
    class: 'cp-sw', title: c, style: { '--c': c },
    onclick: () => { hsv = rgbToHsv(parseColor(c)); alpha = parseColor(c).a; setCur(c, true); },
  })));

  const el = h('div', { class: 'popover color-pop' },
    tabs,
    isPaint ? gradSection : null,
    svWrap,
    h('div', { class: 'cp-row' }, h('div', { class: 'cp-sliders' }, hue, alphaWrap), eyeBtn),
    h('div', { class: 'cp-row' }, h('span', { class: 'cp-preview' }), hex, alphaNum, h('span', { class: 'muted' }, '%')),
    opts.allowNone && !isPaint ? h('button', { class: 'btn small full', onclick: () => { setCur('#00000000', true); } }, 'Genomskinlig') : null,
    h('div', { class: 'cp-label' }, 'Designens palett', h('span', { class: 'muted cp-hint' }, ' · högerklick tar bort')),
    paletteRow(),
    h('div', { class: 'cp-label' }, 'Dokumentfärger'),
    swatches(docColors()),
    state.recentColors.length ? h('div', { class: 'cp-label' }, 'Senaste') : null,
    state.recentColors.length ? swatches(state.recentColors) : null,
    h('div', { class: 'cp-label' }, 'Standardfärger'),
    swatches(PALETTE),
  );

  // Paletten: klick väljer, högerklick tar bort, + sparar aktuell färg
  function paletteRow() {
    const row = h('div', { class: 'cp-swatches cp-palette' });
    const fill = () => {
      row.innerHTML = '';
      state.doc.palette.forEach((c, i) => {
        const b = h('button', { class: 'cp-sw', title: `${c} (högerklick tar bort)`, style: { '--c': c }, onclick: () => { hsv = rgbToHsv(parseColor(c)); alpha = parseColor(c).a; setCur(c, true); } });
        b.addEventListener('contextmenu', (e) => { e.preventDefault(); removePaletteColor(i); fill(); });
        row.append(b);
      });
      row.append(h('button', { class: 'cp-sw cp-add', title: 'Spara färgen i designens palett', onclick: () => { addPaletteColor(curColor()); fill(); } }, '+'));
    };
    fill();
    return row;
  }

  // --- Rita HSV-ytan ---
  const svCtx = sv.getContext('2d');
  function drawSV() {
    const base = hsvToRgb({ h: hsv.h, s: 1, v: 1 });
    svCtx.fillStyle = `rgb(${base.r},${base.g},${base.b})`;
    svCtx.fillRect(0, 0, sv.width, sv.height);
    const gw = svCtx.createLinearGradient(0, 0, sv.width, 0);
    gw.addColorStop(0, '#fff'); gw.addColorStop(1, 'rgba(255,255,255,0)');
    svCtx.fillStyle = gw; svCtx.fillRect(0, 0, sv.width, sv.height);
    const gb = svCtx.createLinearGradient(0, 0, 0, sv.height);
    gb.addColorStop(0, 'rgba(0,0,0,0)'); gb.addColorStop(1, '#000');
    svCtx.fillStyle = gb; svCtx.fillRect(0, 0, sv.width, sv.height);
  }
  const fromHsv = () => toHex({ ...hsvToRgb(hsv), a: alpha });
  function loadCur() { const c = parseColor(curColor()); hsv = rgbToHsv(c); alpha = c.a; }

  function drawGradBar() {
    gradBar.innerHTML = '';
    gradBar.style.background = `linear-gradient(90deg, ${[...paint.stops].sort((a, b) => a.offset - b.offset).map((s) => `${s.color} ${s.offset * 100}%`).join(',')})`;
    paint.stops.forEach((s, i) => {
      const k = h('div', { class: 'cp-stop' + (i === stopIdx ? ' active' : ''), style: { left: `${s.offset * 100}%`, '--c': s.color } });
      k.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        stopIdx = i; loadCur(); sync();
        const r = gradBar.getBoundingClientRect();
        const mv = (ev) => { paint.stops[i].offset = clamp((ev.clientX - r.left) / r.width, 0, 1); emitChange(false); sync(); };
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); emitChange(true); };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
      });
      gradBar.append(k);
    });
  }
  gradBar.addEventListener('pointerdown', (e) => {
    // Klick på listen lägger till ett stopp
    const r = gradBar.getBoundingClientRect();
    const off = clamp((e.clientX - r.left) / r.width, 0, 1);
    paint.stops.push({ offset: off, color: curColor() });
    stopIdx = paint.stops.length - 1;
    emitChange(true); sync();
  });

  function sync() {
    drawSV();
    svDot.style.left = `${hsv.s * 100}%`;
    svDot.style.top = `${(1 - hsv.v) * 100}%`;
    hue.value = hsv.h;
    alphaR.value = Math.round(alpha * 100);
    const c = curColor();
    alphaWrap.style.setProperty('--c', toHex({ ...parseColor(c), a: 1 }));
    if (document.activeElement !== hex) hex.value = c.toUpperCase();
    if (document.activeElement !== alphaNum) alphaNum.value = Math.round(alpha * 100);
    el.querySelector('.cp-preview').style.setProperty('--c', c);
    if (tabs) tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', (b.dataset.t === 'solid' && paint.type === 'solid') || (b.dataset.t === 'grad' && paint.type !== 'solid')));
    gradSection.style.display = paint.type === 'solid' ? 'none' : '';
    if (paint.type !== 'solid') {
      drawGradBar();
      gradType.value = paint.type;
      gradAngle.value = paint.angle ?? 90;
      gradAngle.disabled = paint.type === 'radial';
    }
  }

  function toSolid() {
    if (paint.type === 'solid') return;
    paint = { type: 'solid', color: paint.stops[0].color };
    stopIdx = 0; loadCur(); emitChange(true); sync();
  }
  function toGradient() {
    if (paint.type !== 'solid') return;
    const c = paint.color;
    const p = parseColor(c);
    const c2 = toHex({ ...hsvToRgb({ ...rgbToHsv(p), h: (rgbToHsv(p).h + 50) % 360, s: Math.max(0.5, rgbToHsv(p).s), v: Math.max(0.6, rgbToHsv(p).v) }), a: p.a });
    paint = { type: 'linear', angle: 90, stops: [{ offset: 0, color: c }, { offset: 1, color: c2 }] };
    stopIdx = 0; loadCur(); emitChange(true); sync();
  }

  // --- Händelser ---
  const svPick = (e, final) => {
    const r = sv.getBoundingClientRect();
    hsv.s = clamp((e.clientX - r.left) / r.width, 0, 1);
    hsv.v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    setCur(fromHsv(), final);
  };
  svWrap.addEventListener('pointerdown', (e) => {
    svPick(e, false);
    const mv = (ev) => svPick(ev, false);
    const up = (ev) => { svPick(ev, true); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  });
  hue.addEventListener('input', () => { hsv.h = +hue.value; setCur(fromHsv(), false); });
  hue.addEventListener('change', () => emitChange(true));
  alphaR.addEventListener('input', () => { alpha = +alphaR.value / 100; setCur(fromHsv(), false); });
  alphaR.addEventListener('change', () => emitChange(true));
  alphaNum.addEventListener('change', () => { alpha = clamp(+alphaNum.value, 0, 100) / 100; setCur(fromHsv(), true); });
  hex.addEventListener('change', () => {
    let v = hex.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) {
      const c = parseColor(v); hsv = rgbToHsv(c); alpha = c.a; setCur(toHex(c), true);
    } else sync();
  });
  hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') hex.blur(); });
  gradAngle.addEventListener('input', () => { paint.angle = +gradAngle.value; emitChange(false); });
  gradAngle.addEventListener('change', () => emitChange(true));
  gradType.addEventListener('change', () => { paint.type = gradType.value; if (paint.type === 'linear') paint.angle ??= 90; emitChange(true); sync(); });
  if (eyeBtn) eyeBtn.addEventListener('click', async () => {
    try {
      const r = await new window.EyeDropper().open();
      const c = parseColor(r.sRGBHex);
      hsv = rgbToHsv(c); alpha = 1;
      setCur(toHex(c), true);
    } catch { /* avbrutet */ }
  });

  document.body.append(el);
  // Placering
  const ar = anchor.getBoundingClientRect();
  const pr = el.getBoundingClientRect();
  let left = ar.left - pr.width - 12;
  if (left < 8) left = Math.min(window.innerWidth - pr.width - 8, ar.right + 12);
  let top = clamp(ar.top - 40, 8, window.innerHeight - pr.height - 8);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  pop = { el, anchor, onClose: opts.onClose };
  outsideHandler = (e) => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeColorPicker(); };
  setTimeout(() => document.addEventListener('pointerdown', outsideHandler, true), 0);
  sync();
}
