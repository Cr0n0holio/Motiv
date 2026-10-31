// QR-koder: räknar ut rutmönstret (med qrcode-generator, MIT-licens) och gör
// en sökväg av det som canvas och SVG/PDF kan rita som vektor.
import qrcode from './vendor/qrcode.mjs';
import { stringToBytes as utf8 } from './vendor/qrcode_UTF8.mjs';

// Text kodas som UTF-8 så att å, ä och ö fungerar i alla läsare
qrcode.stringToBytes = utf8;

export const QR_LEVELS = [['L', 'Låg'], ['M', 'Medel'], ['Q', 'Hög'], ['H', 'Högsta']];

const cache = new Map();

/**
 * Rutmönstret för en text: { n, d } där n är antal rutor per sida och d en
 * SVG-sökväg med en enhet per ruta. null om texten är tom eller för lång.
 */
export function qrPath(text, level = 'M') {
  const key = level + '\u0001' + text;
  if (cache.has(key)) return cache.get(key);
  let res = null;
  if (text) {
    try {
      const qr = qrcode(0, level);
      qr.addData(text, 'Byte');
      qr.make();
      const n = qr.getModuleCount();
      // Sammanhängande mörka rutor på en rad blir en rektangel – färre delar
      let d = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (!qr.isDark(r, c)) continue;
          let e = c;
          while (e + 1 < n && qr.isDark(r, e + 1)) e++;
          d += `M${c} ${r}h${e - c + 1}v1h${-(e - c + 1)}z`;
          c = e;
        }
      }
      res = { n, d };
    } catch {
      res = null; // för mycket text för en QR-kod
    }
  }
  if (cache.size > 100) cache.clear();
  cache.set(key, res);
  return res;
}

/** Placering i elementets ruta: skala och förskjutning för sökvägen (med marginal). */
export function qrLayout(el) {
  const q = qrPath(el.text, el.level);
  if (!q) return null;
  const total = q.n + 2 * (el.margin ?? 2);
  const s = Math.min(el.w, el.h) / total;
  return { q, s, ox: (el.w - total * s) / 2 + (el.margin ?? 2) * s, oy: (el.h - total * s) / 2 + (el.margin ?? 2) * s };
}
