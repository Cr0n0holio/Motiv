// Bildhantering: cache av inlästa bilder, filter, beskärning, masker.
// En "bearbetad" bild ritas i den upplösning som behövs och cachas.
import { state, emit, allElements } from './state.js';
import { maskD } from './shapes.js';
import { loadImage, clamp } from './util.js';

const imgCache = new Map();      // assetId -> HTMLImageElement
const pending = new Map();       // assetId -> Promise
const maskedCache = new Map();   // assetId|maskId -> canvas
const processed = new Map();     // nyckel -> canvas (LRU)
const MAX_PROCESSED = 80; // editorn + sidremsans förhandsbilder

export function getImage(assetId) {
  const img = imgCache.get(assetId);
  if (img) return img;
  if (!pending.has(assetId) && state.doc.assets[assetId]) {
    const p = loadImage(state.doc.assets[assetId])
      .then((im) => { imgCache.set(assetId, im); pending.delete(assetId); emit('image-loaded', assetId); return im; })
      .catch(() => { pending.delete(assetId); });
    pending.set(assetId, p);
  }
  return null;
}

export async function ensureImage(assetId) {
  const img = getImage(assetId);
  if (img) return img;
  const p = pending.get(assetId);
  return p ? p : null;
}

/** Laddar alla bilder som används på någon sida (inför export och öppning). */
export async function ensureAllImages(els = allElements()) {
  const ids = new Set();
  const walk = (list) => list.forEach((e) => {
    if (e.type === 'image') { ids.add(e.assetId); if (e.maskAssetId) ids.add(e.maskAssetId); }
    if (e.type === 'group') walk(e.children);
  });
  walk(els);
  for (const p of state.doc.pages) {
    const bg = p.background.image;
    if (bg) { ids.add(bg.assetId); if (bg.maskAssetId) ids.add(bg.maskAssetId); }
  }
  await Promise.all([...ids].map((id) => ensureImage(id)));
}

/** Källa med AI-mask applicerad (full upplösning). */
function sourceFor(assetId, maskId) {
  const img = getImage(assetId);
  if (!img) return null;
  if (!maskId) return img;
  const key = assetId + '|' + maskId;
  let c = maskedCache.get(key);
  if (c) return c;
  const mask = getImage(maskId);
  if (!mask) return img;
  c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(mask, 0, 0, c.width, c.height);
  maskedCache.set(key, c);
  return c;
}

export function sourceSize(assetId) {
  const img = getImage(assetId);
  return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
}

