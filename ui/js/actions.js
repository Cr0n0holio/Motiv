// Åtgärder som används av menyer, paneler, kortkommandon och canvas.
import {
  state, emit, commit, select, selected, getById, createText, createShape, createImage, createGroup, reId, allElements,
} from './state.js';
import { uid, rotatePt, deepClone, loadImage, clamp } from './util.js';
import { syncTextBox, layoutText } from './text.js';
import { ensureTextFont } from './fonts.js';

// ---------- Geometri ----------
export function corners(el) {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  return [[-el.w / 2, -el.h / 2], [el.w / 2, -el.h / 2], [el.w / 2, el.h / 2], [-el.w / 2, el.h / 2]].map(([x, y]) => {
    const p = rotatePt(x, y, el.rotation || 0);
    return { x: cx + p.x, y: cy + p.y };
  });
}
export function aabb(el) {
  const c = corners(el);
  const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
  const l = Math.min(...xs), t = Math.min(...ys), r = Math.max(...xs), b = Math.max(...ys);
  return { l, t, r, b, w: r - l, h: b - t, cx: (l + r) / 2, cy: (t + b) / 2 };
}
export function unionBox(els) {
  if (!els.length) return null;
  const bs = els.map(aabb);
  const l = Math.min(...bs.map((b) => b.l)), t = Math.min(...bs.map((b) => b.t));
  const r = Math.max(...bs.map((b) => b.r)), b = Math.max(...bs.map((b) => b.b));
  return { l, t, r, b, w: r - l, h: b - t, cx: (l + r) / 2, cy: (t + b) / 2 };
}

/** Skalar storleksberoende egenskaper (för gruppskalning, multimarkering, textskalning). */
export function scaleProps(el, s) {
  el.w *= s; el.h *= s;
  const sc = (o, keys) => { if (o) keys.forEach((k) => { if (typeof o[k] === 'number') o[k] *= s; }); };
  sc(el.shadow, ['blur', 'x', 'y']);
  if (el.type === 'text') {
    el.fontSize *= s; el.width *= s;
    sc(el.stroke, ['width']); sc(el.glow, ['blur']);
  } else if (el.type === 'shape') {
    sc(el.stroke, ['width']); el.radius *= s;
  } else if (el.type === 'image') {
    sc(el.border, ['width']); el.radius *= s;
  } else if (el.type === 'group') {
    el.children.forEach((c) => { c.x *= s; c.y *= s; scaleProps(c, s); });
  }
}

// ---------- Lägga till ----------
const pageMin = () => Math.min(state.doc.width, state.doc.height);

export function addElement(el, { at = null, select: sel = true, commitNow = true } = {}) {
  const d = state.doc;
  const c = at || { x: d.width / 2, y: d.height / 2 };
  if (el.type === 'text') syncTextBox(el, 'center');
  el.x = c.x - el.w / 2;
  el.y = c.y - el.h / 2;
  d.elements.push(el);
  if (sel) select([el.id]);
  emit('doc');
  if (commitNow) commit();
  return el;
}

export const TEXT_KINDS = {
  heading: { label: 'Lägg till en rubrik', size: 0.09, weight: 800, text: 'Rubrik' },
  subheading: { label: 'Lägg till en underrubrik', size: 0.05, weight: 600, text: 'Underrubrik' },
  body: { label: 'Lägg till brödtext', size: 0.028, weight: 400, text: 'Lite brödtext som beskriver något intressant.' },
};

export function addText(kind = 'heading', overrides = {}) {
  const k = TEXT_KINDS[kind] || TEXT_KINDS.heading;
  const size = Math.round(pageMin() * k.size);
  const el = createText({
    text: k.text,
    fontSize: size,
    fontWeight: k.weight,
    width: Math.round(state.doc.width * (kind === 'body' ? 0.6 : 0.8)),
    ...overrides,
  });
  if (overrides.fontSize == null && overrides.sizeFactor) el.fontSize = Math.round(pageMin() * overrides.sizeFactor);
  delete el.sizeFactor;
  ensureTextFont(el).then(() => { syncTextBox(el, 'center'); emit('doc'); });
  return addElement(el);
}

