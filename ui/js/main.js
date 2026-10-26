// Motiv – start och sammankoppling.
import {
  state, on, emit, commit, undo, redo, canUndo, canRedo, select, selected, single, newDoc, loadDoc, serializeDoc, parseDoc, getById, allElements,
} from './state.js';
import { initPageBar, goToPage, addPage, duplicatePage, deletePage, pageCount, currentPage } from './pages.js';
import { h, blobToDataURL, debounce } from './util.js';
import { isTauri, invoke, saveText, openText } from './bridge.js';
import {
  initEditor, requestRender, fitToScreen, zoomTo, zoomBy, startTextEdit, finishTextEdit, startCrop, finishCrop, isTyping,
  setContextMenuHider, screenToDocFromClient, hitTest, getCanvas, exitGroupEditing,
} from './editor.js';
import { initProperties } from './properties.js';
import { initLeftPanel, openTab, uploadImages } from './leftpanel.js';
import { initFonts, ensureDocFonts, missingFamilies } from './fonts.js';
import { icon } from './controls.js';
import { toast, modal, confirmDialog } from './dialogs.js';
import { openExportDialog } from './exporter.js';
import { openBgRemoval } from './bgremoval.js';
import { closeColorPicker } from './colorpicker.js';
import { closeFontPicker } from './fontpicker.js';
import { ensureAllImages, clearImageCaches } from './images.js';
import * as A from './actions.js';

const $ = (s) => document.querySelector(s);

// ---------------- Toppfältet ----------------
function buildTopbar() {
  const bar = $('#topbar');
  const fileBtn = h('button', { class: 'menu-btn' }, 'Arkiv', icon('chevron'));
  const editBtn = h('button', { class: 'menu-btn' }, 'Redigera', icon('chevron'));
  const undoBtn = h('button', { class: 'icon-btn', title: 'Ångra (Ctrl+Z)', onclick: undo }, icon('undo'));
  const redoBtn = h('button', { class: 'icon-btn', title: 'Gör om (Ctrl+Y)', onclick: redo }, icon('redo'));
  const title = h('input', { class: 'doc-title', value: state.fileName, spellcheck: false, title: 'Designens namn' });
  title.addEventListener('change', () => { state.fileName = title.value.trim() || 'Namnlös design'; updateTitle(); });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur(); e.stopPropagation(); });
  const dirtyDot = h('span', { class: 'dirty-dot', title: 'Osparade ändringar' });
  const exportBtn = h('button', { class: 'btn primary', onclick: openExportDialog }, icon('download'), 'Exportera');

  bar.append(
    h('div', { class: 'brand' }, h('span', { class: 'logo' }), h('span', { class: 'brand-name' }, 'Motiv')),
    fileBtn, editBtn,
    h('span', { class: 'sep' }),
    undoBtn, redoBtn,
    h('div', { class: 'title-wrap' }, title, dirtyDot),
    h('span', { class: 'grow' }),
    exportBtn,
  );

  fileBtn.addEventListener('click', () => showMenu(fileBtn, [
    ['Ny design', 'Ctrl+N', newDesign],
    ['Öppna…', 'Ctrl+O', openProject],
    ...recentMenuItems(),
    null,
    ['Spara', 'Ctrl+S', () => saveProject(false)],
    ['Spara som…', 'Ctrl+Shift+S', () => saveProject(true)],
    null,
    ['Ladda upp bilder…', 'Ctrl+I', uploadImages],
    ['Exportera…', 'Ctrl+E', openExportDialog],
    null,
    ['Om Motiv', '', about],
  ]));
  editBtn.addEventListener('click', () => showMenu(editBtn, [
    ['Ångra', 'Ctrl+Z', undo, !canUndo()],
    ['Gör om', 'Ctrl+Y', redo, !canRedo()],
    null,
    ['Klipp ut', 'Ctrl+X', A.cutSelection, !state.selection.length],
    ['Kopiera', 'Ctrl+C', A.copySelection, !state.selection.length],
    ['Klistra in', 'Ctrl+V', A.pasteInternal, !state.clipboard],
    ['Duplicera', 'Ctrl+D', () => A.duplicateSelection(), !state.selection.length],
    ['Ta bort', 'Delete', A.deleteSelection, !state.selection.length],
    null,
    ['Markera allt', 'Ctrl+A', A.selectAll],
    ['Gruppera', 'Ctrl+G', A.groupSelection, state.selection.length < 2],
    ['Dela upp grupp', 'Ctrl+Shift+G', A.ungroupSelection, !selected().some((e) => e.type === 'group')],
    null,
    ['Ny sida', 'Ctrl+Enter', () => addPage()],
    ['Duplicera sida', '', () => duplicatePage()],
    ['Ta bort sida', '', () => deletePage(), pageCount() <= 1],
    ['Föregående sida', 'Page Up', () => goToPage(currentPage() - 1), currentPage() === 0],
    ['Nästa sida', 'Page Down', () => goToPage(currentPage() + 1), currentPage() >= pageCount() - 1],
  ]));

  on('history', () => { undoBtn.disabled = !canUndo(); redoBtn.disabled = !canRedo(); });
  on('dirty', () => { dirtyDot.classList.toggle('on', state.dirty); updateTitle(); });
  on('doc:replaced', () => { title.value = state.fileName; updateTitle(); });
  undoBtn.disabled = redoBtn.disabled = true;
}