export function filterString(f, pxScale = 1) {
  if (!f) return 'none';
  const parts = [];
  if (f.brightness) parts.push(`brightness(${1 + f.brightness / 100})`);
  if (f.contrast) parts.push(`contrast(${1 + f.contrast / 100})`);
  if (f.saturation) parts.push(`saturate(${1 + f.saturation / 100})`);
  if (f.hue) parts.push(`hue-rotate(${f.hue}deg)`);
  if (f.grayscale) parts.push(`grayscale(${f.grayscale / 100})`);
  if (f.sepia) parts.push(`sepia(${f.sepia / 100})`);
  if (f.invert) parts.push(`invert(${f.invert / 100})`);
  if (f.blur) parts.push(`blur(${(f.blur * pxScale).toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

export const FILTER_PRESETS = [
  { id: 'none', name: 'Original', f: {} },
  { id: 'vivid', name: 'Livfull', f: { saturation: 35, contrast: 12, brightness: 4 } },
  { id: 'warm', name: 'Varm', f: { warmth: 40, saturation: 10 } },
  { id: 'cool', name: 'Kall', f: { warmth: -40, brightness: 3 } },
  { id: 'vintage', name: 'Vintage', f: { sepia: 45, contrast: -8, saturation: -15, vignette: 35, warmth: 15 } },
  { id: 'bw', name: 'Svartvit', f: { grayscale: 100, contrast: 12 } },
  { id: 'noir', name: 'Noir', f: { grayscale: 100, contrast: 45, brightness: -8, vignette: 50 } },
  { id: 'fade', name: 'Blek', f: { contrast: -25, brightness: 10, saturation: -25 } },
  { id: 'drama', name: 'Dramatisk', f: { contrast: 40, saturation: -10, vignette: 45, brightness: -5 } },
  { id: 'dream', name: 'Drömsk', f: { brightness: 12, saturation: 20, blur: 1, warmth: 10 } },
  { id: 'cinema', name: 'Film', f: { contrast: 18, saturation: -12, warmth: -18, vignette: 30, hue: -6 } },
  { id: 'pop', name: 'Pop', f: { saturation: 80, contrast: 25, hue: 8 } },
];

function filterKey(f) {
  return f ? Object.keys(f).sort().map((k) => `${k}:${f[k]}`).join(',') : '';
}

/**
 * Ritar en bild (beskuren, filtrerad, maskad) till en canvas med storleken tw×th.
 * el: { assetId, maskAssetId, crop, filters, maskShape, radius, w, h }
 */
export function getProcessed(el, tw, th) {
  tw = clamp(Math.round(tw), 1, 8192);
  th = clamp(Math.round(th), 1, 8192);
  const src = sourceFor(el.assetId, el.maskAssetId);
  if (!src) return null;
  const crop = el.crop || { x: 0, y: 0, w: 1, h: 1 };
  const key = [el.assetId, el.maskAssetId || '', crop.x, crop.y, crop.w, crop.h, filterKey(el.filters), el.maskShape || 'none', el.radius || 0, tw, th, el.w, el.h].join('|');
  const hit = processed.get(key);
  if (hit) { processed.delete(key); processed.set(key, hit); return hit; }

  const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
  const c = document.createElement('canvas');
  c.width = tw; c.height = th;
  const x = c.getContext('2d');
  const pxScale = tw / Math.max(1, el.w);
  const f = el.filters || {};

  if (el.maskShape && el.maskShape !== 'none') {
    x.save();
    x.scale(pxScale, th / Math.max(1, el.h));
    x.clip(new Path2D(maskD(el.maskShape, el.w, el.h, el.radius || 0)));
    x.setTransform(1, 0, 0, 1, 0, 0);
  }
  x.imageSmoothingQuality = 'high';
  x.filter = filterString(f, pxScale);
  x.drawImage(src, crop.x * sw, crop.y * sh, crop.w * sw, crop.h * sh, 0, 0, tw, th);
  x.filter = 'none';

  // Värme: färgton via soft-light, bara där bilden har pixlar
  if (f.warmth) {
    const t = document.createElement('canvas');
    t.width = tw; t.height = th;
    const tx = t.getContext('2d');
    tx.fillStyle = f.warmth > 0 ? `rgba(255,150,40,${Math.abs(f.warmth) / 100 * 0.6})` : `rgba(40,120,255,${Math.abs(f.warmth) / 100 * 0.6})`;
    tx.fillRect(0, 0, tw, th);
    tx.globalCompositeOperation = 'destination-in';
    tx.drawImage(c, 0, 0);
    x.globalCompositeOperation = 'soft-light';
    x.drawImage(t, 0, 0);
    x.globalCompositeOperation = 'source-over';
  }
  // Vinjett
  if (f.vignette) {
    const g = x.createRadialGradient(tw / 2, th / 2, Math.min(tw, th) * 0.25, tw / 2, th / 2, Math.hypot(tw, th) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${f.vignette / 100 * 0.85})`);
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = g;
    x.fillRect(0, 0, tw, th);
    x.globalCompositeOperation = 'source-over';
  }
  if (el.maskShape && el.maskShape !== 'none') x.restore();

  processed.set(key, c);
  if (processed.size > MAX_PROCESSED) processed.delete(processed.keys().next().value);
  return c;
}

/**
 * Lämplig upplösning i editorn: aldrig mer än källans pixlar, och avrundad
 * uppåt till fasta steg (~19 %). Utan stegen skulle varje zoomnivå ge en ny
 * storlek – och en ny, dyr omräkning av filtren – i varje bildruta.
 */
