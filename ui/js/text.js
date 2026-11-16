// Textmotor: radbrytning, mått, böjd text och effekter.
// Layouten räknas ut en gång och delas av canvas-ritning, textredigering
// och SVG/PDF-export så att allt hamnar på exakt samma ställe.
import { rotatePt } from './util.js';
import { canvasPaint, paintIsVisible } from './paint.js';
import { getRuns } from './richtext.js';

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
// Versaler tecken för tecken, så att texten behåller sin längd och
// formateringen (el.runs) fortsätter att peka på rätt tecken.
const upper = (c) => { const u = c.toLocaleUpperCase('sv-SE'); return u.length === c.length ? u : c; };
export const displayText = (el) => (el.uppercase ? Array.from(el.text, upper).join('') : el.text);
export const isCurved = (el) => el.curve && el.curve.mode !== 'none' && Math.abs(el.curve.amount) >= 1;
export const listKind = (el) => (el.list === 'bullet' || el.list === 'number' ? el.list : null);

function setFont(font, ls) {
  mctx.font = font;
  if (supportsLetterSpacing) mctx.letterSpacing = `${ls}px`;
}

const metricsCache = new Map();
function fontMetrics(font, size) {
  const key = font + '|' + fontsVersion;
  let m = metricsCache.get(key);
  if (!m) {
    setFont(font, 0);
    const t = mctx.measureText('ÅÄÖHgjpqy|');
    const asc = t.fontBoundingBoxAscent ?? t.actualBoundingBoxAscent ?? size * 0.8;
    const desc = t.fontBoundingBoxDescent ?? t.actualBoundingBoxDescent ?? size * 0.2;
    m = { asc, desc };
    if (metricsCache.size > 300) metricsCache.clear();
    metricsCache.set(key, m);
  }
  return m;
}

/**
 * Textens formateringsstycken med färdiga fontsträngar:
 * [{ start, end, font, ls, size, color, underline }]. Utan el.runs ett enda
 * stycke med textrutans egen stil.
 */
function styledRuns(el, text) {
  const out = [];
  let p = 0;
  for (const r of el.runs ? getRuns(el) : [{ n: text.length }]) {
    const size = el.fontSize * (r.size || 1);
    const italic = r.italic ?? !!el.italic;
    out.push({
      start: p, end: p + r.n, size,
      font: `${italic ? 'italic ' : ''}${r.weight ?? (el.fontWeight || 400)} ${size}px ${cssFamily(el.fontFamily)}`,
      ls: ((el.letterSpacing || 0) / 1000) * size,
      color: r.color || null,
      underline: r.underline ?? !!el.underline,
    });
    p += r.n;
  }
  if (!out.length) out.push({ start: 0, end: 0, size: el.fontSize, font: fontString(el), ls: letterSpacingPx(el), color: null, underline: !!el.underline });
  return out;
}
const runAt = (runs, i) => runs.find((r) => i < r.end) || runs[runs.length - 1];

/**
 * Radbrytning. measure(a, b) ger bredden av text[a..b). Returnerar raderna
 * som teckenintervall { a, b, first } där b ligger före radens avslutande
 * mellanslag och first markerar ett nytt stycke.
 */
function wrapRanges(text, maxW, measure) {
  const out = [];
  const trimEnd = (a, b) => { while (b > a && /\s/.test(text[b - 1])) b--; return b; };
  let pos = 0;
  for (const para of text.split('\n')) {
    const p0 = pos;
    pos += para.length + 1;
    let first = true;
    const push = (a, b) => { out.push({ a, b, first }); first = false; };
    if (para === '') { push(p0, p0); continue; }
    let ls = p0, le = p0; // radens start och slut (slutet inkl. hängande mellanslag)
    // Ord som är bredare än rutan bryts tecken för tecken
    const breakLong = (a, b) => {
      let cur = a;
      for (let i = a; i < b;) {
        const n = text.codePointAt(i) > 0xffff ? 2 : 1;
        if (i > cur && measure(cur, i + n) > maxW) { push(cur, i); cur = i; }
        i += n;
      }
      ls = cur; le = b;
    };
    const re = /\S+|\s+/g;
    let m;
    while ((m = re.exec(para))) {
      const ta = p0 + m.index, tb = ta + m[0].length;
      const isSpace = /^\s/.test(m[0]);
      // mellanslag "hänger" i slutet av raden
      if (isSpace || measure(ls, tb) <= maxW) { le = tb; continue; }
      if (trimEnd(ls, le) === ls) {
        breakLong(ls, tb);
      } else {
        push(ls, trimEnd(ls, le));
        ls = ta; le = tb;
        if (measure(ta, tb) > maxW) breakLong(ta, tb);
      }
    }
    push(ls, trimEnd(ls, le));
  }
  return out;
}