/**
 * dash: 'dashed' / 'dotted' för streckade linjer, fill: fyllning,
 * at: mittpunkt (t.ex. vid dra och släpp). Allt blir ett enda ångringssteg.
 */
export function addShape(kind, { dash = null, fill = null, at = null } = {}) {
  const s = pageMin() * 0.3;
  const el = createShape(kind, fill ? { fill } : {});
  if (kind === 'line' || kind === 'arrow') { el.w = s * 1.6; el.h = Math.max(40, s * 0.12); el.stroke.width = Math.max(4, s * 0.03); }
  else { el.w = s; el.h = kind === 'arrowShape' ? s * 0.6 : kind === 'halfCircle' ? s / 2 : kind === 'speech' ? s * 0.8 : s; }
  if (kind === 'rounded') el.radius = s * 0.15;
  if (dash) el.stroke.dash = dash;
  return addElement(el, { at });
}

export async function addAsset(dataURL) {
  const id = uid('a');
  state.doc.assets[id] = dataURL;
  return id;
}

export async function addImageFromDataURL(dataURL, { at = null, name = 'Bild' } = {}) {
  const img = await loadImage(dataURL);
  const id = await addAsset(dataURL);
  const d = state.doc;
  const k = Math.min(1, (d.width * 0.6) / img.naturalWidth, (d.height * 0.6) / img.naturalHeight);
  const el = createImage(id, Math.max(10, img.naturalWidth * k), Math.max(10, img.naturalHeight * k), { name: name.replace(/\.[^.]+$/, '') || 'Bild' });
  emit('assets');
  return addElement(el, { at });
}

// ---------- Markering ----------
export function selectAll() { select(state.doc.elements.filter((e) => e.visible && !e.locked).map((e) => e.id)); }

export function deleteSelection() {
  const ids = new Set(state.selection);
  if (!ids.size) return;
  state.doc.elements = state.doc.elements.filter((e) => !ids.has(e.id) || e.locked);
  select([]);
  emit('doc');
  commit();
}

export function duplicateSelection(offset = null) {
  const els = selected();
  if (!els.length) return [];
  const off = offset ?? pageMin() * 0.02;
  const copies = els.map((e) => { const c = reId(e); c.x += off; c.y += off; c.locked = false; return c; });
  const maxIdx = Math.max(...els.map((e) => state.doc.elements.indexOf(e)));
  state.doc.elements.splice(maxIdx + 1, 0, ...copies);
  select(copies.map((c) => c.id));
  emit('doc');
  commit();
  return copies;
}

const CLIP_MARK = 'motiv-clip:';
export function copySelection() {
  const els = selected();
  if (!els.length) return false;
  const assets = {};
  const walk = (list) => list.forEach((e) => {
    if (e.type === 'image') { assets[e.assetId] = state.doc.assets[e.assetId]; if (e.maskAssetId) assets[e.maskAssetId] = state.doc.assets[e.maskAssetId]; }
    if (e.type === 'group') walk(e.children);
  });
  walk(els);
  const token = uid('c');
  state.clipboard = { token, els: deepClone(els), assets, pasteCount: 0 };
  try { navigator.clipboard?.writeText(CLIP_MARK + token).catch(() => {}); } catch { /* ignore */ }
  return true;
}
export function cutSelection() { if (copySelection()) deleteSelection(); }
export function isInternalClipText(t) { return state.clipboard && t === CLIP_MARK + state.clipboard.token; }

export function pasteInternal() {
  const cb = state.clipboard;
  if (!cb) return;
  Object.assign(state.doc.assets, cb.assets);
  cb.pasteCount++;
  const off = pageMin() * 0.02 * cb.pasteCount;
  const copies = cb.els.map((e) => { const c = reId(e); c.x += off; c.y += off; return c; });
  state.doc.elements.push(...copies);
  select(copies.map((c) => c.id));
  emit('doc');
  commit();
}

