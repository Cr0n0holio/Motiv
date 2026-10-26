// Textmotor: radbrytning, mått, böjd text och effekter.
// Layouten räknas ut en gång och delas av canvas-ritning, textredigering
// och SVG/PDF-export så att allt hamnar på exakt samma ställe.
import { rotatePt } from './util.js';
import { canvasPaint, paintIsVisible } from './paint.js';

const mctx = document.createElement('canvas').getContext('2d');
export const supportsLetterSpacing = 'letterSpacing' in mctx;

let fontsVersion = 0;
const cache = new Map();
export function invalidateTextCache() { fontsVersion++; cache.clear(); }

export const cssFamily = (f) => `"${String(f || 'sans-serif').replace(/"/g, '')}", "Segoe UI", Arial, sans-serif`;
export function fontString(el, size = el.fontSize) {
  return `${el.italic ? 'italic ' : ''}${el.fontWeight || 400} ${size}px ${cssFamily(el.fontFamily)}`;
}
export const letterSpacingPx = (el) => ((el.letterSpacing || 0) / 1000) * el.fontSize;
export const displayText = (el) => (el.uppercase ? el.text.toLocaleUpperCase('sv-SE') : el.text);
export const isCurved = (el) => el.curve && el.curve.mode !== 'none' && Math.abs(el.curve.amount) >= 1;

function applyFont(ctx, el, ls) {
  ctx.font = fontString(el);
  if (supportsLetterSpacing) ctx.letterSpacing = `${ls}px`;
}

const metricsCache = new Map();
function fontMetrics(el) {
  const key = fontString(el) + '|' + fontsVersion;
  let m = metricsCache.get(key);
  if (!m) {
    mctx.font = fontString(el);
    if (supportsLetterSpacing) mctx.letterSpacing = '0px';
    const t = mctx.measureText('ÅÄÖHgjpqy|');
    const asc = t.fontBoundingBoxAscent ?? t.actualBoundingBoxAscent ?? el.fontSize * 0.8;
    const desc = t.fontBoundingBoxDescent ?? t.actualBoundingBoxDescent ?? el.fontSize * 0.2;
    m = { asc, desc };
    if (metricsCache.size > 300) metricsCache.clear();
    metricsCache.set(key, m);
  }
  return m;
}