let shownTitle = '';
function updateTitle() {
  const t = `${state.dirty ? '• ' : ''}${state.fileName} – Motiv`;
  // Anropas vid varje musrörelse under drag – rör bara fönstret när titeln ändras
  if (t === shownTitle) return;
  shownTitle = t;
  document.title = t;
  if (isTauri) { try { window.__TAURI__.window?.getCurrentWindow?.().setTitle(t).catch(() => {}); } catch { /* ignore */ } }
}

// ---------------- Menyer ----------------
let menuEl = null;
function hideMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function showMenu(anchorOrPoint, items) {
  hideMenu();
  menuEl = h('div', { class: 'menu' }, items.map((it) => {
    if (!it) return h('div', { class: 'menu-sep' });
    const [label, kb, fn, disabled] = it;
    return h('button', { class: 'menu-item', disabled: !!disabled, onclick: () => { hideMenu(); fn(); } }, h('span', null, label), h('kbd', null, kb || ''));
  }));
  document.body.append(menuEl);
  const r = anchorOrPoint instanceof Element ? anchorOrPoint.getBoundingClientRect() : { left: anchorOrPoint.x, bottom: anchorOrPoint.y };
  const mr = menuEl.getBoundingClientRect();
  menuEl.style.left = `${Math.min(r.left, window.innerWidth - mr.width - 8)}px`;
  menuEl.style.top = `${Math.min(r.bottom + 4, window.innerHeight - mr.height - 8)}px`;
  setTimeout(() => document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) hideMenu(); }, { once: true, capture: true }), 0);
}

function contextMenu(e) {
  e.preventDefault();
  const els = selected();
  const el = els.length === 1 ? els[0] : null;
  const items = [];
  if (el?.type === 'text') items.push(['Redigera text', 'Enter', () => startTextEdit(el, true)], null);
  if (el?.type === 'image') items.push(['Beskär', 'Dubbelklick', () => startCrop(el)], ['Ta bort bakgrund…', '', () => openBgRemoval(el)], ['Använd som bakgrund', '', () => A.setImageAsBackground(el)], null);
  if (els.length) {
    items.push(['Kopiera', 'Ctrl+C', A.copySelection], ['Klipp ut', 'Ctrl+X', A.cutSelection]);
  }
  items.push(['Klistra in', 'Ctrl+V', A.pasteInternal, !state.clipboard]);
  if (els.length) {
    items.push(['Duplicera', 'Ctrl+D', () => A.duplicateSelection()], ['Ta bort', 'Delete', A.deleteSelection], null,
      ['Längst fram', 'Ctrl+Shift+]', () => A.arrange('front')], ['Framåt', 'Ctrl+]', () => A.arrange('forward')],
      ['Bakåt', 'Ctrl+[', () => A.arrange('backward')], ['Längst bak', 'Ctrl+Shift+[', () => A.arrange('back')], null);
    if (els.length > 1) items.push(['Gruppera', 'Ctrl+G', A.groupSelection]);
    if (el?.type === 'group') items.push(['Redigera innehåll', 'Dubbelklick', () => A.enterGroup(el, el.children[el.children.length - 1]?.id)]);
    if (els.some((x) => x.type === 'group')) items.push(['Dela upp grupp', 'Ctrl+Shift+G', A.ungroupSelection]);
    items.push([els.every((x) => x.locked) ? 'Lås upp' : 'Lås', 'Ctrl+L', A.toggleLock]);
  } else {
    items.push(null, ['Markera allt', 'Ctrl+A', A.selectAll], ['Anpassa till fönster', 'Ctrl+0', fitToScreen]);
  }
  showMenu({ x: e.clientX, y: e.clientY }, items);
}

