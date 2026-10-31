// Editorns canvas: rendering, zoom/panorering, markering, flytta/skala/
// rotera, fästlinjer, textredigering direkt på canvasen och beskärning.
import { state, emit, on, commit, select, selected, getById, single, markDirty, pageView, groupMatrix } from './state.js';
import { rad, deg, rotatePt, clamp, deepClone } from './util.js';
import { renderDoc, drawElement } from './render.js';
import { layoutText, syncTextBox, isCurved, fontString, letterSpacingPx, textHitPad } from './text.js';
import { aabb, unionBox, scaleProps, corners, duplicateSelection, enterGroup, exitGroup } from './actions.js';
import { getImage, sourceSize, alphaAt } from './images.js';
import { maskD } from './shapes.js';
import { paintIsVisible } from './paint.js';

let canvas, ctx, host, dpr = 1;
let needsRender = false;
let hoverId = null;
let drag = null;
let guides = [];
let marquee = null;
let spaceDown = false;
let textarea = null;
let liveInfo = null; // text vid storleksändring/rotation

const ACCENT = '#8b5cf6';
const HANDLE = 9;
const ROT_OFFSET = 30;

export function initEditor(hostEl) {
  host = hostEl;
  canvas = document.createElement('canvas');
  canvas.className = 'stage-canvas';
  canvas.tabIndex = 0;
  host.append(canvas);
  ctx = canvas.getContext('2d');

  new ResizeObserver(resize).observe(host);
  resize();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onHover);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerleave', () => { if (hoverId) { hoverId = null; requestRender(); } });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isTyping(e)) { if (!spaceDown) { spaceDown = true; canvas.style.cursor = 'grab'; } e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; canvas.style.cursor = ''; } });

  on('doc', requestRender);
  on('doc:live', requestRender);
  on('render', requestRender);
  on('selection', () => { if (state.cropId && !state.selection.includes(state.cropId)) finishCrop(true); requestRender(); });
  on('fonts', () => { requestRender(); if (textarea) positionTextarea(); });
  on('image-loaded', requestRender);
  on('group', requestRender);
  on('doc:replaced', () => { finishTextEdit(); requestAnimationFrame(fitToScreen); });
  on('doc:resized', () => requestAnimationFrame(fitToScreen));
}

export const isTyping = (e) => {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

function resize() {
  dpr = window.devicePixelRatio || 1;
  const r = host.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  canvas.style.width = r.width + 'px';
  canvas.style.height = r.height + 'px';
  // Tills användaren zoomar eller panorerar själv följer sidan med när
  // fönstret ändrar storlek (t.ex. maximeras)
  if ((!state._fitted || state._autoFit) && r.width > 50) { state._fitted = true; fitToScreen(); }
  requestRender();
}

// ---------- Vy ----------
// Sidans koordinater <-> skärmen
const pageToScreen = (x, y) => ({ x: x * state.zoom + state.panX, y: y * state.zoom + state.panY });
const screenToPage = (x, y) => ({ x: (x - state.panX) / state.zoom, y: (y - state.panY) / state.zoom });
// "Dokumentkoordinater" är de markerade elementens: sidans, eller den öppnade
// gruppens egna när man redigerar inuti en grupp. All flytt, skalning och
// rotation räknas där, så samma kod fungerar på båda nivåerna.
const inGroup = () => state.doc.groupPath.length > 0;
export const docToScreen = (x, y) => {
  if (!inGroup()) return pageToScreen(x, y);
  const p = groupMatrix().transformPoint(new DOMPoint(x, y));
  return pageToScreen(p.x, p.y);
};
export const screenToDoc = (x, y) => {
  const p = screenToPage(x, y);
  if (!inGroup()) return p;
  const q = groupMatrix().inverse().transformPoint(new DOMPoint(p.x, p.y));
  return { x: q.x, y: q.y };
};
/** Den öppnade gruppens rotation på skärmen (för handtag och markörer). */
const scopeRot = () => { if (!inGroup()) return 0; const m = groupMatrix(); return deg(Math.atan2(m.b, m.a)); };

/** Öppnar gruppen under pekaren och markerar delen man pekade på. */
function enterGroupAt(g, s) {
  enterGroup(g);
  const d = screenToDoc(s.x, s.y);
  const child = hitTest(d.x, d.y);
  select(child ? [child.id] : []);
}

/** Lämnar en öppnad grupp (Esc, klick utanför, Klar-knappen). */
export function exitGroupEditing() {
  if (!inGroup()) return;
  finishTextEdit();
  finishCrop(true);
  exitGroup();
  requestRender();
}
const viewW = () => canvas.width / dpr;
const viewH = () => canvas.height / dpr;

export function fitToScreen() {
  if (!canvas) return;
  const pad = 60;
  const z = Math.min((viewW() - pad * 2) / state.doc.width, (viewH() - pad * 2) / state.doc.height);
  state.zoom = clamp(z, 0.02, 8);
  state.panX = (viewW() - state.doc.width * state.zoom) / 2;
  state.panY = (viewH() - state.doc.height * state.zoom) / 2;
  state._autoFit = true;
  emit('zoom');
  requestRender();
  if (textarea) positionTextarea();
}

export function zoomTo(z, sx = viewW() / 2, sy = viewH() / 2) {
  z = clamp(z, 0.02, 16);
  state._autoFit = false;
  const d = screenToPage(sx, sy);
  state.zoom = z;
  state.panX = sx - d.x * z;
  state.panY = sy - d.y * z;
  emit('zoom');
  requestRender();
  if (textarea) positionTextarea();
}
export const zoomBy = (f) => zoomTo(state.zoom * f);

function onWheel(e) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const r = canvas.getBoundingClientRect();
    zoomTo(state.zoom * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
  } else {
    state._autoFit = false;
    state.panX -= e.shiftKey ? e.deltaY : e.deltaX;
    state.panY -= e.shiftKey ? 0 : e.deltaY;
    requestRender();
    if (textarea) positionTextarea();
  }
}