export function targetSize(el, scale) {
  const s = sourceSize(el.assetId);
  const crop = el.crop || { w: 1, h: 1 };
  let tw = el.w * scale, th = el.h * scale;
  const step = 2 ** (Math.ceil(Math.log2(Math.max(1, tw)) * 4) / 4) / Math.max(1, tw);
  tw *= step; th *= step;
  if (s) {
    const maxW = s.w * crop.w, maxH = s.h * crop.h;
    const k = Math.min(1, maxW / tw, maxH / th);
    if (k < 1 && !(el.filters?.blur)) { tw *= k; th *= k; }
  }
  return { tw: Math.max(1, tw), th: Math.max(1, th) };
}

/** Beskärning som fyller w×h (som CSS object-fit: cover). */
export function coverCrop(sw, sh, w, h) {
  const sr = sw / sh, r = w / h;
  if (sr > r) { const cw = r / sr; return { x: (1 - cw) / 2, y: 0, w: cw, h: 1 }; }
  const ch = sr / r;
  return { x: 0, y: (1 - ch) / 2, w: 1, h: ch };
}

// ---------- Genomskinlighet för klick ----------
const alphaMaps = new Map(); // assetId|maskId -> { w, h, data }
const ALPHA_SIZE = 256;

/**
 * Täckningen (0–255) i punkten (u, v) av en bild, där u och v är 0–1 över
 * hela källbilden. Räknas på en nedskalad kopia som cachas. Ger 255 om
 * bilden inte är laddad än, så att klick fungerar som vanligt under tiden.
 */
export function alphaAt(assetId, maskId, u, v) {
  const key = assetId + '|' + (maskId || '');
  let m = alphaMaps.get(key);
  if (!m) {
    const asset = state.doc.assets[assetId] || '';
    // Foton utan AI-mask är alltid täckande
    if (!maskId && asset.startsWith('data:image/jpeg')) return 255;
    const src = sourceFor(assetId, maskId);
    if (!src || (maskId && !getImage(maskId))) return 255;
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    const s = Math.min(1, ALPHA_SIZE / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * s));
    c.height = Math.max(1, Math.round(sh * s));
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, 0, 0, c.width, c.height);
    const rgba = x.getImageData(0, 0, c.width, c.height).data;
    const data = new Uint8Array(c.width * c.height);
    for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3];
    m = { w: c.width, h: c.height, data };
    alphaMaps.set(key, m);
  }
  const px = clamp(Math.floor(u * m.w), 0, m.w - 1), py = clamp(Math.floor(v * m.h), 0, m.h - 1);
  return m.data[py * m.w + px];
}

// ---------- Krympning av stora foton ----------
const SHRINK_KEY = 'motiv.shrinkImages';
export function shrinkEnabled() {
  try { return localStorage.getItem(SHRINK_KEY) !== '0'; } catch { return true; }
}
export function setShrinkEnabled(on) {
  try { localStorage.setItem(SHRINK_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

/** Har bilden några genomskinliga pixlar? (Undersöks i liten skala.) */
function hasAlpha(img) {
  const s = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, c.width, c.height);
  const a = x.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < a.length; i += 4) if (a[i] < 250) return true;
  return false;
}

/**
 * Krymper ett foto som har fler pixlar än designen kan visa. Längsta sidan
 * blir högst maxSide; foton sparas som JPEG, bilder med genomskinlighet som
 * PNG. Vektorbilder (SVG) och GIF lämnas orörda, liksom allt där krympningen
 * inte ger en mindre fil. Returnerar { dataURL, from, to } där from/to är
 * pixelmåtten, eller null om bilden lämnades som den var.
 */
export async function shrinkImage(dataURL, maxSide) {
  const mime = String(dataURL).slice(5, String(dataURL).indexOf(';'));
  if (!/^image\/(jpeg|png|webp|bmp|avif)$/.test(mime)) return null;
  const img = await loadImage(dataURL);
  const w = img.naturalWidth, h = img.naturalHeight;
  const k = maxSide / Math.max(w, h);
  if (k >= 1) return null;
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, c.width, c.height);
  const out = mime !== 'image/jpeg' && hasAlpha(img) ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
  if (out.length >= dataURL.length) return null;
  return { dataURL: out, from: [w, h], to: [c.width, c.height] };
}

export function clearImageCaches() {
  processed.clear();
  maskedCache.clear();
}

export function forgetAsset(id) {
  imgCache.delete(id);
  for (const k of [...maskedCache.keys()]) if (k.includes(id)) maskedCache.delete(k);
}