// ---------------- Zoom-kontroller ----------------
// ---------------- Öppnad grupp ----------------
/** Liten etikett överst på arbetsytan när man redigerar inuti en grupp. */
function buildGroupBar() {
  const label = h('span', { class: 'gb-label' });
  const bar = h('div', { id: 'groupbar' }, icon('group'), label,
    h('button', { class: 'btn small primary', title: 'Lämna gruppen (Esc)', onclick: exitGroupEditing }, 'Klar'));
  $('#workspace').append(bar);
  const upd = () => {
    const path = state.doc.groupPath;
    bar.classList.toggle('on', path.length > 0);
    if (path.length) label.textContent = `Redigerar gruppen – ${state.doc.elements.length} delar`;
  };
  on('group', upd);
  on('doc', upd);
  on('page', upd);
}

function buildZoomBar() {
  const zb = $('#zoombar');
  const pct = h('button', { class: 'zoom-pct', title: 'Zoomnivåer' });
  const range = h('input', { type: 'range', class: 'range zoom-range', min: -4.6, max: 2.3, step: 0.01 });
  range.addEventListener('input', () => zoomTo(Math.exp(+range.value)));
  pct.addEventListener('click', () => showMenu(pct, [
    ['Anpassa till fönster', 'Ctrl+0', fitToScreen], null,
    ...[25, 50, 75, 100, 150, 200, 400].map((p) => [`${p} %`, p === 100 ? 'Ctrl+1' : '', () => zoomTo(p / 100)]),
  ]));
  zb.append(
    h('button', { class: 'icon-btn', title: 'Zooma ut (Ctrl+−)', onclick: () => zoomBy(1 / 1.25) }, icon('minus')),
    range,
    h('button', { class: 'icon-btn', title: 'Zooma in (Ctrl++)', onclick: () => zoomBy(1.25) }, icon('plus')),
    pct,
    h('button', { class: 'icon-btn', title: 'Anpassa till fönster (Ctrl+0)', onclick: fitToScreen }, icon('fit')),
  );
  const upd = () => { pct.textContent = `${Math.round(state.zoom * 100)} %`; if (document.activeElement !== range) range.value = Math.log(state.zoom); };
  on('zoom', upd);
  upd();
}

// ---------------- Fil ----------------
const FILTER = [{ name: 'Motiv-projekt', extensions: ['motiv'] }];
// Gamla projekt från när appen hette Ediholio går fortfarande att öppna
const OPEN_FILTER = [{ name: 'Motiv-projekt', extensions: ['motiv', 'ediholio'] }];
const PROJECT_EXT = /\.(motiv|ediholio)$/i;

async function confirmDiscard() {
  if (!state.dirty || !allElements().length) return true;
  return confirmDialog('Osparade ändringar', 'Du har ändringar som inte är sparade. Vill du fortsätta ändå?', { ok: 'Fortsätt utan att spara', danger: true });
}

async function newDesign() {
  if (!(await confirmDiscard())) return;
  const d = state.doc;
  loadDoc(newDoc(d.width, d.height, d.dpi), { fileName: 'Namnlös design', filePath: null });
  clearImageCaches();
  openTab('format');
}