// ---------- Rendering ----------
export function requestRender() {
  if (needsRender) return;
  needsRender = true;
  requestAnimationFrame(frame);
}

function drawChecker(c, x, y, w, h) {
  const s = 10;
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = '#ffffff'; c.fillRect(x, y, w, h);
  c.fillStyle = '#e6e6ea';
  for (let yy = 0; yy < h; yy += s) for (let xx = (Math.floor(yy / s) % 2) * s; xx < w; xx += s * 2) c.fillRect(x + xx, y + yy, s, s);
  c.restore();
}

function frame() {
  needsRender = false;
  if (!canvas) return;
  const d = state.doc, z = state.zoom;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const px = state.panX, py = state.panY, pw = d.width * z, ph = d.height * z;

  // Sidans skugga + rutmönster för genomskinlighet
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#fff'; ctx.fillRect(px, py, pw, ph);
  ctx.restore();
  if (!paintIsVisible(d.background.fill) || (d.background.fill.type === 'solid' && d.background.fill.color.length > 7)) drawChecker(ctx, px, py, pw, ph);

  const S = dpr * z;
  // Markerade element som sticker ut utanför sidan visas svagt
  const sel = selected();
  if (sel.length) {
    ctx.save();
    ctx.setTransform(S, 0, 0, S, dpr * px, dpr * py);
    ctx.globalAlpha = 0.28;
    if (inGroup()) { const m = groupMatrix(); ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f); }
    for (const el of sel) drawElement(ctx, el, S);
    ctx.restore();
  }
  // Krop-läge: hela bilden svagt
  const cropEl = state.cropId ? getById(state.cropId) : null;
  if (cropEl) drawCropGhost(cropEl, S, px, py);

  ctx.save();
  ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
  ctx.setTransform(S, 0, 0, S, dpr * px, dpr * py);
  renderDoc(ctx, pageView(d, d.pageIndex), S, {});
  ctx.restore();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawOverlay();
}

function drawCropGhost(el, S, px, py) {
  const c = el.crop;
  const Fw = el.w / c.w, Fh = el.h / c.h;
  const img = getImage(el.assetId);
  if (!img) return;
  ctx.save();
  ctx.setTransform(S, 0, 0, S, dpr * px, dpr * py);
  if (inGroup()) { const m = groupMatrix(); ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f); }
  ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
  ctx.rotate(rad(el.rotation || 0));
  ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
  ctx.translate(-el.w / 2, -el.h / 2);
  ctx.globalAlpha = 0.35;
  ctx.drawImage(img, -c.x * Fw, -c.y * Fh, Fw, Fh);
  ctx.restore();
}

// Ram för markeringen: { cx, cy, w, h, rot } i dokumentkoordinater
export function selectionFrame() {
  const els = selected();
  if (!els.length) return null;
  if (els.length === 1) {
    const el = els[0];
    return { cx: el.x + el.w / 2, cy: el.y + el.h / 2, w: el.w, h: el.h, rot: el.rotation || 0, el };
  }
  const b = unionBox(els);
  return { cx: b.cx, cy: b.cy, w: b.w, h: b.h, rot: 0, el: null };
}

function frameCornersScreen(f, pad = 0) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const p = rotatePt(sx * (f.w / 2 + pad / state.zoom), sy * (f.h / 2 + pad / state.zoom), f.rot);
    return docToScreen(f.cx + p.x, f.cy + p.y);
  });
}

function strokePoly(pts, color, width = 1.5, dash = null) {
  ctx.save();
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  if (dash) ctx.setLineDash(dash);
  ctx.stroke();
  ctx.restore();
}

/** Vilka handtag som visas för en markering. */
function handlesFor(f) {
  const el = f.el;
  const all = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  if (!el) return ['nw', 'ne', 'se', 'sw'];
  if (el.locked) return [];
  if (el.type === 'text') return isCurved(el) ? ['nw', 'ne', 'se', 'sw'] : ['nw', 'ne', 'se', 'sw', 'e', 'w'];
  if (el.type === 'group' || el.type === 'icon' || el.type === 'qr') return ['nw', 'ne', 'se', 'sw'];
  if (el.type === 'shape' && (el.kind === 'line' || el.kind === 'arrow')) return ['e', 'w'];
  return all;
}
const HDIR = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };

function handlePositions(f) {
  const out = [];
  for (const k of handlesFor(f)) {
    const [dx, dy] = HDIR[k];
    const p = rotatePt((dx * f.w) / 2, (dy * f.h) / 2, f.rot);
    out.push({ k, dx, dy, ...docToScreen(f.cx + p.x, f.cy + p.y) });
  }
  return out;
}
function rotHandlePos(f) {
  const p = rotatePt(0, f.h / 2, f.rot);
  const base = docToScreen(f.cx + p.x, f.cy + p.y);
  const dir = rotatePt(0, 1, f.rot);
  return { x: base.x + dir.x * ROT_OFFSET, y: base.y + dir.y * ROT_OFFSET };
}

