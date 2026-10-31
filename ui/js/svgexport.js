// SVG-export. Samma SVG används för PDF (Rust konverterar den med svg2pdf),
// med utfall (bleed) och skärmärken för tryck.
import { round, rotatePt, escapeXml, parseColor } from './util.js';
import { svgPaint, svgColorAttrs, paintIsVisible } from './paint.js';
import { layoutText, isCurved, textPlateRect } from './text.js';
import { shapeD, isOpenShape, arrowHeadsD, lineD, maskD } from './shapes.js';
import { getProcessed, ensureAllImages } from './images.js';
import { bgImageProps } from './render.js';
import { fontFaceCss } from './fonts.js';
import { qrLayout } from './qr.js';

const R = (n) => round(n, 3);

function famAttr(f) {
  return `'${String(f).replace(/['"]/g, '')}', 'Segoe UI', Arial, sans-serif`;
}

/** Offset i världen → lokala koordinater (skuggor följer inte rotationen, som i canvas). */
function localOffset(el, x, y) {
  const p = rotatePt(x, y, -(el.rotation || 0));
  const fx = el.type !== 'text' && el.flipX ? -1 : 1, fy = el.type !== 'text' && el.flipY ? -1 : 1;
  return { x: p.x * fx, y: p.y * fy };
}

function blurFilter(X, sigma) {
  const id = `f${X.ids.next++}`;
  X.defs.push(`<filter id="${id}" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${R(Math.max(0.01, sigma))}"/></filter>`);
  return id;
}