/**
 * Layout för ett textelement. Returnerar
 * { w, h, font, lsPx, asc, desc, lineH, curved, lines, glyphs }, där
 * lines: [{ text, x, baseline, width, top, height, size, start, end, segs, marker }]
 *   segs: [{ start, text, x, width, font, ls, size, color, underline }] – en per formatering
 *   marker: { text, x, font, color } – punkt eller nummer i en lista
 * glyphs (böjd text): [{ ch, x, y, rot, w, font, color }]
 */
export function layoutText(el) {
  const ls = letterSpacingPx(el);
  const text = displayText(el);
  const key = [text, fontString(el), ls, el.width, el.lineHeight, el.align, el.curve?.mode, el.curve?.amount, el.runs ? JSON.stringify(el.runs) : '', listKind(el), fontsVersion].join('\u0001');
  const hit = cache.get(key);
  if (hit) return hit;

  const font = fontString(el);
  const { asc, desc } = fontMetrics(font, el.fontSize);
  const lineH = el.fontSize * (el.lineHeight || 1.2);
  const runs = styledRuns(el, text);
  let res;

  if (!isCurved(el)) {
    // Med letterSpacing räknar canvas även avståndet efter sista tecknet – dra bort det
    const measure = (a, b) => {
      if (b <= a) return 0;
      let w = 0, last = runs[0];
      for (const r of runs) {
        const s = Math.max(a, r.start), e = Math.min(b, r.end);
        if (e <= s) continue;
        setFont(r.font, r.ls);
        w += mctx.measureText(text.slice(s, e)).width;
        last = r;
      }
      return w - (supportsLetterSpacing ? last.ls : 0);
    };
    const W = Math.max(1, el.width);
    // Lista: punkten eller numret står i ett indrag till vänster om texten
    const list = listKind(el);
    const gap = el.fontSize * 0.45;
    let indent = 0;
    if (list) {
      const count = text.split('\n').filter((p) => p.trim()).length;
      setFont(font, 0);
      // Numrens bredd varierar med siffrorna – indraget rymmer det bredaste
      const labels = list === 'bullet' ? ['•'] : Array.from({ length: Math.min(Math.max(1, count), 99) }, (_, i) => `${i + 1}.`);
      indent = Math.max(...labels.map((t) => mctx.measureText(t).width)) + gap;
    }
    const wrapW = Math.max(1, W - indent);
    let y = 0, num = 0;
    const lines = wrapRanges(text, wrapW, measure).map((rg) => {
      const parts = runs.filter((r) => Math.min(rg.b, r.end) > Math.max(rg.a, r.start));
      // Radens höjd följer den största texten på raden
      const ref = parts.length ? parts.reduce((m, r) => (r.size > m.size ? r : m)) : runAt(runs, rg.a);
      const lh = ref.size * (el.lineHeight || 1.2);
      const fm = fontMetrics(ref.font, ref.size);
      const width = measure(rg.a, rg.b);
      const x0 = indent + (el.align === 'center' ? (wrapW - width) / 2 : el.align === 'right' ? wrapW - width : 0);
      let x = x0;
      const segs = parts.map((r, i) => {
        const s = Math.max(rg.a, r.start), t = text.slice(s, Math.min(rg.b, r.end));
        setFont(r.font, r.ls);
        const w = mctx.measureText(t).width;
        const seg = { start: s, text: t, x, width: i === parts.length - 1 && supportsLetterSpacing ? w - r.ls : w, font: r.font, ls: r.ls, size: r.size, color: r.color, underline: r.underline };
        x += w;
        return seg;
      });
      const line = { text: text.slice(rg.a, rg.b), x: x0, baseline: y + (lh - (fm.asc + fm.desc)) / 2 + fm.asc, width, top: y, height: lh, size: ref.size, start: rg.a, end: rg.b, segs, marker: null };
      if (list && rg.first && rg.b > rg.a) {
        const label = list === 'bullet' ? '•' : `${++num}.`;
        setFont(parts[0].font, 0);
        line.marker = { text: label, x: x0 - gap - mctx.measureText(label).width, font: parts[0].font, color: parts[0].color };
      }
      y += lh;
      return line;
    });
    res = { w: W, h: Math.max(lineH, y), font, lsPx: ls, asc, desc, lineH, curved: false, lines, glyphs: null };
  } else {
    res = layoutCurved(el, text, runs, asc, desc, lineH, font);
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, res);
  return res;
}