function drawOverlay() {
  // Hovring
  if (hoverId && !state.selection.includes(hoverId) && !drag) {
    const el = getById(hoverId);
    if (el) strokePoly(corners(el).map((p) => docToScreen(p.x, p.y)), ACCENT, 1.5);
  }

  // Öppnad grupp: streckad ram runt gruppens innehåll
  if (inGroup() && state.doc.elements.length) {
    const b = unionBox(state.doc.elements);
    const pad = 6 / state.zoom;
    strokePoly([[b.l - pad, b.t - pad], [b.r + pad, b.t - pad], [b.r + pad, b.b + pad], [b.l - pad, b.b + pad]].map(([x, y]) => docToScreen(x, y)), 'rgba(139,92,246,0.9)', 1.5, [6, 5]);
  }

  if (state.cropId) { drawCropOverlay(); return; }

  const f = selectionFrame();
  if (f && !state.editingTextId) {
    const els = selected();
    if (els.length > 1) for (const el of els) strokePoly(corners(el).map((p) => docToScreen(p.x, p.y)), 'rgba(139,92,246,0.55)', 1);
    const locked = els.some((e) => e.locked);
    strokePoly(frameCornersScreen(f), locked ? '#f59e0b' : ACCENT, 2, els.length > 1 ? [5, 4] : null);
    const small = f.w * state.zoom < 24 && f.h * state.zoom < 24;
    if (!locked && !drag?.hideHandles) {
      // Rotationshandtag
      const rp = rotHandlePos(f);
      ctx.save();
      ctx.beginPath(); ctx.arc(rp.x, rp.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 4; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5; ctx.stroke();
      // pilsymbol
      ctx.beginPath(); ctx.arc(rp.x, rp.y, 4.2, -Math.PI * 0.15, Math.PI * 1.35); ctx.strokeStyle = '#333'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.restore();

      for (const hp of handlePositions(f)) {
        if (small && hp.k.length === 1) continue;
        ctx.save();
        ctx.translate(hp.x, hp.y);
        ctx.rotate(rad(f.rot + scopeRot()));
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 4;
        ctx.beginPath();
        if (hp.k.length === 1) {
          const horiz = hp.k === 'n' || hp.k === 's';
          ctx.roundRect(horiz ? -9 : -3.5, horiz ? -3.5 : -9, horiz ? 18 : 7, horiz ? 7 : 18, 3.5);
        } else ctx.arc(0, 0, HANDLE / 2 + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
      }
    }
  }

  // Fästlinjer
  if (guides.length) {
    ctx.save();
    ctx.strokeStyle = '#ff3d9a';
    ctx.lineWidth = 1;
    for (const g of guides) {
      ctx.beginPath();
      if (g.axis === 'x') { const a = docToScreen(g.pos, g.from), b = docToScreen(g.pos, g.to); ctx.moveTo(Math.round(a.x) + 0.5, a.y); ctx.lineTo(Math.round(b.x) + 0.5, b.y); }
      else { const a = docToScreen(g.from, g.pos), b = docToScreen(g.to, g.pos); ctx.moveTo(a.x, Math.round(a.y) + 0.5); ctx.lineTo(b.x, Math.round(b.y) + 0.5); }
      ctx.stroke();
    }
    ctx.restore();
  }

  if (marquee) {
    const a = docToScreen(marquee.x0, marquee.y0), b = docToScreen(marquee.x1, marquee.y1);
    ctx.save();
    ctx.fillStyle = 'rgba(139,92,246,0.12)';
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.restore();
  }

  if (liveInfo && drag) {
    ctx.save();
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    const tw = ctx.measureText(liveInfo).width + 16;
    const x = drag.lastScreen.x + 16, y = drag.lastScreen.y + 18;
    ctx.fillStyle = 'rgba(20,20,26,0.92)';
    ctx.beginPath(); ctx.roundRect(x, y, tw, 24, 6); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(liveInfo, x + 8, y + 16);
    ctx.restore();
  }
}

// ---------- Träffytor ----------
function toLocal(el, x, y) {
  const p = rotatePt(x - (el.x + el.w / 2), y - (el.y + el.h / 2), -(el.rotation || 0));
  return { x: p.x + el.w / 2, y: p.y + el.h / 2 };
}

function hitElement(el, x, y) {
  if (!el.visible) return false;
  const l = toLocal(el, x, y);
  const tol = 4 / state.zoom;
  let px = tol, py = tol;
  if (el.type === 'text') { const p = textHitPad(el); px += p.px; py += p.py; }
  if (el.type === 'shape' && (el.kind === 'line' || el.kind === 'arrow')) py = Math.max(py, 8 / state.zoom);
  return l.x >= -px && l.x <= el.w + px && l.y >= -py && l.y <= el.h + py;
}

export function hitTest(x, y) {
  const els = state.doc.elements;
  for (let i = els.length - 1; i >= 0; i--) if (hitElement(els[i], x, y) && !transparentAt(els[i], x, y)) return els[i];
  return null;
}

const shapeCtx = document.createElement('canvas').getContext('2d');

/**
 * Är bilden genomskinlig i punkten? Då går klicket igenom till det som ligger
 * bakom – t.ex. runt en person vars bakgrund har tagits bort, eller utanför
 * en cirkelformad bild.
 */
function transparentAt(el, x, y) {
  if (el.type !== 'image') return false;
  const l = toLocal(el, x, y);
  if (l.x < 0 || l.y < 0 || l.x > el.w || l.y > el.h) return false; // i klickmarginalen
  if (el.maskShape && el.maskShape !== 'none' && !shapeCtx.isPointInPath(new Path2D(maskD(el.maskShape, el.w, el.h, el.radius || 0)), l.x, l.y)) return true;
  const sx = el.flipX ? el.w - l.x : l.x, sy = el.flipY ? el.h - l.y : l.y;
  const c = el.crop || { x: 0, y: 0, w: 1, h: 1 };
  return alphaAt(el.assetId, el.maskAssetId, c.x + (sx / el.w) * c.w, c.y + (sy / el.h) * c.h) < 16;
}

function hitHandle(f, sx, sy) {
  if (!f || selected().some((e) => e.locked)) return null;
  const rp = rotHandlePos(f);
  if (Math.hypot(sx - rp.x, sy - rp.y) <= 11) return { k: 'rot' };
  for (const hp of handlePositions(f)) if (Math.hypot(sx - hp.x, sy - hp.y) <= 9) return hp;
  return null;
}

function pointInFrame(f, x, y) {
  const p = rotatePt(x - f.cx, y - f.cy, -f.rot);
  return Math.abs(p.x) <= f.w / 2 && Math.abs(p.y) <= f.h / 2;
}

const CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
function cursorFor(hp, rot) {
  if (hp.k === 'rot') return 'grab';
  const a = (deg(Math.atan2(hp.dy, hp.dx)) + rot + 360 + 90) % 180; // 0 = vertikal
  return CURSORS[Math.round(a / 45) % 4];
}

// ---------- Pekare ----------
function screenPt(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onHover(e) {
  if (drag) return;
  const s = screenPt(e);
  const d = screenToDoc(s.x, s.y);
  if (spaceDown) return;
  if (state.cropId) { canvas.style.cursor = cropCursor(s, d); return; }
  const f = selectionFrame();
  const hp = f && !state.editingTextId ? hitHandle(f, s.x, s.y) : null;
  if (hp) { canvas.style.cursor = cursorFor(hp, f.rot + scopeRot()); setHover(null); return; }
  const hit = hitTest(d.x, d.y);
  canvas.style.cursor = hit ? (hit.locked ? 'default' : 'move') : 'default';
  setHover(hit ? hit.id : null);
}
function setHover(id) { if (id !== hoverId) { hoverId = id; requestRender(); } }

function snapshotSel() {
  return selected().map((el) => ({ id: el.id, el: deepClone(el) }));
}

function onDown(e) {
  canvas.focus({ preventScroll: true });
  const s = screenPt(e);
  let d = screenToDoc(s.x, s.y);
  hideContextMenu();

  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    drag = { type: 'pan', sx: e.clientX, sy: e.clientY, px: state.panX, py: state.panY, lastScreen: s };
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (state.editingTextId) finishTextEdit();

  if (e.button === 2) {
    let hit = hitTest(d.x, d.y);
    if (!hit && inGroup()) { exitGroupEditing(); d = screenToDoc(s.x, s.y); hit = hitTest(d.x, d.y); }
    if (hit && !state.selection.includes(hit.id)) select([hit.id]);
    if (!hit) select([]);
    return; // contextmenu-händelsen visar menyn
  }
  if (e.button !== 0) return;

  if (state.cropId) { if (cropDown(e, s, d)) return; }

  const f = selectionFrame();
  const hp = hitHandle(f, s.x, s.y);
  if (hp) {
    canvas.setPointerCapture(e.pointerId);
    if (hp.k === 'rot') {
      drag = { type: 'rotate', start: snapshotSel(), f, a0: Math.atan2(d.y - f.cy, d.x - f.cx), lastScreen: s, moved: false };
    } else {
      drag = { type: 'resize', start: snapshotSel(), f, hp, lastScreen: s, moved: false };
    }
    return;
  }

  let hit = hitTest(d.x, d.y);
  // Klick utanför den öppnade gruppens delar lämnar gruppen och gäller sidan
  if (!hit && inGroup() && !(f && state.selection.length > 1 && pointInFrame(f, d.x, d.y))) {
    exitGroupEditing();
    d = screenToDoc(s.x, s.y);
    hit = hitTest(d.x, d.y);
  }
  // Klick inne i en multimarkering flyttar hela markeringen
  if (f && state.selection.length > 1 && pointInFrame(f, d.x, d.y) && !e.shiftKey) hit = hit && state.selection.includes(hit.id) ? hit : selected()[0];

  if (hit) {
    if (e.shiftKey) {
      const ids = state.selection.includes(hit.id) ? state.selection.filter((i) => i !== hit.id) : [...state.selection, hit.id];
      select(ids);
      return;
    }
    if (!state.selection.includes(hit.id)) select([hit.id]);
    if (selected().some((el) => el.locked)) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { type: 'move', start: snapshotSel(), d0: d, s0: s, lastScreen: s, moved: false, alt: e.altKey };
    return;
  }

  if (!e.shiftKey) select([]);
  canvas.setPointerCapture(e.pointerId);
  marquee = { x0: d.x, y0: d.y, x1: d.x, y1: d.y, add: e.shiftKey ? [...state.selection] : [] };
  drag = { type: 'marquee', lastScreen: s };
}

function onMove(e) {
  if (!drag) return;
  const s = screenPt(e);
  const d = screenToDoc(s.x, s.y);
  drag.lastScreen = s;

  switch (drag.type) {
    case 'pan':
      state._autoFit = false;
      state.panX = drag.px + (e.clientX - drag.sx);
      state.panY = drag.py + (e.clientY - drag.sy);
      requestRender();
      if (textarea) positionTextarea();
      return;
    case 'marquee': {
      marquee.x1 = d.x; marquee.y1 = d.y;
      const l = Math.min(marquee.x0, d.x), r = Math.max(marquee.x0, d.x), t = Math.min(marquee.y0, d.y), b = Math.max(marquee.y0, d.y);
      const ids = state.doc.elements.filter((el) => {
        if (!el.visible || el.locked) return false;
        const bb = aabb(el);
        return bb.l < r && bb.r > l && bb.t < b && bb.b > t;
      }).map((el) => el.id);
      select([...new Set([...marquee.add, ...ids])], { silent: true });
      requestRender();
      return;
    }
    case 'move': return doMove(e, s, d);
    case 'resize': return doResize(e, d);
    case 'rotate': return doRotate(e, d);
    case 'crop-move': return doCropMove(d);
    case 'crop-resize': return doCropResize(e, d);
  }
}

function onUp() {
  if (!drag) return;
  const t = drag.type;
  const moved = drag.moved;
  drag = null;
  guides = [];
  liveInfo = null;
  if (t === 'pan') canvas.style.cursor = spaceDown ? 'grab' : '';
  if (t === 'marquee') { marquee = null; emit('selection'); }
  if (moved) { commit(); emit('doc'); }
  requestRender();
}

// ---------- Flytta ----------
function snapTargets(excludeIds) {
  const d = state.doc;
  let xs = [{ v: 0, from: 0, to: d.height }, { v: d.width / 2, from: 0, to: d.height }, { v: d.width, from: 0, to: d.height }];
  let ys = [{ v: 0, from: 0, to: d.width }, { v: d.height / 2, from: 0, to: d.width }, { v: d.height, from: 0, to: d.width }];
  if (inGroup()) {
    // Sidans kanter i gruppens koordinater – bara meningsfullt om gruppen inte är roterad/speglad
    const m = groupMatrix();
    const plain = Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9 && m.a > 0 && m.d > 0;
    xs = plain ? xs.map((t) => ({ v: t.v - m.e, from: t.from - m.f, to: t.to - m.f })) : [];
    ys = plain ? ys.map((t) => ({ v: t.v - m.f, from: t.from - m.e, to: t.to - m.e })) : [];
  }
  for (const el of d.elements) {
    if (excludeIds.has(el.id) || !el.visible) continue;
    const b = aabb(el);
    for (const v of [b.l, b.cx, b.r]) xs.push({ v, from: b.t, to: b.b });
    for (const v of [b.t, b.cy, b.b]) ys.push({ v, from: b.l, to: b.r });
  }
  return { xs, ys };
}

function doMove(e, s, d) {
  if (!drag.moved) {
    if (Math.hypot(s.x - drag.s0.x, s.y - drag.s0.y) < 3) return;
    drag.moved = true;
    if (drag.alt) {
      // Alt+dra = duplicera och flytta kopian
      const copies = duplicateSelection(0);
      drag.start = copies.map((c) => ({ id: c.id, el: deepClone(c) }));
    }
    drag.targets = snapTargets(new Set(drag.start.map((x) => x.id)));
  }
  let dx = d.x - drag.d0.x, dy = d.y - drag.d0.y;
  if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }

  guides = [];
  if (!e.ctrlKey && !e.metaKey) {
    const els0 = drag.start.map((x) => x.el);
    const b0 = unionBox(els0);
    const tol = 6 / state.zoom;
    const best = (cands, targets) => {
      let res = null;
      for (const c of cands) for (const t of targets) {
        const diff = t.v - c.v;
        if (Math.abs(diff) <= tol && (!res || Math.abs(diff) < Math.abs(res.diff))) res = { diff, t, c };
      }
      return res;
    };
    const bx = best([{ v: b0.l + dx }, { v: b0.cx + dx }, { v: b0.r + dx }], drag.targets.xs);
    const by = best([{ v: b0.t + dy }, { v: b0.cy + dy }, { v: b0.b + dy }], drag.targets.ys);
    if (bx) dx += bx.diff;
    if (by) dy += by.diff;
    if (bx) guides.push({ axis: 'x', pos: bx.t.v, from: Math.min(bx.t.from, b0.t + dy), to: Math.max(bx.t.to, b0.b + dy) });
    if (by) guides.push({ axis: 'y', pos: by.t.v, from: Math.min(by.t.from, b0.l + dx), to: Math.max(by.t.to, b0.r + dx) });
  }
  for (const { id, el } of drag.start) {
    const cur = getById(id);
    if (cur) { cur.x = el.x + dx; cur.y = el.y + dy; }
  }
  markDirty();
  emit('doc:live');
  requestRender();
}

// ---------- Rotera ----------
function doRotate(e, d) {
  drag.moved = true;
  const f = drag.f;
  let delta = deg(Math.atan2(d.y - f.cy, d.x - f.cx) - drag.a0);
  const single = drag.start.length === 1;
  let target = (single ? drag.start[0].el.rotation || 0 : 0) + delta;
  if (e.shiftKey) target = Math.round(target / 15) * 15;
  else for (const m of [0, 90, 180, 270, 360, -90, -180, -270]) if (Math.abs(target - m) < 3) target = m;
  delta = target - (single ? drag.start[0].el.rotation || 0 : 0);
  for (const { id, el } of drag.start) {
    const cur = getById(id);
    if (!cur) continue;
    const c0 = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
    const p = rotatePt(c0.x - f.cx, c0.y - f.cy, delta);
    cur.x = f.cx + p.x - el.w / 2;
    cur.y = f.cy + p.y - el.h / 2;
    cur.rotation = (((el.rotation || 0) + delta) % 360 + 540) % 360 - 180;
  }
  liveInfo = `${Math.round(single ? getById(drag.start[0].id).rotation : delta)}°`;
  markDirty();
  emit('doc:live');
  requestRender();
}

// ---------- Ändra storlek ----------
function doResize(e, d) {
  drag.moved = true;
  const { f, hp } = drag;
  const { dx, dy } = hp;
  const fromCenter = e.altKey;
  // Pekaren i ramens lokala system (origo i mitten)
  const lp = rotatePt(d.x - f.cx, d.y - f.cy, -f.rot);
  const ax = fromCenter ? 0 : (-dx * f.w) / 2, ay = fromCenter ? 0 : (-dy * f.h) / 2;
  const k = fromCenter ? 2 : 1;
  let nw = dx ? Math.max(4 / state.zoom, (lp.x - ax) * dx * k) : f.w;
  let nh = dy ? Math.max(4 / state.zoom, (lp.y - ay) * dy * k) : f.h;

  const el0 = drag.start.length === 1 ? drag.start[0].el : null;
  const corner = dx && dy;
  const keepAspect = corner && (!el0 || ['text', 'group', 'image', 'icon', 'qr'].includes(el0.type) ? !e.shiftKey : e.shiftKey);
  if (keepAspect || !el0) {
    const s = Math.max(nw / f.w, nh / f.h);
    nw = f.w * s; nh = f.h * s;
  }
  const ncx = fromCenter ? 0 : ax + (dx * nw) / 2;
  const ncy = fromCenter ? 0 : ay + (dy * nh) / 2;
  const cw = rotatePt(dx ? ncx : 0, dy ? ncy : 0, f.rot);
  const center = { x: f.cx + cw.x, y: f.cy + cw.y };

  if (!el0) {
    // Multimarkering: likformig skalning runt ankaret
    const s = nw / f.w;
    const anchor = rotatePt(ax, ay, f.rot);
    const A = { x: f.cx + anchor.x, y: f.cy + anchor.y };
    for (const { id, el } of drag.start) {
      const cur = getById(id);
      if (!cur) continue;
      const c = deepClone(el);
      const c0 = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
      scaleProps(c, s);
      Object.assign(cur, c);
      const ncx2 = A.x + (c0.x - A.x) * s, ncy2 = A.y + (c0.y - A.y) * s;
      cur.x = ncx2 - cur.w / 2; cur.y = ncy2 - cur.h / 2;
    }
    liveInfo = `${Math.round(nw)} × ${Math.round(nh)}`;
  } else {
    const cur = getById(drag.start[0].id);
    if (el0.type === 'text') resizeText(cur, el0, nw, nh, corner, center, dx, f);
    else if (el0.type === 'group') {
      const c = deepClone(el0);
      scaleProps(c, nw / el0.w);
      Object.assign(cur, c);
      cur.x = center.x - cur.w / 2; cur.y = center.y - cur.h / 2;
    } else if (el0.type === 'image' && !corner) {
      resizeImageCrop(cur, el0, nw, nh, center, dx, dy);
    } else {
      if (el0.type === 'image' || el0.type === 'shape' || el0.type === 'icon' || el0.type === 'qr') {
        cur.w = nw; cur.h = nh;
      }
      cur.x = center.x - cur.w / 2; cur.y = center.y - cur.h / 2;
    }
    liveInfo = cur.type === 'text' ? `${Math.round(cur.fontSize)} px` : `${Math.round(cur.w)} × ${Math.round(cur.h)}`;
  }
  markDirty();
  emit('doc:live');
  requestRender();
}

function resizeText(cur, el0, nw, nh, corner, center, dx, f) {
  if (corner) {
    const s = nw / el0.w;
    const c = deepClone(el0);
    scaleProps(c, s);
    Object.assign(cur, c);
    const L = layoutText(cur);
    cur.w = L.w; cur.h = L.h;
    cur.x = center.x - cur.w / 2; cur.y = center.y - cur.h / 2;
  } else {
    // Sidhandtag: ändra radbrytningsbredden, överkanten ligger still
    cur.width = Math.max(cur.fontSize * 0.5, nw);
    const L = layoutText(cur);
    cur.w = L.w; cur.h = L.h;
    const top = rotatePt(0, -f.h / 2, f.rot);
    const topW = { x: f.cx + top.x, y: f.cy + top.y };
    // horisontell förskjutning från center
    const horiz = rotatePt((dx * (cur.w - f.w)) / 2, 0, f.rot);
    const down = rotatePt(0, cur.h / 2, f.rot);
    cur.x = topW.x + horiz.x + down.x - cur.w / 2;
    cur.y = topW.y + horiz.y + down.y - cur.h / 2;
  }
}

/** Sidhandtag på bilder beskär (som i Canva) i stället för att förvränga. */
function resizeImageCrop(cur, el0, nw, nh, center, dx, dy) {
  const c0 = el0.crop;
  const Fw = el0.w / c0.w, Fh = el0.h / c0.h; // hela bildens storlek
  const crop = { ...c0 };
  const fx = el0.flipX ? -1 : 1, fy = el0.flipY ? -1 : 1;
  if (dx) {
    const edgeRight = dx * fx > 0;
    const maxW = edgeRight ? (1 - c0.x) * Fw : (c0.x + c0.w) * Fw;
    nw = Math.min(nw, maxW);
    crop.w = nw / Fw;
    if (!edgeRight) crop.x = c0.x + c0.w - crop.w;
  }
  if (dy) {
    const edgeBottom = dy * fy > 0;
    const maxH = edgeBottom ? (1 - c0.y) * Fh : (c0.y + c0.h) * Fh;
    nh = Math.min(nh, maxH);
    crop.h = nh / Fh;
    if (!edgeBottom) crop.y = c0.y + c0.h - crop.h;
  }
  // Räkna om centrum utifrån den (ev. begränsade) nya storleken
  const f = { cx: el0.x + el0.w / 2, cy: el0.y + el0.h / 2, w: el0.w, h: el0.h, rot: el0.rotation || 0 };
  const ax = (-dx * f.w) / 2, ay = (-dy * f.h) / 2;
  const ncx = dx ? ax + (dx * nw) / 2 : 0, ncy = dy ? ay + (dy * nh) / 2 : 0;
  const cw = rotatePt(ncx, ncy, f.rot);
  cur.crop = crop;
  cur.w = dx ? nw : el0.w; cur.h = dy ? nh : el0.h;
  cur.x = f.cx + cw.x - cur.w / 2; cur.y = f.cy + cw.y - cur.h / 2;
}

// ---------- Dubbelklick ----------
function onDblClick(e) {
  const s = screenPt(e);
  const d = screenToDoc(s.x, s.y);
  const hit = hitTest(d.x, d.y);
  if (!hit || hit.locked) return;
  if (hit.type === 'text') { select([hit.id]); startTextEdit(hit, true); }
  else if (hit.type === 'image' && !hit.assetId) { select([hit.id]); emit('frame:choose', hit); }
  else if (hit.type === 'image') { select([hit.id]); startCrop(hit); }
  else if (hit.type === 'group') enterGroupAt(hit, s);
}

// ---------- Textredigering ----------
export function startTextEdit(el, selectAll = false) {
  if (!el || el.type !== 'text' || el.locked) return;
  finishTextEdit();
  state.editingTextId = el.id;
  textarea = document.createElement('textarea');
  textarea.className = 'text-editor';
  textarea.spellcheck = false;
  textarea.value = el.text;
  host.append(textarea);
  positionTextarea();
  textarea.focus();
  if (selectAll) textarea.select(); else textarea.setSelectionRange(el.text.length, el.text.length);
  textarea.addEventListener('input', () => {
    const cur = getById(state.editingTextId);
    if (!cur) return;
    cur.text = textarea.value;
    syncTextBox(cur, isCurved(cur) ? 'center' : 'top');
    positionTextarea();
    markDirty();
    emit('doc:live');
    requestRender();
  });
  textarea.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); finishTextEdit(); canvas.focus(); }
  });
  textarea.addEventListener('blur', () => setTimeout(() => { if (textarea && document.activeElement !== textarea) finishTextEdit(); }, 0));
  emit('textedit', true);
  requestRender();
}

