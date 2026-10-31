// Rendering av dokumentet till en canvas. Används av editorn, miniatyrer
// och rasterexport (PNG/JPG/WebP) – samma kod överallt.
import { rad } from './util.js';
import { canvasPaint, paintIsVisible } from './paint.js';
import { drawText } from './text.js';
import { shapeD, isOpenShape, arrowHeadsD, lineD, maskD } from './shapes.js';
import { getProcessed, targetSize, sourceSize, coverCrop } from './images.js';
import { qrLayout } from './qr.js';

export const BLEND_MODES = [
  ['normal', 'Normal'], ['multiply', 'Multiplicera'], ['screen', 'Raster'], ['overlay', 'Täcka över'],
  ['darken', 'Mörkare'], ['lighten', 'Ljusare'], ['color-dodge', 'Färgskugga'], ['color-burn', 'Efterbelys'],
  ['hard-light', 'Hårt ljus'], ['soft-light', 'Mjukt ljus'], ['difference', 'Differens'], ['exclusion', 'Uteslutning'],
  ['hue', 'Nyans'], ['saturation', 'Mättnad'], ['color', 'Färg'], ['luminosity', 'Luminans'],
];
const compositeOp = (b) => (!b || b === 'normal' ? 'source-over' : b);

function applyShadow(ctx, sh, scale) {
  if (!sh?.enabled) return false;
  ctx.shadowColor = sh.color;
  ctx.shadowBlur = sh.blur * scale;
  ctx.shadowOffsetX = sh.x * scale;
  ctx.shadowOffsetY = sh.y * scale;
  return true;
}
function clearShadow(ctx) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }

const dashFor = (s) => (s.dash === 'dashed' ? [s.width * 3, s.width * 2] : s.dash === 'dotted' ? [0.01, s.width * 2] : []);

function drawShape(ctx, el, scale) {
  const open = isOpenShape(el.kind);
  const sw = el.stroke?.enabled ? el.stroke.width : 0;
  if (open) {
    if (!sw) return;
    const heads = arrowHeadsD(el);
    ctx.lineWidth = sw;
    ctx.strokeStyle = el.stroke.color;
    ctx.lineCap = el.stroke.dash === 'dotted' ? 'round' : 'butt';
    ctx.setLineDash(dashFor(el.stroke));
    const hasShadow = applyShadow(ctx, el.shadow, scale);
    ctx.stroke(new Path2D(lineD(el)));
    ctx.setLineDash([]);
    if (heads.d) { ctx.fillStyle = el.stroke.color; ctx.fill(new Path2D(heads.d)); }
    if (hasShadow) clearShadow(ctx);
    return;
  }
  const path = new Path2D(shapeD(el.kind, el.w, el.h, el));
  const fill = paintIsVisible(el.fill) ? canvasPaint(ctx, el.fill, 0, 0, el.w, el.h) : null;
  if (el.shadow?.enabled) {
    applyShadow(ctx, el.shadow, scale);
    if (fill) { ctx.fillStyle = fill; ctx.fill(path, 'evenodd'); }
    else if (sw) { ctx.lineWidth = sw; ctx.strokeStyle = el.stroke.color; ctx.stroke(path); }
    clearShadow(ctx);
  } else if (fill) {
    ctx.fillStyle = fill;
    ctx.fill(path, 'evenodd');
  }
  if (sw) {
    ctx.save();
    // Kantlinjen ritas på insidan så att formens yttermått stämmer
    ctx.clip(path, 'evenodd');
    ctx.lineWidth = sw * 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = el.stroke.dash === 'dotted' ? 'round' : 'butt';
    ctx.setLineDash(dashFor({ ...el.stroke, width: sw * 2 }));
    ctx.strokeStyle = el.stroke.color;
    ctx.stroke(path);
    ctx.restore();
  }
}

/** Ikon: linjerna skalas lika i båda riktningar och centreras i rutan. */
function drawIcon(ctx, el) {
  const s = Math.min(el.w, el.h) / 24;
  ctx.translate((el.w - 24 * s) / 2, (el.h - 24 * s) / 2);
  ctx.scale(s, s);
  ctx.strokeStyle = el.color;
  ctx.lineWidth = el.strokeWidth ?? 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of el.paths) ctx.stroke(new Path2D(d));
}

function drawQR(ctx, el) {
  if (el.background?.enabled) { ctx.fillStyle = el.background.color; ctx.fillRect(0, 0, el.w, el.h); }
  const L = qrLayout(el);
  if (!L) return;
  ctx.translate(L.ox, L.oy);
  ctx.scale(L.s, L.s);
  ctx.fillStyle = el.color;
  ctx.fill(new Path2D(L.q.d));
}

