// Formgeometri som SVG-sökvägar ("d"). Samma sökväg används av canvas
// (Path2D), SVG-export och bildmasker, så allt ser likadant ut överallt.

const f = (n) => Math.round(n * 100) / 100;

export function roundRectD(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r <= 0) return `M${f(x)},${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
  return `M${f(x + r)},${f(y)}H${f(x + w - r)}A${f(r)},${f(r)} 0 0 1 ${f(x + w)},${f(y + r)}V${f(y + h - r)}A${f(r)},${f(r)} 0 0 1 ${f(x + w - r)},${f(y + h)}H${f(x + r)}A${f(r)},${f(r)} 0 0 1 ${f(x)},${f(y + h - r)}V${f(y + r)}A${f(r)},${f(r)} 0 0 1 ${f(x + r)},${f(y)}Z`;
}

function poly(pts) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])},${f(p[1])}`).join('') + 'Z';
}

function regular(n, w, h, inner = null) {
  const pts = [];
  const cx = w / 2, cy = h / 2;
  const count = inner ? n * 2 : n;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
    const k = inner && i % 2 ? inner : 1;
    pts.push([cx + Math.cos(a) * (w / 2) * k, cy + Math.sin(a) * (h / 2) * k]);
  }
  return pts;
}

/** Rundar hörnen på en polygon med kvadratiska kurvor. */
function roundedPoly(pts, r) {
  if (!r) return poly(pts);
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const a = [p1[0] + ((p0[0] - p1[0]) / l1) * rr, p1[1] + ((p0[1] - p1[1]) / l1) * rr];
    const b = [p1[0] + ((p2[0] - p1[0]) / l2) * rr, p1[1] + ((p2[1] - p1[1]) / l2) * rr];
    d += `${i ? 'L' : 'M'}${f(a[0])},${f(a[1])}Q${f(p1[0])},${f(p1[1])} ${f(b[0])},${f(b[1])}`;
  }
  return d + 'Z';
}

export function ellipseD(x, y, w, h) {
  const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
  return `M${f(cx - rx)},${f(cy)}A${f(rx)},${f(ry)} 0 1 0 ${f(cx + rx)},${f(cy)}A${f(rx)},${f(ry)} 0 1 0 ${f(cx - rx)},${f(cy)}Z`;
}

/**
 * Sökväg för en form i lokala koordinater (0..w, 0..h).
 * opts: { radius, points, innerRatio }
 */
