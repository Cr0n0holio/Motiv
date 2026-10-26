// Dokumentmodell, markering, händelser och ångra/gör om.
import { uid, deepClone } from './util.js';

// ---------- Händelsebuss ----------
const listeners = {};
export function on(evt, fn) { (listeners[evt] ||= []).push(fn); return () => { listeners[evt] = listeners[evt].filter((f) => f !== fn); }; }
export function emit(evt, data) { (listeners[evt] || []).forEach((fn) => fn(data)); }

// ---------- Standardvärden ----------
export const DEFAULT_SHADOW = { enabled: false, color: '#00000066', blur: 12, x: 6, y: 6 };

// ---------- Sidor ----------
// Ett dokument har en eller flera sidor med samma storlek. Varje sida har egna
// element och egen bakgrund; bilderna (assets) delas av alla sidor.
//
// doc.elements och doc.background pekar alltid på den aktuella sidan
// (doc.pageIndex). Därför fungerar editorn, panelerna och åtgärderna som
// förut – de arbetar helt enkelt på den sida som visas. Egenskaperna är inte
// uppräkningsbara och följer alltså inte med när dokumentet sparas.

export function newPage() {
  return { id: uid('p'), background: { fill: { type: 'solid', color: '#ffffff' }, image: null }, elements: [] };
}

function attachPageAccessors(doc) {
  const cur = () => doc.pages[Math.min(doc.pageIndex, doc.pages.length - 1)];
  Object.defineProperties(doc, {
    pageIndex: { value: 0, writable: true, enumerable: false, configurable: true },
    elements: { get: () => cur().elements, set: (v) => { cur().elements = v; }, enumerable: false, configurable: true },
    background: { get: () => cur().background, set: (v) => { cur().background = v; }, enumerable: false, configurable: true },
  });
  return doc;
}

export function newDoc(width = 2480, height = 3508, dpi = 300) {
  return attachPageAccessors({ version: 2, width, height, dpi, pages: [newPage()], assets: {} });
}

/** En sida som ett fristående "dokument" för rendering och export. */
export function pageView(doc, i) {
  const p = doc.pages[i];
  return { width: doc.width, height: doc.height, dpi: doc.dpi, assets: doc.assets, elements: p.elements, background: p.background };
}

/** Alla element på alla sidor (för fonter, bilder och textlayout). */
export const allElements = (doc = state.doc) => doc.pages.flatMap((p) => p.elements);

export const state = {
  doc: newDoc(),
  selection: [],        // id:n för markerade element (toppnivå)
  zoom: 0.25,
  panX: 0,
  panY: 0,
  editingTextId: null,
  cropId: null,
  fileName: 'Namnlös design',
  filePath: null,
  dirty: false,
  clipboard: null,
  recentColors: [],
};

// ---------- Fabriker ----------
function base(type, extra) {
  return {
    id: uid(type[0]),
    type,
    name: '',
    x: 0, y: 0, w: 100, h: 100,
    rotation: 0,
    opacity: 1,
    blend: 'normal',
    visible: true,
    locked: false,
    flipX: false,
    flipY: false,
    ...extra,
  };
}

export function createText(opts = {}) {
  const el = base('text', {
    name: 'Text',
    text: 'Din text här',
    width: 800,
    fontFamily: 'Montserrat',
    fontSize: 120,
    fontWeight: 700,
    italic: false,
    underline: false,
    uppercase: false,
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,          // tusendelar av em (som Canva)
    fill: { type: 'solid', color: '#1d1d24' },
    stroke: { enabled: false, color: '#000000', width: 4 },
    shadow: { ...DEFAULT_SHADOW },
    glow: { enabled: false, color: '#ff4fd8', blur: 30 },
    background: { enabled: false, color: '#ffd166', padding: 0.25, radius: 0.2 },
    curve: { mode: 'none', amount: 50 },
  });
  Object.assign(el, deepClone(opts));
  return el;
}

export function createShape(kind, opts = {}) {
  const isLine = kind === 'line' || kind === 'arrow';
  const el = base('shape', {
    name: SHAPE_NAMES[kind] || 'Form',
    kind,
    w: 600, h: isLine ? 40 : 600,
    fill: isLine ? { type: 'none' } : { type: 'solid', color: '#7c3aed' },
    stroke: { enabled: isLine, color: '#1d1d24', width: isLine ? 12 : 8, dash: 'solid' },
    radius: kind === 'rounded' ? 60 : 0,
    points: kind === 'star' ? 5 : 6,
    innerRatio: 0.45,
    arrowStart: false,
    arrowEnd: kind === 'arrow',
    shadow: { ...DEFAULT_SHADOW },
  });
  Object.assign(el, deepClone(opts));
  return el;
}

export const SHAPE_NAMES = {
  rect: 'Rektangel', rounded: 'Rundad rektangel', ellipse: 'Ellips', triangle: 'Triangel',
  polygon: 'Polygon', star: 'Stjärna', heart: 'Hjärta', diamond: 'Romb', arrowShape: 'Pil',
  speech: 'Pratbubbla', cross: 'Kors', line: 'Linje', arrow: 'Pil (linje)', burst: 'Stjärnsprängning',
  blob: 'Blobb', halfCircle: 'Halvcirkel', ring: 'Ring', parallelogram: 'Parallellogram',
};

export const DEFAULT_FILTERS = { brightness: 0, contrast: 0, saturation: 0, hue: 0, warmth: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0, vignette: 0 };