// ---------- Ordning ----------
export function arrange(dir) {
  const arr = state.doc.elements;
  const ids = new Set(state.selection);
  if (!ids.size) return;
  const sel = arr.filter((e) => ids.has(e.id));
  const rest = arr.filter((e) => !ids.has(e.id));
  if (dir === 'front') state.doc.elements = [...rest, ...sel];
  else if (dir === 'back') state.doc.elements = [...sel, ...rest];
  else if (dir === 'forward') {
    for (let i = arr.length - 2; i >= 0; i--) if (ids.has(arr[i].id) && !ids.has(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
  } else if (dir === 'backward') {
    for (let i = 1; i < arr.length; i++) if (ids.has(arr[i].id) && !ids.has(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
  }
  emit('doc');
  commit();
}

export function moveLayer(id, toIndex) {
  const arr = state.doc.elements;
  const from = arr.findIndex((e) => e.id === id);
  if (from < 0) return;
  const [el] = arr.splice(from, 1);
  arr.splice(clamp(toIndex, 0, arr.length), 0, el);
  emit('doc');
  commit();
}

// ---------- Justering ----------
export function align(how) {
  const els = selected().filter((e) => !e.locked);
  if (!els.length) return;
  const d = state.doc;
  const ref = els.length === 1 ? { l: 0, t: 0, r: d.width, b: d.height, cx: d.width / 2, cy: d.height / 2 } : unionBox(els);
  for (const el of els) {
    const b = aabb(el);
    if (how === 'left') el.x += ref.l - b.l;
    if (how === 'center') el.x += ref.cx - b.cx;
    if (how === 'right') el.x += ref.r - b.r;
    if (how === 'top') el.y += ref.t - b.t;
    if (how === 'middle') el.y += ref.cy - b.cy;
    if (how === 'bottom') el.y += ref.b - b.b;
  }
  emit('doc');
  commit();
}

export function distribute(axis) {
  const els = selected().filter((e) => !e.locked);
  if (els.length < 3) return;
  const items = els.map((e) => ({ e, b: aabb(e) })).sort((a, b) => (axis === 'h' ? a.b.l - b.b.l : a.b.t - b.b.t));
  const first = items[0].b, last = items[items.length - 1].b;
  const total = items.reduce((s, it) => s + (axis === 'h' ? it.b.w : it.b.h), 0);
  const span = axis === 'h' ? last.r - first.l : last.b - first.t;
  const gap = (span - total) / (items.length - 1);
  let pos = axis === 'h' ? first.l : first.t;
  for (const it of items) {
    if (axis === 'h') { it.e.x += pos - it.b.l; pos += it.b.w + gap; } else { it.e.y += pos - it.b.t; pos += it.b.h + gap; }
  }
  emit('doc');
  commit();
}

// ---------- Grupper ----------
export function groupSelection() {
  const els = selected();
  if (els.length < 2) return;
  const box = unionBox(els);
  const arr = state.doc.elements;
  const idx = Math.max(...els.map((e) => arr.indexOf(e)));
  const children = els.map((e) => { const c = deepClone(e); c.x -= box.l; c.y -= box.t; return c; });
  const g = createGroup(children);
  g.x = box.l; g.y = box.t; g.w = box.w; g.h = box.h;
  const ids = new Set(els.map((e) => e.id));
  const before = arr.slice(0, idx + 1).filter((e) => !ids.has(e.id));
  const after = arr.slice(idx + 1);
  state.doc.elements = [...before, g, ...after];
  select([g.id]);
  emit('doc');
  commit();
}

export function ungroupSelection() {
  const groups = selected().filter((e) => e.type === 'group');
  if (!groups.length) return;
  const newIds = [];
  for (const g of groups) {
    const arr = state.doc.elements;
    const idx = arr.indexOf(g);
    const gcx = g.x + g.w / 2, gcy = g.y + g.h / 2;
    const fx = g.flipX ? -1 : 1, fy = g.flipY ? -1 : 1;
    const kids = g.children.map((c) => {
      const k = deepClone(c);
      // Gruppens spegling flyttar barnets mittpunkt …
      const lc = { x: (c.x + c.w / 2 - g.w / 2) * fx, y: (c.y + c.h / 2 - g.h / 2) * fy };
      const p = rotatePt(lc.x, lc.y, g.rotation || 0);
      k.x = gcx + p.x - k.w / 2;
      k.y = gcy + p.y - k.h / 2;
      // … och spegling × rotation θ = rotation (±θ) × spegling, så barnets
      // rotation byter tecken om exakt en axel är speglad.
      let rot = (g.rotation || 0) + (k.rotation || 0) * fx * fy;
      if (k.type === 'text') {
        // Text kan inte speglas; dubbel spegling motsvarar dock en halv varv
        if (fx < 0 && fy < 0) rot += 180;
      } else {
        k.flipX = !!k.flipX !== (fx < 0);
        k.flipY = !!k.flipY !== (fy < 0);
      }
      k.rotation = ((rot % 360) + 540) % 360 - 180;
      k.opacity = (k.opacity ?? 1) * (g.opacity ?? 1);
      newIds.push(k.id);
      return k;
    });
    arr.splice(idx, 1, ...kids);
  }
  select(newIds);
  emit('doc');
  commit();
}

// ---------- Övrigt ----------
export function toggleLock() {
  const els = selected();
  if (!els.length) return;
  const lock = !els.every((e) => e.locked);
  els.forEach((e) => { e.locked = lock; });
  emit('doc');
  commit();
}

export function flip(axis) {
  selected().filter((e) => !e.locked && e.type !== 'text').forEach((e) => {
    if (axis === 'x') e.flipX = !e.flipX; else e.flipY = !e.flipY;
  });
  emit('doc');
  commit();
}

export function nudge(dx, dy) {
  const els = selected().filter((e) => !e.locked);
  if (!els.length) return;
  els.forEach((e) => { e.x += dx; e.y += dy; });
  emit('doc');
  nudgeCommit();
}
let nudgeT;
function nudgeCommit() { clearTimeout(nudgeT); nudgeT = setTimeout(commit, 350); }

export function setImageAsBackground(el) {
  if (!el || el.type !== 'image') return;
  state.doc.background.image = { assetId: el.assetId, maskAssetId: el.maskAssetId, filters: deepClone(el.filters), opacity: 1 };
  state.doc.elements = state.doc.elements.filter((e) => e.id !== el.id);
  select([]);
  emit('doc');
  commit();
}

export function detachBackgroundImage() {
  const bg = state.doc.background.image;
  if (!bg) return;
  const el = createImage(bg.assetId, state.doc.width, state.doc.height, { maskAssetId: bg.maskAssetId, filters: deepClone(bg.filters) });
  state.doc.background.image = null;
  state.doc.elements.unshift(el);
  el.x = 0; el.y = 0;
  select([el.id]);
  emit('doc');
  commit();
}

/**
 * Flyttar element från en sida i storleken ow×oh till en i storleken w×h.
 * scale: skala proportionellt och centrera, annars bara centrera.
 */
export function fitElements(elements, ow, oh, w, h, scale = true) {
  if (scale) {
    const s = Math.min(w / ow, h / oh);
    const offX = (w - ow * s) / 2, offY = (h - oh * s) / 2;
    for (const el of elements) {
      const cx = (el.x + el.w / 2) * s + offX, cy = (el.y + el.h / 2) * s + offY;
      scaleProps(el, s);
      el.x = cx - el.w / 2; el.y = cy - el.h / 2;
      if (el.type === 'text') syncTextBox(el, 'center');
    }
  } else {
    const offX = (w - ow) / 2, offY = (h - oh) / 2;
    for (const el of elements) { el.x += offX; el.y += offY; }
  }
}

/** Ändrar storlek på alla sidor; skalar ev. innehållet proportionellt. */
export function resizeDocument(w, h, dpi, scaleContent) {
  const d = state.doc;
  w = Math.round(clamp(w, 16, 20000)); h = Math.round(clamp(h, 16, 20000));
  for (const p of d.pages) fitElements(p.elements, d.width, d.height, w, h, scaleContent);
  d.width = w; d.height = h;
  if (dpi) d.dpi = dpi;
  emit('doc');
  emit('doc:resized');
  commit();
}

export function relayoutAllText(elements = allElements()) {
  const walk = (list) => list.forEach((e) => {
    if (e.type === 'text') { layoutText(e); syncTextBox(e, isCurvedText(e) ? 'center' : 'top'); }
    if (e.type === 'group') walk(e.children);
  });
  walk(elements);
}
const isCurvedText = (e) => e.curve && e.curve.mode !== 'none';

export { getById };