// ---------------- Senaste filer ----------------
// Bara i skrivbordsappen, där filerna har en sökväg som går att öppna igen.
const RECENT_KEY = 'motiv.recentFiles';
const MAX_RECENT = 8;
const baseName = (p) => p.split(/[\\/]/).pop();
function recentFiles() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function setRecentFiles(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT))); } catch { /* ignore */ }
}
function rememberFile(path) {
  if (!isTauri || !path) return;
  setRecentFiles([path, ...recentFiles().filter((p) => p !== path)]);
}
function recentMenuItems() {
  const list = isTauri ? recentFiles() : [];
  if (!list.length) return [];
  return [
    null,
    ...list.map((p) => [baseName(p).replace(PROJECT_EXT, ''), '', () => openRecent(p)]),
    ['Rensa listan', '', () => setRecentFiles([])],
  ];
}
async function openRecent(path) {
  if (!(await confirmDiscard())) return;
  let text;
  try {
    text = await invoke('read_text_file', { path });
  } catch {
    setRecentFiles(recentFiles().filter((p) => p !== path));
    toast(`Kunde inte öppna ${baseName(path)} – filen kan ha flyttats eller tagits bort. Den togs bort ur listan.`, 'error', { timeout: 7000 });
    return;
  }
  try { await loadProjectText(text, baseName(path), path); } catch (e) { toast(`Kunde inte öppna filen: ${e.message || e}`, 'error'); }
}

async function openProject() {
  if (!(await confirmDiscard())) return;
  try {
    const f = await openText(OPEN_FILTER);
    if (!f) return;
    await loadProjectText(f.text, f.name, f.path);
  } catch (e) { toast(`Kunde inte öppna filen: ${e.message || e}`, 'error'); }
}

async function loadProjectText(text, name, path) {
  const d = parseDoc(text);
  clearImageCaches();
  loadDoc(d, { fileName: name.replace(PROJECT_EXT, ''), filePath: path });
  rememberFile(path);
  await ensureAllImages();
  await ensureDocFonts(allElements(d));
  A.relayoutAllText();
  emit('doc');
  toast(`Öppnade ${name}`, 'ok');
  const missing = missingFamilies(allElements(d));
  if (missing.length) {
    toast(`Fonter som saknas på den här datorn: ${missing.join(', ')}. Texten visas med en ersättningsfont tills du lägger till dem via fontväljaren (Lägg till fontfil…).`, 'error', { timeout: 12000 });
  }
}

async function saveProject(saveAs) {
  finishTextEdit();
  try {
    const text = serializeDoc();
    const path = await saveText(text, `${state.fileName}.motiv`, FILTER, saveAs ? null : state.filePath);
    if (!path) return;
    state.filePath = isTauri ? path : null;
    state.fileName = baseName(path).replace(PROJECT_EXT, '');
    rememberFile(state.filePath);
    state.dirty = false;
    emit('dirty');
    emit('doc:replaced');
    if (isTauri) invoke('autosave_clear').catch(() => {});
    toast('Sparat', 'ok');
    return true;
  } catch (e) { toast(`Kunde inte spara: ${e.message || e}`, 'error'); return false; }
}

// ---------------- Stängning ----------------
function askSaveBeforeClose() {
  return new Promise((resolve) => {
    let answer = 'cancel';
    modal({
      title: 'Spara ändringarna?',
      body: h('p', null, `Vill du spara ändringarna i "${state.fileName}" innan du stänger?`),
      onClose: () => resolve(answer),
      actions: [
        { label: 'Avbryt' },
        { label: 'Stäng utan att spara', danger: true, onClick: () => { answer = 'discard'; } },
        { label: 'Spara', primary: true, onClick: () => { answer = 'save'; } },
      ],
    });
  });
}

/** Skrivbordsappen: fråga innan fönstret stängs med osparade ändringar. */
function setupCloseGuard() {
  const win = window.__TAURI__?.window?.getCurrentWindow?.();
  if (!win?.onCloseRequested) return;
  let closing = false;
  win.onCloseRequested(async (e) => {
    finishTextEdit();
    if (closing || !state.dirty || !allElements().length) return;
    e.preventDefault();
    const choice = await askSaveBeforeClose();
    if (choice === 'cancel') return;
    if (choice === 'save' && !(await saveProject(false))) return;
    if (choice === 'discard') await invoke('autosave_clear').catch(() => {});
    closing = true;
    await win.destroy();
  });
}