function wrap(text, maxW, measure) {
  const out = [];
  for (const para of text.split('\n')) {
    if (para === '') { out.push(''); continue; }
    const tokens = para.match(/\S+|\s+/g) || [''];
    let line = '';
    const breakLong = (word) => {
      // Ord som är bredare än rutan bryts tecken för tecken
      let cur = '';
      for (const ch of word) {
        if (cur && measure(cur + ch) > maxW) { out.push(cur); cur = ch; } else cur += ch;
      }
      return cur;
    };
    for (const tok of tokens) {
      const isSpace = /^\s+$/.test(tok);
      const cand = line + tok;
      if (measure(cand.trimEnd()) <= maxW) { line = cand; continue; }
      if (isSpace) { line = cand; continue; } // mellanslag "hänger" i slutet av raden
      if (line.trim() === '') {
        line = breakLong(line + tok);
      } else {
        out.push(line.trimEnd());
        line = measure(tok) > maxW ? breakLong(tok) : tok;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/**
 * Layout för ett textelement. Returnerar:
 * { w, h, font, lsPx, asc, desc, lineH, curved, lines:[{text,x,baseline,width}], glyphs:[{ch,x,y,rot,w}] }
 */
export function layoutText(el) {
  const ls = letterSpacingPx(el);
  const text = displayText(el);
  const key = [text, fontString(el), ls, el.width, el.lineHeight, el.align, el.curve?.mode, el.curve?.amount, fontsVersion].join('\u0001');
  const hit = cache.get(key);
  if (hit) return hit;

  const { asc, desc } = fontMetrics(el); // måste komma före applyFont (nollställer letterSpacing)
  applyFont(mctx, el, ls);
  const raw = (s) => mctx.measureText(s).width;
  // Med letterSpacing räknar canvas även avståndet efter sista tecknet – dra bort det
  const measure = (s) => (s ? raw(s) - (supportsLetterSpacing ? ls : 0) : 0);
  const lineH = el.fontSize * (el.lineHeight || 1.2);
  const font = fontString(el);
  let res;

  if (!isCurved(el)) {
    const W = Math.max(1, el.width);
    const texts = wrap(text, W, measure);
    const lines = texts.map((t, i) => {
      const width = measure(t);
      const x = el.align === 'center' ? (W - width) / 2 : el.align === 'right' ? W - width : 0;
      const baseline = i * lineH + (lineH - (asc + desc)) / 2 + asc;
      return { text: t, x, baseline, width };
    });
    res = { w: W, h: Math.max(lineH, lines.length * lineH), font, lsPx: ls, asc, desc, lineH, curved: false, lines, glyphs: null };
  } else {
    res = layoutCurved(el, text, ls, asc, desc, lineH, font);
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, res);
  return res;
}

function layoutCurved(el, text, ls, asc, desc, lineH, font) {
  mctx.font = font;
  if (supportsLetterSpacing) mctx.letterSpacing = '0px';
  const paras = text.split('\n');
  const rows = paras.map((p) => {
    const chars = [...p];
    const advs = chars.map((c) => mctx.measureText(c).width + ls);
    const total = advs.reduce((a, b) => a + b, 0) - (chars.length ? ls : 0);
    return { chars, advs, total };
  });
  const maxTotal = Math.max(el.fontSize, ...rows.map((r) => r.total));
  const glyphs = [];
  const k = el.curve.amount / 100;

  if (el.curve.mode === 'arc') {
    const up = k > 0;
    const R = Math.max(el.fontSize * 0.6, maxTotal / (Math.abs(k) * Math.PI * 2));
    rows.forEach((row, i) => {
      const Ri = Math.max(el.fontSize * 0.3, up ? R - i * lineH : R + i * lineH);
      let s = -row.total / 2;
      row.chars.forEach((ch, j) => {
        const adv = row.advs[j];
        const mid = s + (adv - ls) / 2;
        const th = mid / Ri;
        const x = Ri * Math.sin(th);
        const y = up ? -Ri * Math.cos(th) : Ri * Math.cos(th);
        glyphs.push({ ch, x, y, rot: up ? th : -th, w: adv - ls });
        s += adv;
      });
    });
  } else {
    // Våg
    const A = k * el.fontSize * 0.5;
    const period = Math.max(el.fontSize * 3, maxTotal / 1.5);
    rows.forEach((row, i) => {
      let s = -row.total / 2;
      const baseY = i * lineH;
      row.chars.forEach((ch, j) => {
        const adv = row.advs[j];
        const mid = s + (adv - ls) / 2;
        const ph = (mid / period) * Math.PI * 2;
        glyphs.push({ ch, x: mid, y: baseY + A * Math.sin(ph), rot: Math.atan(((A * Math.PI * 2) / period) * Math.cos(ph)), w: adv - ls });
        s += adv;
      });
    });
  }

  // Omslutande ruta
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of glyphs) {
    for (const [cx, cy] of [[-g.w / 2, -asc], [g.w / 2, -asc], [g.w / 2, desc], [-g.w / 2, desc]]) {
      const p = rotatePt(cx, cy, (g.rot * 180) / Math.PI);
      minX = Math.min(minX, g.x + p.x); maxX = Math.max(maxX, g.x + p.x);
      minY = Math.min(minY, g.y + p.y); maxY = Math.max(maxY, g.y + p.y);
    }
  }
  if (!glyphs.length) { minX = 0; minY = 0; maxX = el.fontSize; maxY = lineH; }
  for (const g of glyphs) { g.x -= minX; g.y -= minY; }
  return { w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY), font, lsPx: ls, asc, desc, lineH, curved: true, lines: null, glyphs };
}

/**
 * Uppdaterar w/h efter layouten. anchor: 'top' håller överkanten still
 * (vid skrivning), 'center' håller mitten still (vid böjning).
 */
export function syncTextBox(el, anchor = 'top') {
  const L = layoutText(el);
  if (Math.abs(L.w - el.w) < 0.01 && Math.abs(L.h - el.h) < 0.01) return;
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  let ncx = cx, ncy = cy;
  if (anchor === 'top') {
    const a = rotatePt(0, -el.h / 2, el.rotation);
    const b = rotatePt(0, -L.h / 2, el.rotation);
    ncx = cx + a.x - b.x;
    ncy = cy + a.y - b.y;
  }
  el.w = L.w; el.h = L.h;
  el.x = ncx - L.w / 2; el.y = ncy - L.h / 2;
}

export function textPlatePad(el) {
  const p = (el.background?.padding ?? 0.25) * el.fontSize;
  return { px: p, py: p * 0.6, r: (el.background?.radius ?? 0.2) * el.fontSize };
}

/**
 * Textplattans ruta i lokala koordinater. Den följer den bredaste raden i
 * stället för hela textrutan, så att en kort text i en bred ruta får en
 * platta som en etikett och inte som en list.
 */
export function textPlateRect(el, L = layoutText(el)) {
  const { px, py, r } = textPlatePad(el);
  let x0 = 0, x1 = L.w;
  const used = L.curved ? [] : L.lines.filter((ln) => ln.text);
  if (used.length) {
    x0 = Math.min(...used.map((ln) => ln.x));
    x1 = Math.max(...used.map((ln) => ln.x + ln.width));
  }
  const h = L.h + py * 2;
  return { x: x0 - px, y: -py, w: x1 - x0 + px * 2, h, r: Math.min(r, h / 2) };
}

/** Ritar ett textelement i lokala koordinater (0,0 = övre vänstra hörnet). */
export function drawText(ctx, el, scale) {
  const L = layoutText(el);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = L.font;
  if (supportsLetterSpacing) ctx.letterSpacing = L.curved ? '0px' : `${L.lsPx}px`;

  if (el.background?.enabled) {
    const p = textPlateRect(el, L);
    ctx.save();
    ctx.fillStyle = el.background.color;
    ctx.beginPath();
    ctx.roundRect(p.x, p.y, p.w, p.h, p.r);
    ctx.fill();
    ctx.restore();
  }

  // glyphPaint: för böjd text med gradient räknas fyllningen om per bokstav,
  // annars skulle varje bokstav bara få gradientens första färg.
  const run = (mode, glyphPaint = null) => {
    const fn = mode === 'stroke' ? 'strokeText' : 'fillText';
    if (!L.curved) {
      for (const ln of L.lines) if (ln.text) ctx[fn](ln.text, ln.x, ln.baseline);
    } else {
      for (const g of L.glyphs) {
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.rot);
        if (glyphPaint) ctx.fillStyle = glyphPaint(g);
        ctx[fn](g.ch, -g.w / 2, 0);
        ctx.restore();
      }
    }
  };
  const fillStyle = canvasPaint(ctx, el.fill, 0, 0, L.w, L.h);
  const hasFill = paintIsVisible(el.fill);
  const hasStroke = el.stroke?.enabled && el.stroke.width > 0;

  // Ritar bara skuggan: glyferna flyttas långt utanför bild och skuggan
  // förskjuts tillbaka, så att genomskinliga fyllningar inte dubbleras.
  const shadowOnly = (color, blur, ox, oy, draw) => {
    ctx.save();
    const m = ctx.getTransform();
    const D = 30000 / Math.max(0.0001, scale);
    ctx.translate(D, 0);
    ctx.shadowColor = color;
    ctx.shadowBlur = blur * scale;
    ctx.shadowOffsetX = ox * scale - m.a * D;
    ctx.shadowOffsetY = oy * scale - m.b * D;
    draw();
    ctx.restore();
  };
  const glyphsSolid = (color) => () => {
    ctx.fillStyle = color; ctx.strokeStyle = color;
    ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    if (hasFill || !hasStroke) run('fill');
    if (hasStroke) { ctx.lineWidth = el.stroke.width * 2; run('stroke'); }
  };

  if (el.glow?.enabled) {
    shadowOnly(el.glow.color, el.glow.blur, 0, 0, glyphsSolid('#000'));
    shadowOnly(el.glow.color, el.glow.blur * 0.45, 0, 0, glyphsSolid('#000'));
  }
  if (el.shadow?.enabled) {
    shadowOnly(el.shadow.color, el.shadow.blur, el.shadow.x, el.shadow.y, glyphsSolid('#000'));
  }

  if (hasStroke) {
    ctx.strokeStyle = el.stroke.color;
    ctx.lineWidth = el.stroke.width * 2;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    run('stroke');
  }
  if (hasFill) {
    ctx.fillStyle = fillStyle;
    const gradient = L.curved && el.fill.type !== 'solid';
    run('fill', gradient ? (g) => canvasPaint(ctx, el.fill, 0, 0, L.w, L.h, (x, y) => {
      const p = rotatePt(x - g.x, y - g.y, (-g.rot * 180) / Math.PI);
      return [p.x, p.y];
    }) : null);
  }
  if (el.underline && !L.curved && hasFill) {
    ctx.fillStyle = fillStyle;
    const th = Math.max(1, el.fontSize * 0.06);
    for (const ln of L.lines) if (ln.text) ctx.fillRect(ln.x, ln.baseline + el.fontSize * 0.1, ln.width, th);
  }
}

/** Utökad träffyta (inkl. textplatta). */
export function textHitPad(el) {
  return el.background?.enabled ? textPlatePad(el) : { px: 0, py: 0 };
}