function layoutCurved(el, text, runs, asc, desc, lineH, font) {
  const ls = letterSpacingPx(el);
  let pos = 0;
  const rows = text.split('\n').map((p) => {
    const chars = [];
    let i = pos;
    for (const ch of p) {
      const r = runAt(runs, i);
      setFont(r.font, 0);
      chars.push({ ch, r, adv: mctx.measureText(ch).width + r.ls });
      i += ch.length;
    }
    pos += p.length + 1;
    const total = chars.reduce((a, c) => a + c.adv, 0) - (chars.length ? chars[chars.length - 1].r.ls : 0);
    return { chars, total };
  });
  const maxTotal = Math.max(el.fontSize, ...rows.map((r) => r.total));
  const glyphs = [];
  const k = el.curve.amount / 100;
  const glyph = (c, x, y, rot) => glyphs.push({ ch: c.ch, x, y, rot, w: c.adv - c.r.ls, font: c.r.font, color: c.r.color });

  if (el.curve.mode === 'arc') {
    const up = k > 0;
    const R = Math.max(el.fontSize * 0.6, maxTotal / (Math.abs(k) * Math.PI * 2));
    rows.forEach((row, i) => {
      const Ri = Math.max(el.fontSize * 0.3, up ? R - i * lineH : R + i * lineH);
      let s = -row.total / 2;
      for (const c of row.chars) {
        const th = (s + (c.adv - c.r.ls) / 2) / Ri;
        glyph(c, Ri * Math.sin(th), up ? -Ri * Math.cos(th) : Ri * Math.cos(th), up ? th : -th);
        s += c.adv;
      }
    });
  } else {
    // Våg
    const A = k * el.fontSize * 0.5;
    const period = Math.max(el.fontSize * 3, maxTotal / 1.5);
    rows.forEach((row, i) => {
      let s = -row.total / 2;
      const baseY = i * lineH;
      for (const c of row.chars) {
        const mid = s + (c.adv - c.r.ls) / 2;
        const ph = (mid / period) * Math.PI * 2;
        glyph(c, mid, baseY + A * Math.sin(ph), Math.atan(((A * Math.PI * 2) / period) * Math.cos(ph)));
        s += c.adv;
      }
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

// ---------- Markör och markering (rak text) ----------
// Teckenpositioner räknas i el.text; den visade texten har samma längd.

function lineIndex(L, idx) {
  let k = 0;
  L.lines.forEach((ln, i) => { if (ln.start <= idx) k = i; });
  return k;
}

function xInLine(ln, idx) {
  if (idx <= ln.start || !ln.segs.length) return ln.x;
  if (idx >= ln.end) return ln.x + ln.width;
  for (const sg of ln.segs) {
    if (idx <= sg.start + sg.text.length) {
      setFont(sg.font, sg.ls);
      return sg.x + mctx.measureText(sg.text.slice(0, idx - sg.start)).width;
    }
  }
  return ln.x + ln.width;
}

/** Markörens plats i lokala koordinater: { x, y, h }. null för böjd text. */
export function caretRect(el, idx) {
  const L = layoutText(el);
  if (L.curved) return null;
  const ln = L.lines[lineIndex(L, idx)];
  const h = Math.min(ln.height, ln.size * 1.25);
  return { x: xInLine(ln, idx), y: ln.top + (ln.height - h) / 2, h };
}

/** Teckenpositionen närmast en punkt i lokala koordinater. */
export function indexAtPoint(el, x, y) {
  const L = layoutText(el);
  if (L.curved) return el.text.length;
  const ln = L.lines.find((l) => y < l.top + l.height) || L.lines[L.lines.length - 1];
  let prev = ln.x, best = ln.start;
  if (x <= prev) return best;
  for (const sg of ln.segs) {
    setFont(sg.font, sg.ls);
    let i = 0;
    for (const ch of sg.text) {
      i += ch.length;
      const cx = sg.x + mctx.measureText(sg.text.slice(0, i)).width;
      if (x < (prev + cx) / 2) return sg.start + i - ch.length;
      prev = cx; best = sg.start + i;
    }
  }
  return best;
}

/** Rektanglar som täcker markeringen [a, b), en per rad. */
export function selectionRects(el, a, b) {
  const L = layoutText(el);
  if (L.curved || a >= b) return [];
  const out = [];
  L.lines.forEach((ln, i) => {
    const next = L.lines[i + 1];
    if (b <= ln.start || (next && a >= next.start)) return;
    const x1 = xInLine(ln, Math.max(a, ln.start));
    let x2 = xInLine(ln, Math.min(b, ln.end));
    if (next && b >= next.start) x2 += ln.size * 0.25; // radslutet ingår i markeringen
    out.push({ x: x1, y: ln.top, w: x2 - x1, h: ln.height });
  });
  return out;
}

/** Positionen en rad upp (dir = -1) eller ned (dir = 1) från idx. */
export function caretLineMove(el, idx, dir) {
  const L = layoutText(el);
  if (L.curved) return idx;
  const k = lineIndex(L, idx), t = L.lines[k + dir];
  if (!t) return dir < 0 ? 0 : el.text.length;
  return indexAtPoint(el, xInLine(L.lines[k], idx), t.top + t.height / 2);
}

/** Början (end = false) eller slutet av raden som idx står på. */
export function caretLineEdge(el, idx, end) {
  const L = layoutText(el);
  if (L.curved) return idx;
  const ln = L.lines[lineIndex(L, idx)];
  return end ? ln.end : ln.start;
}

/** Ordet runt idx som [a, b]. */
export function wordRange(el, idx) {
  const t = el.text, word = /[\p{L}\p{N}_]/u;
  let a = idx, b = idx;
  while (a > 0 && word.test(t[a - 1])) a--;
  while (b < t.length && word.test(t[b])) b++;
  if (a === b && b < t.length) b++;
  return [a, b];
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
    x0 = Math.min(...used.map((ln) => (ln.marker ? Math.min(ln.marker.x, ln.x) : ln.x)));
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
  const spacing = (px) => { if (supportsLetterSpacing) ctx.letterSpacing = `${px}px`; };
  spacing(0);

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
  // colored: delar av texten med egen färg ritas i den (inte i skuggor och kontur).
  const run = (mode, glyphPaint = null, colored = false) => {
    const fn = mode === 'stroke' ? 'strokeText' : 'fillText';
    if (!L.curved) {
      const base = ctx.fillStyle;
      const put = (text, x, y, font, ls, color) => {
        ctx.font = font; spacing(ls);
        if (colored && color) { ctx.fillStyle = color; ctx[fn](text, x, y); ctx.fillStyle = base; } else ctx[fn](text, x, y);
      };
      for (const ln of L.lines) {
        if (ln.marker) put(ln.marker.text, ln.marker.x, ln.baseline, ln.marker.font, 0, ln.marker.color);
        for (const sg of ln.segs) put(sg.text, sg.x, ln.baseline, sg.font, sg.ls, sg.color);
      }
    } else {
      for (const g of L.glyphs) {
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.rot);
        ctx.font = g.font;
        if (colored && g.color) ctx.fillStyle = g.color;
        else if (glyphPaint) ctx.fillStyle = glyphPaint(g);
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
    }) : null, true);
  }
  if (!L.curved && hasFill) {
    for (const ln of L.lines) for (const sg of ln.segs) {
      if (!sg.underline || !sg.text) continue;
      ctx.fillStyle = sg.color || fillStyle;
      ctx.fillRect(sg.x, ln.baseline + sg.size * 0.1, sg.width, Math.max(1, sg.size * 0.06));
    }
  }
}

/** Utökad träffyta (inkl. textplatta). */
export function textHitPad(el) {
  return el.background?.enabled ? textPlatePad(el) : { px: 0, py: 0 };
}