async function about() {
  let version = '';
  try { if (isTauri) version = `Version ${(await invoke('app_info')).version}`; } catch { /* ignore */ }
  modal({
    title: 'Om Motiv',
    body: h('div', null,
      version ? h('p', null, h('b', null, version)) : null,
      h('p', null, 'Motiv är en Canva-inspirerad editor för posters och bilder, byggd med Rust (Tauri) och ett webbgränssnitt.'),
      h('p', { class: 'muted small' }, isTauri ? 'Skrivbordsläge: fonter, bakgrundsborttagning och PDF hanteras av Rust.' : 'Webbläsarläge: vissa funktioner (PDF, bakgrundsborttagning, systemfonter) kräver skrivbordsappen.'),
    ),
    actions: [{ label: 'Stäng', primary: true }],
  });
}

// ---------------- Autosparning ----------------
const autosave = debounce(async () => {
  if (!state.dirty) return;
  const text = serializeDoc();
  try {
    if (isTauri) await invoke('autosave_write', { contents: JSON.stringify({ name: state.fileName, path: state.filePath, data: text }) });
    else localStorage.setItem('motiv.autosave', JSON.stringify({ name: state.fileName, path: null, data: text }));
  } catch { /* t.ex. för stort för localStorage */ }
}, 4000);

async function offerRestore() {
  let raw = null;
  try { raw = isTauri ? await invoke('autosave_read') : localStorage.getItem('motiv.autosave'); } catch { /* ignore */ }
  if (!raw) return;
  let o;
  try { o = JSON.parse(raw); } catch { return; }
  toast(`Det finns en autosparad version av "${o.name}".`, 'info', {
    timeout: 15000,
    action: { label: 'Återställ', onClick: async () => { await loadProjectText(o.data, o.name, o.path); state.dirty = true; emit('dirty'); } },
  });
}

// ---------------- Tangentbord ----------------
function onKey(e) {
  if (isTyping(e)) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key;
  const lower = k.length === 1 ? k.toLowerCase() : k;

  if (state.cropId) {
    if (k === 'Enter') { e.preventDefault(); finishCrop(true); return; }
    if (k === 'Escape') { e.preventDefault(); finishCrop(false); return; }
  }
  if (ctrl) {
    const map = {
      z: () => (e.shiftKey ? redo() : undo()), y: redo,
      s: () => saveProject(e.shiftKey), o: openProject, n: newDesign, e: openExportDialog, i: () => (single()?.type === 'text' ? toggleTextProp('italic') : uploadImages()),
      a: A.selectAll, d: () => A.duplicateSelection(), g: () => (e.shiftKey ? A.ungroupSelection() : A.groupSelection()),
      l: A.toggleLock, b: () => toggleTextProp('bold'), u: () => toggleTextProp('underline'),
      c: A.copySelection, x: A.cutSelection,
      '0': fitToScreen, '1': () => zoomTo(1), '+': () => zoomBy(1.25), '=': () => zoomBy(1.25), '-': () => zoomBy(1 / 1.25),
      ']': () => A.arrange(e.shiftKey ? 'front' : 'forward'), '[': () => A.arrange(e.shiftKey ? 'back' : 'backward'),
      '}': () => A.arrange('front'), '{': () => A.arrange('back'),
      Enter: () => addPage(),
    };
    if (map[lower]) { e.preventDefault(); map[lower](); }
    return; // Ctrl+V hanteras av paste-händelsen
  }
  switch (k) {
    case 'Delete': case 'Backspace': e.preventDefault(); A.deleteSelection(); break;
    case 'PageUp': e.preventDefault(); goToPage(currentPage() - 1); break;
    case 'PageDown': e.preventDefault(); goToPage(currentPage() + 1); break;
    case 'Escape':
      closeColorPicker(); closeFontPicker(); hideMenu();
      // Esc lämnar först en öppnad grupp (gruppen blir markerad), sedan avmarkeras allt
      if (state.doc.groupPath.length) exitGroupEditing(); else select([]);
      break;
    case 'Enter': { const el = single(); if (el?.type === 'text') { e.preventDefault(); startTextEdit(el, true); } else if (el?.type === 'image') { e.preventDefault(); startCrop(el); } else if (el?.type === 'group') { e.preventDefault(); A.enterGroup(el, el.children[el.children.length - 1]?.id); } break; }
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
      if (!state.selection.length) return;
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      const step = s * Math.max(1, Math.round(1 / state.zoom));
      A.nudge(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
      break;
    }
    case 't': case 'T': e.preventDefault(); { const el = A.addText('heading'); startTextEdit(el, true); } break;
    case 'r': case 'R': A.addShape('rect'); break;
    case 'o': case 'O': A.addShape('ellipse'); break;
    case 'l': case 'L': A.addShape('line'); break;
  }
}

