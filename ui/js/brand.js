// Varumärkespaket: färger, fonter och logotyper som sparas i appen och är
// tillgängliga i alla designer (till skillnad från designens egen palett).
// Paketen ligger i webbläsarens IndexedDB, som rymmer logotyper utan problem,
// och kan exporteras som en fil för att flyttas mellan datorer.
import { emit } from './state.js';
import { uid, parseColor, toHex } from './util.js';

const DB = 'motiv', STORE = 'kv', KEY = 'brandKits';
let data = { kits: [], active: null };

function store(mode) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result.transaction(STORE, mode).objectStore(STORE));
  });
}
const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export async function initBrand() {
  try {
    const saved = await done((await store('readonly')).get(KEY));
    if (saved && Array.isArray(saved.kits)) data = { kits: saved.kits.map(clean).filter(Boolean), active: saved.active };
  } catch { /* utan lagring finns paketen bara under den här körningen */ }
  emit('brand');
}
function save() {
  emit('brand');
  store('readwrite').then((s) => done(s.put(data, KEY))).catch(() => {});
}

const hex = (c) => toHex(parseColor(c)).toLowerCase();
/** Rensar ett paket från okända eller trasiga fält (vid inläsning och import). */
function clean(k) {
  if (!k || typeof k !== 'object') return null;
  const strings = (a) => (Array.isArray(a) ? a.filter((v) => typeof v === 'string' && v) : []);
  return {
    id: typeof k.id === 'string' ? k.id : uid('b'),
    name: String(k.name || 'Varumärke').slice(0, 60),
    colors: strings(k.colors).filter((c) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c)).map(hex),
    fonts: strings(k.fonts),
    logos: (Array.isArray(k.logos) ? k.logos : []).filter((l) => l && typeof l.dataURL === 'string' && l.dataURL.startsWith('data:image/'))
      .map((l) => ({ id: typeof l.id === 'string' ? l.id : uid('l'), name: String(l.name || 'Logotyp').slice(0, 80), dataURL: l.dataURL })),
  };
}

export const brandKits = () => data.kits;
export const activeKit = () => data.kits.find((k) => k.id === data.active) || data.kits[0] || null;
export function setActiveKit(id) { data.active = id; save(); }

export function createKit(name = 'Mitt varumärke') {
  const kit = clean({ name });
  data.kits.push(kit);
  data.active = kit.id;
  save();
  return kit;
}
export function renameKit(id, name) {
  const k = data.kits.find((x) => x.id === id);
  if (k && name.trim()) { k.name = name.trim().slice(0, 60); save(); }
}
export function deleteKit(id) {
  data.kits = data.kits.filter((k) => k.id !== id);
  if (data.active === id) data.active = data.kits[0]?.id || null;
  save();
}

/** Lägger till en färg i det aktiva paketet (en gång per färg). Returnerar platsen. */
export function addBrandColor(c) {
  const k = activeKit();
  if (!k) return -1;
  c = hex(c);
  let i = k.colors.indexOf(c);
  if (i < 0) { i = k.colors.push(c) - 1; save(); }
  return i;
}
export function setBrandColor(i, c, final = true) {
  const k = activeKit();
  if (!k || i < 0 || i >= k.colors.length) return;
  k.colors[i] = hex(c);
  if (final) save();
}
export function removeBrandColor(i) { const k = activeKit(); if (k) { k.colors.splice(i, 1); save(); } }

export function addBrandFont(family) {
  const k = activeKit();
  if (k && family && !k.fonts.includes(family)) { k.fonts.push(family); save(); }
}
export function removeBrandFont(family) { const k = activeKit(); if (k) { k.fonts = k.fonts.filter((f) => f !== family); save(); } }

export function addBrandLogo(name, dataURL) {
  const k = activeKit();
  if (!k || k.logos.some((l) => l.dataURL === dataURL)) return;
  k.logos.push({ id: uid('l'), name: String(name || 'Logotyp').replace(/\.[^.]+$/, ''), dataURL });
  save();
}
export function removeBrandLogo(id) { const k = activeKit(); if (k) { k.logos = k.logos.filter((l) => l.id !== id); save(); } }

/** Paketet som text, för att sparas som fil. */
export function exportKit(kit) {
  return JSON.stringify({ app: 'motiv', kind: 'brandkit', version: 1, kit });
}
/** Läser in ett exporterat paket som ett nytt paket och gör det aktivt. */
export function importKit(text) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error('Filen är inte ett varumärkespaket'); }
  if (o?.kind !== 'brandkit' || !o.kit) throw new Error('Filen är inte ett varumärkespaket');
  const kit = clean({ ...o.kit, id: uid('b') });
  data.kits.push(kit);
  data.active = kit.id;
  save();
  return kit;
}

/** Bara för tester: börja om med tomt minne (sparar inte). */
export function resetBrandForTest() { data = { kits: [], active: null }; }