export function positionTextarea() {
  const el = getById(state.editingTextId);
  if (!el || !textarea) return;
  const z = state.zoom;
  const curved = isCurved(el);
  const c = docToScreen(el.x + el.w / 2, el.y + el.h / 2);
  const L = layoutText(el);
  const st = textarea.style;
  const w = curved ? Math.max(200, el.width) : el.width;
  st.font = fontString(el, el.fontSize * z);
  st.letterSpacing = `${letterSpacingPx(el) * z}px`;
  st.lineHeight = `${L.lineH * z}px`;
  st.textAlign = el.align;
  st.textTransform = el.uppercase ? 'uppercase' : 'none';
  st.width = `${w * z}px`;
  const lines = Math.max(1, (L.lines || []).length || el.text.split('\n').length);
  const hh = curved ? lines * L.lineH : L.h;
  st.height = `${hh * z}px`;
  st.left = `${c.x - (w * z) / 2}px`;
  st.top = `${c.y - (hh * z) / 2}px`;
  st.transform = `rotate(${(el.rotation || 0) + scopeRot()}deg)`;
  textarea.classList.toggle('visible-text', curved);
  if (curved) st.color = '#111'; else st.color = 'transparent';
  const fillColor = el.fill?.type === 'solid' ? el.fill.color : '#000';
  st.caretColor = fillColor.slice(0, 7);
}