export function createImage(assetId, w, h, opts = {}) {
  const el = base('image', {
    name: 'Bild',
    assetId,
    w, h,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    filters: { ...DEFAULT_FILTERS },
    preset: 'none',
    maskAssetId: null,
    maskShape: 'none',
    radius: 0,
    border: { enabled: false, color: '#ffffff', width: 20 },
    shadow: { ...DEFAULT_SHADOW },
  });
  Object.assign(el, deepClone(opts));
  return el;
}

export function createGroup(children) {
  const el = base('group', { name: 'Grupp', children });
  return el;
}

// ---------- Uppslag ----------
export const doc = () => state.doc;
export const getById = (id) => state.doc.elements.find((e) => e.id === id) || null;
export const selected = () => state.selection.map(getById).filter(Boolean);
export const single = () => (state.selection.length === 1 ? getById(state.selection[0]) : null);

export function select(ids, { silent = false } = {}) {
  state.selection = [...new Set(ids)].filter((id) => getById(id));
  if (!silent) emit('selection');
}

export function elementLabel(el) {
  if (el.name && el.name !== 'Text') return el.name;
  if (el.type === 'text') return el.text.split('\n')[0].slice(0, 40) || 'Text';
  return el.name || el.type;
}

// ---------- Historik ----------
// Varje steg är { s: ögonblicksbild, page: sidan där ändringen gjordes }.
// Att bara byta sida är inget ångringssteg, men när ett steg ångras eller
// görs om visas sidan där det hände, så att man ser vad som ändrades.
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 150;
let lastSnap = null;

function snapshot() {
  const d = state.doc;
  return JSON.stringify({ width: d.width, height: d.height, dpi: d.dpi, pages: d.pages });
}

export function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  lastSnap = snapshot();
  emit('history');
}

/** Registrerar nuvarande läge som ett ångringssteg (om något ändrats). */
export function commit() {
  const s = snapshot();
  if (s === lastSnap) return;
  if (lastSnap) undoStack.push({ s: lastSnap, page: state.doc.pageIndex });
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  lastSnap = s;
  markDirty();
  emit('history');
}

function restore(s, page) {
  const o = JSON.parse(s);
  const pageChanged = page !== state.doc.pageIndex;
  Object.assign(state.doc, o);
  state.doc.pageIndex = Math.max(0, Math.min(page, state.doc.pages.length - 1));
  lastSnap = s;
  state.selection = state.selection.filter((id) => getById(id));
  state.editingTextId = null;
  state.cropId = null;
  markDirty();
  emit('pages');
  if (pageChanged) emit('page');
  emit('doc');
  emit('selection');
  emit('history');
}

export function undo() {
  // Ändringar som väntar på att registreras (reglage, piltangenter) blir först
  // ett eget steg, så att Ctrl+Z ångrar just dem och inte steget före.
  commit();
  if (!undoStack.length) return;
  const step = undoStack.pop();
  redoStack.push({ s: lastSnap, page: step.page });
  restore(step.s, step.page);
}
export function redo() {
  if (!redoStack.length) return;
  const step = redoStack.pop();
  undoStack.push({ s: lastSnap, page: step.page });
  restore(step.s, step.page);
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function markDirty() { state.dirty = true; emit('dirty'); }

/** Ersätter hela dokumentet (Nytt / Öppna). */
export function loadDoc(d, { fileName, filePath } = {}) {
  state.doc = d;
  state.selection = [];
  state.editingTextId = null;
  state.cropId = null;
  if (fileName !== undefined) state.fileName = fileName;
  if (filePath !== undefined) state.filePath = filePath;
  resetHistory();
  state.dirty = false;
  emit('pages');
  emit('page');
  emit('doc:replaced');
  emit('doc');
  emit('selection');
  emit('dirty');
}

/** Ta bort bilder som inte längre används (inför sparning). */
export function usedAssetIds() {
  const used = new Set();
  const walk = (els) => els.forEach((e) => {
    if (e.type === 'image') { used.add(e.assetId); if (e.maskAssetId) used.add(e.maskAssetId); }
    if (e.type === 'group') walk(e.children);
  });
  for (const p of state.doc.pages) {
    walk(p.elements);
    const bg = p.background.image;
    if (bg) { used.add(bg.assetId); if (bg.maskAssetId) used.add(bg.maskAssetId); }
  }
  return used;
}

export function serializeDoc() {
  const d = state.doc;
  const used = usedAssetIds();
  const assets = {};
  for (const id of used) if (d.assets[id]) assets[id] = d.assets[id];
  return JSON.stringify({ app: 'motiv', version: 2, doc: { ...d, version: 2, assets } });
}

export function parseDoc(text) {
  const o = JSON.parse(text);
  const d = o.doc || o;
  if (!d || !d.width || !(Array.isArray(d.pages) || Array.isArray(d.elements))) throw new Error('Filen är inte ett Motiv-projekt');
  // Version 1 (en sida) blir ett dokument med en sida
  if (!Array.isArray(d.pages)) {
    d.pages = [{ id: uid('p'), elements: d.elements, background: d.background }];
    delete d.elements;
    delete d.background;
  }
  for (const p of d.pages) {
    p.id ||= uid('p');
    p.elements ||= [];
    p.background ||= { fill: { type: 'solid', color: '#ffffff' }, image: null };
  }
  if (!d.pages.length) d.pages.push(newPage());
  d.version = 2;
  d.assets ||= {};
  d.dpi ||= 300;
  return attachPageAccessors(d);
}

/** Nya id:n för en kopia (rekursivt för grupper). */
export function reId(el) {
  const c = deepClone(el);
  const walk = (e) => { e.id = uid(e.type[0]); if (e.type === 'group') e.children.forEach(walk); };
  walk(c);
  return c;
}