/** Tom ram: ljusgrå yta i ramens form med en liten bildsymbol. */
function drawFramePlaceholder(ctx, el) {
  const path = new Path2D(el.maskShape && el.maskShape !== 'none' ? maskD(el.maskShape, el.w, el.h, el.radius) : `M0,0H${el.w}V${el.h}H0Z`);
  ctx.save();
  ctx.fillStyle = '#dfe1ea';
  ctx.fill(path);
  ctx.clip(path);
  const s = Math.min(el.w, el.h) * 0.26;
  ctx.translate(el.w / 2 - s / 2, el.h / 2 - s / 2);
  ctx.scale(s / 24, s / 24);
  ctx.strokeStyle = '#9da1b4';
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke(new Path2D('M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6'));
  ctx.beginPath(); ctx.arc(15.5, 9, 1.6, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawImageEl(ctx, el, scale, opts) {
  if (!el.assetId) {
    // Platshållaren syns i editorn och i miniatyrer, men aldrig i en export
    if (!opts.exact || opts.placeholders) drawFramePlaceholder(ctx, el);
    return;
  }
  const { tw, th } = opts.exact ? { tw: el.w * scale, th: el.h * scale } : targetSize(el, scale);
  const c = getProcessed(el, tw, th);
  if (!c) {
    // Platshållare medan bilden laddas
    ctx.fillStyle = 'rgba(128,128,128,0.25)';
    ctx.fillRect(0, 0, el.w, el.h);
    return;
  }
  const hasShadow = applyShadow(ctx, el.shadow, scale);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, el.w, el.h);
  if (hasShadow) clearShadow(ctx);
  if (el.border?.enabled && el.border.width > 0) {
    const path = new Path2D(el.maskShape && el.maskShape !== 'none' ? maskD(el.maskShape, el.w, el.h, el.radius) : `M0,0H${el.w}V${el.h}H0Z`);
    ctx.save();
    ctx.clip(path);
    ctx.lineWidth = el.border.width * 2;
    ctx.strokeStyle = el.border.color;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
    ctx.restore();
  }
}

/** Ritar ett element. ctx ska redan vara i dokumentkoordinater. */
export function drawElement(ctx, el, scale, opts = {}) {
  if (!el.visible) return;
  if (opts.skipId && el.id === opts.skipId) return;
  ctx.save();
  ctx.globalAlpha *= el.opacity ?? 1;
  ctx.globalCompositeOperation = compositeOp(el.blend);
  ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
  if (el.rotation) ctx.rotate(rad(el.rotation));
  if (el.type !== 'text' && (el.flipX || el.flipY)) ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
  ctx.translate(-el.w / 2, -el.h / 2);

  switch (el.type) {
    case 'text': drawText(ctx, el, scale); break;
    case 'shape': drawShape(ctx, el, scale); break;
    case 'image': drawImageEl(ctx, el, scale, opts); break;
    case 'icon': drawIcon(ctx, el); break;
    case 'qr': drawQR(ctx, el); break;
    case 'group':
      for (const ch of el.children) drawElement(ctx, ch, scale, { ...opts, skipId: null });
      break;
  }
  ctx.restore();
}

export function bgImageProps(doc) {
  const bg = doc.background.image;
  if (!bg) return null;
  const s = sourceSize(bg.assetId);
  const crop = s ? coverCrop(s.w, s.h, doc.width, doc.height) : { x: 0, y: 0, w: 1, h: 1 };
  return { ...bg, x: 0, y: 0, w: doc.width, h: doc.height, crop, maskShape: 'none', radius: 0 };
}

/** Bakgrund (färg/gradient + ev. bild), med valfri utfallsmarginal. */
export function drawBackground(ctx, doc, scale, bleed = 0, opts = {}) {
  const f = doc.background.fill;
  if (paintIsVisible(f)) {
    ctx.fillStyle = canvasPaint(ctx, f, 0, 0, doc.width, doc.height);
    ctx.fillRect(-bleed, -bleed, doc.width + bleed * 2, doc.height + bleed * 2);
  }
  const bi = bgImageProps(doc);
  if (bi) {
    ctx.save();
    ctx.globalAlpha *= bi.opacity ?? 1;
    const { tw, th } = opts.exact ? { tw: bi.w * scale, th: bi.h * scale } : targetSize(bi, scale);
    const c = getProcessed(bi, tw, th);
    if (c) ctx.drawImage(c, 0, 0, doc.width, doc.height);
    ctx.restore();
  }
}

/**
 * Ritar hela dokumentet. ctx ska vara transformerad till dokumentkoordinater.
 * opts: { transparent, skipId, exact }
 */
export function renderDoc(ctx, doc, scale, opts = {}) {
  if (!opts.transparent) drawBackground(ctx, doc, scale, 0, opts);
  for (const el of doc.elements) drawElement(ctx, el, scale, opts);
}

/** Renderar dokumentet till en ny canvas i given skala. */
export function renderToCanvas(doc, scale, opts = {}) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(doc.width * scale));
  c.height = Math.max(1, Math.round(doc.height * scale));
  const ctx = c.getContext('2d');
  if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.scale(c.width / doc.width, c.height / doc.height);
  renderDoc(ctx, doc, scale, { ...opts, exact: true });
  return c;
}

/** Liten miniatyr av ett element (lagerpanelen). */
export function renderElementThumb(el, size = 40) {
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = c.height = Math.round(size * dpr);
  const ctx = c.getContext('2d');
  const s = (size * dpr * 0.86) / Math.max(el.w, el.h, 1);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.scale(s, s);
  ctx.translate(-(el.x + el.w / 2), -(el.y + el.h / 2));
  drawElement(ctx, { ...el, visible: true, opacity: 1, blend: 'normal' }, s);
  return c;
}