export function finishTextEdit() {
  if (!textarea) { state.editingTextId = null; return; }
  const id = state.editingTextId;
  const ta = textarea;
  textarea = null;
  state.editingTextId = null;
  ta.remove();
  const el = getById(id);
  if (el && !el.text.trim()) {
    state.doc.elements = state.doc.elements.filter((x) => x.id !== id);
    select([]);
  }
  commit();
  emit('doc');
  emit('textedit', false);
  requestRender();
}

// ---------- Beskärning ----------
export function startCrop(el) {
  if (!el || el.type !== 'image' || el.locked) return;
  finishTextEdit();
  state.cropId = el.id;
  drag = null;
  state._cropOrig = deepClone(el);
  emit('crop', true);
  requestRender();
}

export function finishCrop(apply = true) {
  if (!state.cropId) return;
  const el = getById(state.cropId);
  if (!apply && el && state._cropOrig) Object.assign(el, state._cropOrig);
  state.cropId = null;
  state._cropOrig = null;
  commit();
  emit('crop', false);
  emit('doc');
  requestRender();
}

/** Krop-ramen (hela bilden) i elementets lokala koordinater. */
function cropFrame(el) {
  const c = el.crop;
  const Fw = el.w / c.w, Fh = el.h / c.h;
  return { Fw, Fh, ox: -c.x * Fw, oy: -c.y * Fh };
}

