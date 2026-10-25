// Fyllningar: enfärg, linjär och radiell gradient. Delas av canvas och SVG.
import { rad, parseColor, round } from './util.js';

/** Gradientlinje som i CSS: 0° = nedifrån och upp, 90° = vänster till höger. */
export function gradientLine(angle, x, y, w, h) {
  const a = rad(angle);
  const dx = Math.sin(a), dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const cx = x + w / 2, cy = y + h / 2;
  return [cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half];
}

export function canvasPaint(ctx, paint, x, y, w, h) {
  if (!paint || paint.type === 'none') return null;
  if (paint.type === 'solid') return paint.color;
  let g;
  if (paint.type === 'radial') {
    const cx = x + w / 2, cy = y + h / 2;
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, Math.hypot(w, h) / 2));
  } else {
    const [x1, y1, x2, y2] = gradientLine(paint.angle ?? 90, x, y, w, h);
    g = ctx.createLinearGradient(x1, y1, x2, y2);
  }
  const stops = [...(paint.stops || [])].sort((a, b) => a.offset - b.offset);
  for (const s of stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), s.color);
  return g;
}

export const paintIsVisible = (p) => p && p.type !== 'none' && (p.type !== 'solid' || parseColor(p.color).a > 0);

/** CSS-värde (för förhandsvisningar i gränssnittet). */
export function paintCss(p) {
  if (!p || p.type === 'none') return 'transparent';
  if (p.type === 'solid') return p.color;
  const stops = [...p.stops].sort((a, b) => a.offset - b.offset).map((s) => `${s.color} ${round(s.offset * 100, 1)}%`).join(', ');
  return p.type === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${p.angle ?? 90}deg, ${stops})`;
}

export function svgColorAttrs(color, prefix = 'fill') {
  const c = parseColor(color);
  const rgb = `rgb(${c.r},${c.g},${c.b})`;
  return c.a < 1 ? `${prefix}="${rgb}" ${prefix}-opacity="${round(c.a, 3)}"` : `${prefix}="${rgb}"`;
}

/**
 * Returnerar { attr, def } för SVG. def läggs i <defs>, attr på elementet.
 * ids: räknare för unika id:n.
 */
export function svgPaint(paint, x, y, w, h, ids, prefix = 'fill') {
  if (!paint || paint.type === 'none') return { attr: `${prefix}="none"`, def: '' };
  if (paint.type === 'solid') return { attr: svgColorAttrs(paint.color, prefix), def: '' };
  const id = `g${ids.next++}`;
  const stops = [...paint.stops].sort((a, b) => a.offset - b.offset).map((s) => {
    const c = parseColor(s.color);
    return `<stop offset="${round(s.offset, 4)}" stop-color="rgb(${c.r},${c.g},${c.b})"${c.a < 1 ? ` stop-opacity="${round(c.a, 3)}"` : ''}/>`;
  }).join('');
  let def;
  if (paint.type === 'radial') {
    const cx = x + w / 2, cy = y + h / 2, r = Math.max(1, Math.hypot(w, h) / 2);
    def = `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fx="${round(cx)}" fy="${round(cy)}">${stops}</radialGradient>`;
  } else {
    const [x1, y1, x2, y2] = gradientLine(paint.angle ?? 90, x, y, w, h);
    def = `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}">${stops}</linearGradient>`;
  }
  return { attr: `${prefix}="url(#${id})"`, def };
}

export const GRADIENT_PRESETS = [
  { type: 'linear', angle: 135, stops: [{ offset: 0, color: '#7c3aed' }, { offset: 1, color: '#ec4899' }] },
  { type: 'linear', angle: 135, stops: [{ offset: 0, color: '#f97316' }, { offset: 1, color: '#facc15' }] },
  { type: 'linear', angle: 180, stops: [{ offset: 0, color: '#0ea5e9' }, { offset: 1, color: '#22d3ee' }] },
  { type: 'linear', angle: 135, stops: [{ offset: 0, color: '#10b981' }, { offset: 1, color: '#a3e635' }] },
  { type: 'linear', angle: 180, stops: [{ offset: 0, color: '#0f172a' }, { offset: 1, color: '#334155' }] },
  { type: 'linear', angle: 160, stops: [{ offset: 0, color: '#ff9a9e' }, { offset: 1, color: '#fecfef' }] },
  { type: 'linear', angle: 120, stops: [{ offset: 0, color: '#fde68a' }, { offset: 0.5, color: '#f472b6' }, { offset: 1, color: '#6366f1' }] },
  { type: 'linear', angle: 180, stops: [{ offset: 0, color: '#1e3a8a' }, { offset: 0.55, color: '#9333ea' }, { offset: 1, color: '#f97316' }] },
  { type: 'radial', stops: [{ offset: 0, color: '#fef3c7' }, { offset: 1, color: '#f59e0b' }] },
  { type: 'radial', stops: [{ offset: 0, color: '#312e81' }, { offset: 1, color: '#020617' }] },
  { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#d4af37' }, { offset: 0.5, color: '#fff3b0' }, { offset: 1, color: '#b8860b' }] },
  { type: 'linear', angle: 180, stops: [{ offset: 0, color: '#e0e0e0' }, { offset: 0.5, color: '#ffffff' }, { offset: 1, color: '#9e9e9e' }] },
];