function toggleTextProp(p) {
  const els = selected().filter((e) => e.type === 'text');
  if (!els.length) return;
  if (p === 'bold') { const on = els[0].fontWeight < 600; els.forEach((e) => { e.fontWeight = on ? 700 : 400; }); }
  else { const on = !els[0][p]; els.forEach((e) => { e[p] = on; }); }
  A.relayoutAllText();
  emit('doc');
  commit();
}

// ---------------- Klistra in / dra in ----------------
async function onPaste(e) {
  if (isTyping(e)) return;
  const items = [...(e.clipboardData?.items || [])];
  const imgItem = items.find((i) => i.type.startsWith('image/'));
  const text = e.clipboardData?.getData('text/plain') || '';
  if (state.clipboard && A.isInternalClipText(text)) { e.preventDefault(); A.pasteInternal(); return; }
  if (imgItem) {
    e.preventDefault();
    const file = imgItem.getAsFile();
    if (file) await A.addImageFromDataURL(await blobToDataURL(file), { name: 'Inklistrad bild' });
    return;
  }
  if (text.trim()) {
    e.preventDefault();
    const el = A.addText('body', { text: text.trim().slice(0, 5000) });
    select([el.id]);
    return;
  }
  if (state.clipboard) { e.preventDefault(); A.pasteInternal(); }
}

function setupDrop() {
  const stage = $('#stage');
  const overlay = $('#drop-overlay');
  let depth = 0;
  window.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { depth++; overlay.classList.add('on'); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.classList.remove('on'); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0; overlay.classList.remove('on');
    const inStage = stage.contains(e.target) || e.target === overlay;
    const at = inStage ? screenToDocFromClient(e.clientX, e.clientY) : null;
    const assetId = e.dataTransfer.getData('application/x-motiv-asset');
    if (assetId && state.doc.assets[assetId]) { await A.addImageFromDataURL(state.doc.assets[assetId], { at }); return; }
    const shape = e.dataTransfer.getData('application/x-motiv-shape');
    if (shape) {
      const dashed = shape === 'dashed' || shape === 'dotted';
      A.addShape(dashed ? 'line' : shape, { dash: dashed ? shape : null, at });
      return;
    }
    const files = [...e.dataTransfer.files];
    for (const f of files) {
      if (PROJECT_EXT.test(f.name)) {
        if (await confirmDiscard()) await loadProjectText(await f.text(), f.name, null);
        return;
      }
      if (!f.type.startsWith('image/')) continue;
      try { await A.addImageFromDataURL(await blobToDataURL(f), { at, name: f.name }); } catch (err) { toast(`${f.name}: ${err.message}`, 'error'); }
    }
  });
}

// ---------------- Start ----------------
async function boot() {
  buildTopbar();
  initEditor($('#stage'));
  initLeftPanel($('#rail'), $('#leftpanel'));
  initProperties($('#rightpanel'));
  initPageBar($('#pagebar'), showMenu);
  buildZoomBar();
  buildGroupBar();
  setupDrop();
  setContextMenuHider(hideMenu);
  getCanvas().addEventListener('contextmenu', contextMenu);
  window.addEventListener('keydown', onKey);
  document.addEventListener('paste', onPaste);
  on('toast', ({ msg, type }) => toast(msg, type));
  on('dirty', () => autosave());
  on('doc', () => autosave());
  on('fonts', () => { A.relayoutAllText(); requestRender(); });
  on('layout', () => requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))));
  window.addEventListener('beforeunload', (e) => { if (state.dirty && !isTauri) { e.preventDefault(); e.returnValue = ''; } });
  if (isTauri) setupCloseGuard();

  // Startdokument: A4 stående med en välkomsttext
  const d = newDoc(2480, 3508, 300);
  loadDoc(d, { fileName: 'Namnlös design', filePath: null });
  updateTitle();
  if (!isTauri) document.body.classList.add('browser-mode');
  await initFonts();
  offerRestore();
}

boot().catch((e) => { console.error(e); toast(`Fel vid start: ${e.message || e}`, 'error', { timeout: 0 }); });