function localSrc(el, x, y) {
  // Lokala koordinater i källbildens riktning (tar hänsyn till spegling)
  const l = toLocal(el, x, y);
  return { x: el.flipX ? el.w - l.x : l.x, y: el.flipY ? el.h - l.y : l.y };
}

function cropHandles(el) {
  const out = [];
  for (const [k, [dx, dy]] of Object.entries(HDIR)) {
    const lx = (dx + 1) / 2 * el.w, ly = (dy + 1) / 2 * el.h;
    const p = rotatePt(lx - el.w / 2, ly - el.h / 2, el.rotation || 0);
    out.push({ k, dx, dy, ...docToScreen(el.x + el.w / 2 + p.x, el.y + el.h / 2 + p.y) });
  }
  return out;
}

function drawCropOverlay() {
  const el = getById(state.cropId);
  if (!el) return;
  const c = cropFrame(el);
  // Ram runt hela bilden
  const full = [[c.ox, c.oy], [c.ox + c.Fw, c.oy], [c.ox + c.Fw, c.oy + c.Fh], [c.ox, c.oy + c.Fh]].map(([lx, ly]) => {
    const X = el.flipX ? el.w - lx : lx, Y = el.flipY ? el.h - ly : ly;
    const p = rotatePt(X - el.w / 2, Y - el.h / 2, el.rotation || 0);
    return docToScreen(el.x + el.w / 2 + p.x, el.y + el.h / 2 + p.y);
  });
  strokePoly(full, 'rgba(255,255,255,0.6)', 1, [4, 4]);
  const box = corners(el).map((p) => docToScreen(p.x, p.y));
  strokePoly(box, '#fff', 2);
  // Tredjedelslinjer
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  for (const t of [1 / 3, 2 / 3]) {
    const a = lerp(box[0], box[1], t), b = lerp(box[3], box[2], t);
    const c2 = lerp(box[0], box[3], t), d2 = lerp(box[1], box[2], t);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(c2.x, c2.y); ctx.lineTo(d2.x, d2.y); ctx.stroke();
  }
  ctx.restore();
  for (const hp of cropHandles(el)) {
    ctx.save();
    ctx.translate(hp.x, hp.y);
    ctx.rotate(rad((el.rotation || 0) + scopeRot()));
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 4;
    if (hp.k.length === 2) {
      // L-formade hörn
      ctx.fillRect(-3 + (hp.dx > 0 ? -12 : 0), -3, 15, 6);
      ctx.fillRect(-3, -3 + (hp.dy > 0 ? -12 : 0), 6, 15);
    } else {
      const horiz = hp.k === 'n' || hp.k === 's';
      ctx.fillRect(horiz ? -10 : -3, horiz ? -3 : -10, horiz ? 20 : 6, horiz ? 6 : 20);
    }
    ctx.restore();
  }
}
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function cropCursor(s, d) {
  const el = getById(state.cropId);
  if (!el) return 'default';
  for (const hp of cropHandles(el)) if (Math.hypot(s.x - hp.x, s.y - hp.y) <= 12) return cursorFor(hp, (el.rotation || 0) + scopeRot());
  return hitElement(el, d.x, d.y) ? 'move' : 'default';
}