export function shapeD(kind, w, h, opts = {}) {
  const r = opts.radius || 0;
  switch (kind) {
    case 'rect':
    case 'rounded':
      return roundRectD(0, 0, w, h, r);
    case 'ellipse':
    case 'circle':
      return ellipseD(0, 0, w, h);
    case 'triangle':
      return roundedPoly([[w / 2, 0], [w, h], [0, h]], r);
    case 'diamond':
      return roundedPoly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], r);
    case 'polygon':
    case 'hexagon':
      return roundedPoly(regular(Math.max(3, opts.points || 6), w, h), r);
    case 'pentagon':
      return roundedPoly(regular(5, w, h), r);
    case 'star':
      return roundedPoly(regular(Math.max(3, opts.points || 5), w, h, opts.innerRatio ?? 0.45), r);
    case 'burst':
      return roundedPoly(regular(Math.max(6, opts.points || 16), w, h, opts.innerRatio ?? 0.78), r);
    case 'parallelogram':
      return roundedPoly([[w * 0.25, 0], [w, 0], [w * 0.75, h], [0, h]], r);
    case 'cross': {
      const t = 0.32;
      const a = w * (0.5 - t / 2), b = w * (0.5 + t / 2), c = h * (0.5 - t / 2), d = h * (0.5 + t / 2);
      return roundedPoly([[a, 0], [b, 0], [b, c], [w, c], [w, d], [b, d], [b, h], [a, h], [a, d], [0, d], [0, c], [a, c]], r);
    }
    case 'arrowShape': {
      const t = h * 0.22, head = Math.min(w * 0.45, h * 0.9);
      return roundedPoly([[0, h / 2 - t], [w - head, h / 2 - t], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h / 2 + t], [0, h / 2 + t]], r);
    }
    case 'heart': {
      const X = (v) => f(v * w), Y = (v) => f(v * h);
      return `M${X(0.5)},${Y(0.28)}C${X(0.5)},${Y(0.18)} ${X(0.4)},${Y(0)} ${X(0.25)},${Y(0)}C${X(0.08)},${Y(0)} ${X(0)},${Y(0.15)} ${X(0)},${Y(0.3)}C${X(0)},${Y(0.55)} ${X(0.3)},${Y(0.75)} ${X(0.5)},${Y(1)}C${X(0.7)},${Y(0.75)} ${X(1)},${Y(0.55)} ${X(1)},${Y(0.3)}C${X(1)},${Y(0.15)} ${X(0.92)},${Y(0)} ${X(0.75)},${Y(0)}C${X(0.6)},${Y(0)} ${X(0.5)},${Y(0.18)} ${X(0.5)},${Y(0.28)}Z`;
    }
    case 'speech': {
      const bh = h * 0.78, rr = Math.min(r || Math.min(w, bh) * 0.18, w / 2, bh / 2);
      return `M${f(rr)},0H${f(w - rr)}A${f(rr)},${f(rr)} 0 0 1 ${f(w)},${f(rr)}V${f(bh - rr)}A${f(rr)},${f(rr)} 0 0 1 ${f(w - rr)},${f(bh)}H${f(w * 0.42)}L${f(w * 0.2)},${f(h)}L${f(w * 0.26)},${f(bh)}H${f(rr)}A${f(rr)},${f(rr)} 0 0 1 0,${f(bh - rr)}V${f(rr)}A${f(rr)},${f(rr)} 0 0 1 ${f(rr)},0Z`;
    }
    case 'halfCircle':
      return `M0,${f(h)}A${f(w / 2)},${f(h)} 0 0 1 ${f(w)},${f(h)}Z`;
    case 'ring': {
      const t = opts.innerRatio ?? 0.6;
      const iw = w * t, ih = h * t;
      // Två ellipser med motsatt riktning → hål med nonzero-regeln
      const outer = ellipseD(0, 0, w, h);
      const ix = (w - iw) / 2, iy = (h - ih) / 2, irx = iw / 2, iry = ih / 2, icx = ix + irx, icy = iy + iry;
      const inner = `M${f(icx - irx)},${f(icy)}A${f(irx)},${f(iry)} 0 1 1 ${f(icx + irx)},${f(icy)}A${f(irx)},${f(iry)} 0 1 1 ${f(icx - irx)},${f(icy)}Z`;
      return outer + inner;
    }
    case 'blob': {
      const X = (v) => f(v * w), Y = (v) => f(v * h);
      return `M${X(0.52)},${Y(0.02)}C${X(0.75)},${Y(0)} ${X(0.98)},${Y(0.18)} ${X(0.97)},${Y(0.45)}C${X(0.96)},${Y(0.72)} ${X(0.8)},${Y(0.98)} ${X(0.5)},${Y(0.98)}C${X(0.22)},${Y(0.98)} ${X(0.02)},${Y(0.8)} ${X(0.03)},${Y(0.52)}C${X(0.04)},${Y(0.25)} ${X(0.28)},${Y(0.04)} ${X(0.52)},${Y(0.02)}Z`;
    }
    case 'line':
    case 'arrow':
      return `M0,${f(h / 2)}L${f(w)},${f(h / 2)}`;
    default:
      return roundRectD(0, 0, w, h, r);
  }
}

export const isOpenShape = (kind) => kind === 'line' || kind === 'arrow';

/** Pilspetsar för linjer (fyllda trianglar). */
export function arrowHeadsD(el) {
  const sw = el.stroke?.width || 8;
  const L = Math.max(sw * 3.2, 14), W = Math.max(sw * 2.6, 12);
  const y = el.h / 2;
  let d = '';
  if (el.arrowEnd) d += `M${f(el.w)},${f(y)}L${f(el.w - L)},${f(y - W / 2)}L${f(el.w - L)},${f(y + W / 2)}Z`;
  if (el.arrowStart) d += `M0,${f(y)}L${f(L)},${f(y - W / 2)}L${f(L)},${f(y + W / 2)}Z`;
  return { d, inset: L * 0.8 };
}

/** Sökväg för själva linjen, kortad så att den inte sticker ut genom pilspetsarna. */
export function lineD(el) {
  const { inset } = arrowHeadsD(el);
  const x0 = el.arrowStart ? inset : 0, x1 = el.arrowEnd ? el.w - inset : el.w;
  return `M${f(x0)},${f(el.h / 2)}L${f(x1)},${f(el.h / 2)}`;
}

export const MASK_SHAPES = [
  ['none', 'Ingen'], ['rounded', 'Rundad'], ['ellipse', 'Cirkel'], ['triangle', 'Triangel'], ['diamond', 'Romb'],
  ['hexagon', 'Hexagon'], ['star', 'Stjärna'], ['heart', 'Hjärta'], ['blob', 'Blobb'], ['arch', 'Valv'],
];

export function maskD(kind, w, h, radius = 0) {
  if (kind === 'arch') {
    const r = w / 2;
    return `M0,${f(h)}V${f(Math.min(r, h))}A${f(r)},${f(Math.min(r, h))} 0 0 1 ${f(w)},${f(Math.min(r, h))}V${f(h)}Z`;
  }
  if (kind === 'rounded') return roundRectD(0, 0, w, h, radius || Math.min(w, h) * 0.12);
  if (kind === 'hexagon') return shapeD('polygon', w, h, { points: 6 });
  if (kind === 'star') return shapeD('star', w, h, { points: 5, innerRatio: 0.5 });
  return shapeD(kind, w, h, { radius });
}