function dropShadowFilter(X, el, sh) {
  const id = `f${X.ids.next++}`;
  const o = localOffset(el, sh.x, sh.y);
  const c = parseColor(sh.color);
  X.defs.push(`<filter id="${id}" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">`
    + `<feGaussianBlur in="SourceAlpha" stdDeviation="${R(Math.max(0.01, sh.blur / 2))}" result="b"/>`
    + `<feOffset in="b" dx="${R(o.x)}" dy="${R(o.y)}" result="o"/>`
    + `<feFlood flood-color="rgb(${c.r},${c.g},${c.b})" flood-opacity="${R(c.a)}" result="c"/>`
    + `<feComposite in="c" in2="o" operator="in" result="s"/>`
    + `<feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
  return id;
}

function textSVG(el, X) {
  const L = layoutText(el);
  X.fonts.add(el.fontFamily);
  const fontAttrs = `font-family="${escapeXml(famAttr(el.fontFamily))}" font-size="${R(el.fontSize)}" font-weight="${el.fontWeight || 400}"${el.italic ? ' font-style="italic"' : ''}`;
  const lsAttr = !L.curved && L.lsPx ? ` letter-spacing="${R(L.lsPx)}"` : '';

  const glyphs = () => {
    if (!L.curved) {
      return L.lines.filter((l) => l.text).map((l) => `<text x="${R(l.x)}" y="${R(l.baseline)}" xml:space="preserve">${escapeXml(l.text)}</text>`).join('');
    }
    // Böjd text: varje bokstav placeras med x/y + rotate i stället för transform,
    // så att en gradientfyllning ligger still över hela texten.
    return L.glyphs.filter((g) => g.ch.trim()).map((g) => {
      const deg = (g.rot * 180) / Math.PI;
      const o = rotatePt(-g.w / 2, 0, deg);
      return `<text x="${R(g.x + o.x)}" y="${R(g.y + o.y)}" rotate="${R(deg)}">${escapeXml(g.ch)}</text>`;
    }).join('');
  };
  const hasFill = paintIsVisible(el.fill);
  const hasStroke = el.stroke?.enabled && el.stroke.width > 0;
  const strokeAttrs = hasStroke ? `${svgColorAttrs(el.stroke.color, 'stroke')} stroke-width="${R(el.stroke.width * 2)}" stroke-linejoin="round"` : '';
  const silhouette = (color) => {
    const c = svgColorAttrs(color, 'fill');
    const sc = svgColorAttrs(color, 'stroke');
    let s = '';
    if (hasFill || !hasStroke) s += `<g ${c}>${glyphs()}</g>`;
    if (hasStroke) s += `<g fill="none" ${sc} stroke-width="${R(el.stroke.width * 2)}" stroke-linejoin="round">${glyphs()}</g>`;
    return s;
  };

  let out = `<g ${fontAttrs}${lsAttr}>`;
  if (el.background?.enabled) {
    const p = textPlateRect(el, L);
    out += `<rect x="${R(p.x)}" y="${R(p.y)}" width="${R(p.w)}" height="${R(p.h)}" rx="${R(p.r)}" ${svgColorAttrs(el.background.color)}/>`;
  }
  if (el.glow?.enabled) {
    // Glöd = färgad, suddig kopia (två lager som i canvas)
    for (const k of [1, 0.45]) {
      const id = blurFilter(X, (el.glow.blur * k) / 2);
      out += `<g filter="url(#${id})">${silhouette(el.glow.color)}</g>`;
    }
  }
  if (el.shadow?.enabled) {
    const o = localOffset(el, el.shadow.x, el.shadow.y);
    const id = blurFilter(X, el.shadow.blur / 2);
    out += `<g transform="translate(${R(o.x)} ${R(o.y)})"><g filter="url(#${id})">${silhouette(el.shadow.color)}</g></g>`;
  }
  if (hasStroke) out += `<g fill="none" ${strokeAttrs}>${glyphs()}</g>`;
  if (hasFill) {
    const p = svgPaint(el.fill, 0, 0, L.w, L.h, X.ids);
    if (p.def) X.defs.push(p.def);
    out += `<g ${p.attr}>${glyphs()}`;
    if (el.underline && !L.curved) {
      const th = Math.max(1, el.fontSize * 0.06);
      out += L.lines.filter((l) => l.text).map((l) => `<rect x="${R(l.x)}" y="${R(l.baseline + el.fontSize * 0.1)}" width="${R(l.width)}" height="${R(th)}"/>`).join('');
    }
    out += '</g>';
  }
  return out + '</g>';
}

function shapeSVG(el, X) {
  const sw = el.stroke?.enabled ? el.stroke.width : 0;
  const dash = (w) => (el.stroke?.dash === 'dashed' ? ` stroke-dasharray="${R(w * 3)} ${R(w * 2)}"` : el.stroke?.dash === 'dotted' ? ` stroke-dasharray="0.01 ${R(w * 2)}" stroke-linecap="round"` : '');
  let filt = '';
  if (el.shadow?.enabled) filt = ` filter="url(#${dropShadowFilter(X, el, el.shadow)})"`;
  if (isOpenShape(el.kind)) {
    if (!sw) return '';
    const heads = arrowHeadsD(el);
    return `<g${filt}><path d="${lineD(el)}" fill="none" ${svgColorAttrs(el.stroke.color, 'stroke')} stroke-width="${R(sw)}"${dash(sw)}/>${heads.d ? `<path d="${heads.d}" ${svgColorAttrs(el.stroke.color)}/>` : ''}</g>`;
  }
  const d = shapeD(el.kind, el.w, el.h, el);
  const p = svgPaint(el.fill, 0, 0, el.w, el.h, X.ids);
  if (p.def) X.defs.push(p.def);
  let out = `<g${filt}><path d="${d}" fill-rule="evenodd" ${p.attr}/>`;
  if (sw) {
    const cid = `c${X.ids.next++}`;
    X.defs.push(`<clipPath id="${cid}"><path d="${d}" clip-rule="evenodd"/></clipPath>`);
    out += `<path d="${d}" fill="none" clip-path="url(#${cid})" ${svgColorAttrs(el.stroke.color, 'stroke')} stroke-width="${R(sw * 2)}" stroke-linejoin="round"${dash(sw * 2)}/>`;
  }
  return out + '</g>';
}

function imageSVG(el, X) {
  const c = getProcessed(el, el.w * X.imgScale, el.h * X.imgScale);
  if (!c) return '';
  const opaque = (!el.maskShape || el.maskShape === 'none') && !el.maskAssetId && !(el.filters?.blur);
  const href = opaque ? c.toDataURL('image/jpeg', 0.93) : c.toDataURL('image/png');
  let filt = '';
  if (el.shadow?.enabled) filt = ` filter="url(#${dropShadowFilter(X, el, el.shadow)})"`;
  let out = `<g${filt}><image x="0" y="0" width="${R(el.w)}" height="${R(el.h)}" preserveAspectRatio="none" xlink:href="${href}"/></g>`;
  if (el.border?.enabled && el.border.width > 0) {
    const d = el.maskShape && el.maskShape !== 'none' ? maskD(el.maskShape, el.w, el.h, el.radius) : `M0,0H${R(el.w)}V${R(el.h)}H0Z`;
    const cid = `c${X.ids.next++}`;
    X.defs.push(`<clipPath id="${cid}"><path d="${d}"/></clipPath>`);
    out += `<path d="${d}" fill="none" clip-path="url(#${cid})" ${svgColorAttrs(el.border.color, 'stroke')} stroke-width="${R(el.border.width * 2)}" stroke-linejoin="round"/>`;
  }
  return out;
}

function elementSVG(el, X) {
  if (!el.visible) return '';
  const fx = el.type !== 'text' && el.flipX ? -1 : 1, fy = el.type !== 'text' && el.flipY ? -1 : 1;
  let t = `translate(${R(el.x + el.w / 2)} ${R(el.y + el.h / 2)})`;
  if (el.rotation) t += ` rotate(${R(el.rotation)})`;
  if (fx < 0 || fy < 0) t += ` scale(${fx} ${fy})`;
  t += ` translate(${R(-el.w / 2)} ${R(-el.h / 2)})`;
  const op = (el.opacity ?? 1) < 1 ? ` opacity="${R(el.opacity)}"` : '';
  const blend = el.blend && el.blend !== 'normal' ? ` style="mix-blend-mode:${el.blend}"` : '';
  let content = '';
  if (el.type === 'text') content = textSVG(el, X);
  else if (el.type === 'shape') content = shapeSVG(el, X);
  else if (el.type === 'image') content = imageSVG(el, X);
  else if (el.type === 'icon') {
    const s = Math.min(el.w, el.h) / 24;
    content = `<g transform="translate(${R((el.w - 24 * s) / 2)} ${R((el.h - 24 * s) / 2)}) scale(${R(s)})" fill="none" ${svgColorAttrs(el.color, 'stroke')} stroke-width="${R(el.strokeWidth ?? 2)}" stroke-linecap="round" stroke-linejoin="round">${el.paths.map((d) => `<path d="${d}"/>`).join('')}</g>`;
  } else if (el.type === 'qr') {
    const L = qrLayout(el);
    content = (el.background?.enabled ? `<rect width="${R(el.w)}" height="${R(el.h)}" ${svgColorAttrs(el.background.color)}/>` : '')
      + (L ? `<path transform="translate(${R(L.ox)} ${R(L.oy)}) scale(${R(L.s)})" d="${L.q.d}" ${svgColorAttrs(el.color)}/>` : '');
  }
  else if (el.type === 'group') content = el.children.map((c) => elementSVG(c, X)).join('');
  return `<g transform="${t}"${op}${blend}>${content}</g>`;
}

/**
 * Bygger en SVG av dokumentet.
 * opts: { forPdf, bleedMm, cropMarks, embedFonts, imgScale, transparent }
 */
export async function buildSVG(doc, opts = {}) {
  await ensureAllImages();
  const X = { defs: [], ids: { next: 1 }, fonts: new Set(), imgScale: opts.imgScale || 1 };
  const W = doc.width, H = doc.height;
  const mmToPx = doc.dpi / 25.4;
  const b = (opts.bleedMm || 0) * mmToPx;
  const m = opts.cropMarks ? 10 * mmToPx : 0; // marginal för skärmärken
  const vx = -b - m, vy = -b - m, vw = W + 2 * (b + m), vh = H + 2 * (b + m);

  let body = '';
  // Bakgrund (sträcks ut i utfallet)
  if (!opts.transparent) {
    const f = doc.background.fill;
    if (paintIsVisible(f)) {
      const p = svgPaint(f, 0, 0, W, H, X.ids);
      if (p.def) X.defs.push(p.def);
      body += `<rect x="${R(-b)}" y="${R(-b)}" width="${R(W + 2 * b)}" height="${R(H + 2 * b)}" ${p.attr}/>`;
    }
    const bi = bgImageProps(doc);
    if (bi) {
      const c = getProcessed(bi, W * X.imgScale, H * X.imgScale);
      if (c) body += `<image x="0" y="0" width="${R(W)}" height="${R(H)}" preserveAspectRatio="none"${(bi.opacity ?? 1) < 1 ? ` opacity="${R(bi.opacity)}"` : ''} xlink:href="${c.toDataURL('image/jpeg', 0.93)}"/>`;
    }
  }
  body += doc.elements.map((el) => elementSVG(el, X)).join('');

  const clipId = 'pageclip';
  X.defs.push(`<clipPath id="${clipId}"><rect x="${R(-b)}" y="${R(-b)}" width="${R(W + 2 * b)}" height="${R(H + 2 * b)}"/></clipPath>`);

  let marks = '';
  if (opts.cropMarks) {
    const len = 5 * mmToPx, gap = b + 1.5 * mmToPx, sw = (0.3 / 72) * doc.dpi;
    const ln = (x1, y1, x2, y2) => `<line x1="${R(x1)}" y1="${R(y1)}" x2="${R(x2)}" y2="${R(y2)}"/>`;
    for (const x of [0, W]) {
      const dir = x === 0 ? -1 : 1;
      for (const y of [0, H]) {
        const dy = y === 0 ? -1 : 1;
        marks += ln(x + dir * gap, y, x + dir * (gap + len), y); // horisontell
        marks += ln(x, y + dy * gap, x, y + dy * (gap + len));   // vertikal
      }
    }
    marks = `<g stroke="#000000" stroke-width="${R(sw)}" fill="none">${marks}</g>`;
  }

  let style = '';
  if (opts.embedFonts && !opts.forPdf) {
    const css = fontFaceCss(X.fonts);
    if (css) style = `<style>${css}</style>`;
  }
  const widthAttr = opts.forPdf ? R((vw / doc.dpi) * 72) : R(vw);
  const heightAttr = opts.forPdf ? R((vh / doc.dpi) * 72) : R(vh);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${widthAttr}" height="${heightAttr}" viewBox="${R(vx)} ${R(vy)} ${R(vw)} ${R(vh)}">`
    + `${style}<defs>${X.defs.join('')}</defs>`
    + `<g clip-path="url(#${clipId})">${body}</g>${marks}</svg>`;
}

/** SVG som bara innehåller en rasterbild (för "exakt" PDF). */
export function rasterSVG(dataURL, doc, opts = {}) {
  const mmToPx = doc.dpi / 25.4;
  const b = (opts.bleedMm || 0) * mmToPx;
  const m = opts.cropMarks ? 10 * mmToPx : 0;
  const W = doc.width, H = doc.height;
  const vw = W + 2 * (b + m), vh = H + 2 * (b + m);
  let marks = '';
  if (opts.cropMarks) {
    const len = 5 * mmToPx, gap = b + 1.5 * mmToPx, sw = (0.3 / 72) * doc.dpi;
    const ln = (x1, y1, x2, y2) => `<line x1="${R(x1)}" y1="${R(y1)}" x2="${R(x2)}" y2="${R(y2)}"/>`;
    for (const x of [0, W]) for (const y of [0, H]) {
      const dir = x === 0 ? -1 : 1, dy = y === 0 ? -1 : 1;
      marks += ln(x + dir * gap, y, x + dir * (gap + len), y) + ln(x, y + dy * gap, x, y + dy * (gap + len));
    }
    marks = `<g stroke="#000000" stroke-width="${R(sw)}">${marks}</g>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${R((vw / doc.dpi) * 72)}" height="${R((vh / doc.dpi) * 72)}" viewBox="${R(-b - m)} ${R(-b - m)} ${R(vw)} ${R(vh)}">`
    + `<image x="${R(-b)}" y="${R(-b)}" width="${R(W + 2 * b)}" height="${R(H + 2 * b)}" preserveAspectRatio="none" xlink:href="${dataURL}"/>${marks}</svg>`;
}