function cropDown(e, s, d) {
  const el = getById(state.cropId);
  if (!el) { finishCrop(true); return false; }
  for (const hp of cropHandles(el)) {
    if (Math.hypot(s.x - hp.x, s.y - hp.y) <= 12) {
      canvas.setPointerCapture(e.pointerId);
      drag = { type: 'crop-resize', el0: deepClone(el), hp, lastScreen: s, moved: false };
      return true;
    }
  }
  if (hitElement(el, d.x, d.y)) {
    canvas.setPointerCapture(e.pointerId);
    drag = { type: 'crop-move', el0: deepClone(el), p0: localSrc(el, d.x, d.y), lastScreen: s, moved: false };
    return true;
  }
  finishCrop(true);
  return false;
}

function doCropMove(d) {
  drag.moved = true;
  const el0 = drag.el0;
  const cur = getById(el0.id);
  const p = localSrc(el0, d.x, d.y);
  const c = cropFrame(el0);
  const nx = clamp(el0.crop.x - (p.x - drag.p0.x) / c.Fw, 0, 1 - el0.crop.w);
  const ny = clamp(el0.crop.y - (p.y - drag.p0.y) / c.Fh, 0, 1 - el0.crop.h);
  cur.crop = { ...el0.crop, x: nx, y: ny };
  markDirty();
  requestRender();
}

function doCropResize(e, d) {
  drag.moved = true;
  const el0 = drag.el0;
  const cur = getById(el0.id);
  const { hp } = drag;
  const c = cropFrame(el0);
  const p = localSrc(el0, d.x, d.y);
  // Kanter i källriktning (hänsyn till spegling)
  const sdx = el0.flipX ? -hp.dx : hp.dx, sdy = el0.flipY ? -hp.dy : hp.dy;
  let l = 0, t = 0, r = el0.w, b = el0.h; // nuvarande ruta i lokala källkoordinater
  const minS = 10 / state.zoom;
  if (sdx < 0) l = clamp(p.x, c.ox, r - minS);
  if (sdx > 0) r = clamp(p.x, l + minS, c.ox + c.Fw);
  if (sdy < 0) t = clamp(p.y, c.oy, b - minS);
  if (sdy > 0) b = clamp(p.y, t + minS, c.oy + c.Fh);
  const nw = r - l, nh = b - t;
  cur.crop = { x: (l - c.ox) / c.Fw, y: (t - c.oy) / c.Fh, w: nw / c.Fw, h: nh / c.Fh };
  // Nytt centrum i lokala (ospeglade) koordinater
  let lcx = (l + r) / 2 - el0.w / 2, lcy = (t + b) / 2 - el0.h / 2;
  if (el0.flipX) lcx = -lcx;
  if (el0.flipY) lcy = -lcy;
  const off = rotatePt(lcx, lcy, el0.rotation || 0);
  const cx0 = el0.x + el0.w / 2, cy0 = el0.y + el0.h / 2;
  cur.w = nw; cur.h = nh;
  cur.x = cx0 + off.x - nw / 2;
  cur.y = cy0 + off.y - nh / 2;
  liveInfo = `${Math.round(nw)} × ${Math.round(nh)}`;
  markDirty();
  requestRender();
}

// ---------- Kontextmeny (hanteras i ui.js, här bara stängning) ----------
let ctxMenuHide = () => {};
export function setContextMenuHider(fn) { ctxMenuHide = fn; }
function hideContextMenu() { ctxMenuHide(); }

export function getCanvas() { return canvas; }
export function viewCenterDoc() { return screenToPage(viewW() / 2, viewH() / 2); }
/**
 * Ramen (bildelement med frame: true) under en punkt i sidans koordinater,
 * även inuti grupper som bildrutnät. Används när man släpper en bild.
 */
export function frameAt(px, py) {
  const walk = (list, m) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const el = list[i];
      if (!el.visible) continue;
      const q = m.inverse().transformPoint(new DOMPoint(px, py));
      if (el.type === 'group') {
        const gm = m.translate(el.x + el.w / 2, el.y + el.h / 2).rotate(el.rotation || 0).scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1).translate(-el.w / 2, -el.h / 2);
        const f = walk(el.children, gm);
        if (f) return f;
      } else if (el.type === 'image' && el.frame) {
        const l = toLocal(el, q.x, q.y);
        if (l.x >= 0 && l.y >= 0 && l.x <= el.w && l.y <= el.h) return el;
      }
    }
    return null;
  };
  return walk(pageView(state.doc, state.doc.pageIndex).elements, new DOMMatrix());
}

/** Sidkoordinater för en punkt på skärmen (t.ex. där något släpps). */
export function screenToDocFromClient(cx, cy) {
  const r = canvas.getBoundingClientRect();
  return screenToPage(cx - r.left, cy - r.top);
}
