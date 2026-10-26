// Sidor: åtgärder (lägg till, duplicera, ta bort, flytta, byt) och sidremsan
// längst ned i arbetsytan med förhandsbilder av alla sidor.
import { state, on, emit, commit, select, newPage, pageView, reId } from './state.js';
import { h, deepClone, debounce } from './util.js';
import { icon } from './controls.js';
import { renderToCanvas } from './render.js';
import { finishTextEdit, finishCrop } from './editor.js';
import { toast } from './dialogs.js';

const pages = () => state.doc.pages;
export const pageCount = () => pages().length;
export const currentPage = () => state.doc.pageIndex;

// ---------------- Åtgärder ----------------

/** Visar sida i (byter inte innehåll och blir inget ångringssteg). */
export function goToPage(i) {
  i = Math.max(0, Math.min(i, pageCount() - 1));
  if (i === currentPage()) return;
  finishTextEdit();
  finishCrop(true);
  state.doc.pageIndex = i;
  select([]);
  emit('page');
  emit('doc');
}

function changed(goTo) {
  state.doc.pageIndex = goTo;
  select([], { silent: true });
  emit('pages');
  emit('page');
  emit('doc');
  emit('selection');
  commit();
}

/** Lägger till en sida (tom om ingen anges) efter sida `after` och visar den. */
export function addPage(after = currentPage(), page = newPage()) {
  finishTextEdit();
  finishCrop(true);
  pages().splice(after + 1, 0, page);
  changed(after + 1);
}

export function duplicatePage(i = currentPage()) {
  finishTextEdit();
  finishCrop(true);
  const src = pages()[i];
  const copy = { id: newPage().id, background: deepClone(src.background), elements: src.elements.map(reId) };
  pages().splice(i + 1, 0, copy);
  changed(i + 1);
}

export function deletePage(i = currentPage()) {
  if (pageCount() <= 1) { toast('Designen måste ha minst en sida', 'info'); return; }
  finishTextEdit();
  finishCrop(true);
  pages().splice(i, 1);
  const cur = currentPage();
  changed(cur > i ? cur - 1 : Math.min(cur, pageCount() - 1));
}

/** Flyttar sida `from` så att den hamnar på plats `to` (index efter flytten). */
export function movePage(from, to) {
  to = Math.max(0, Math.min(to, pageCount() - 1));
  if (from === to) return;
  const shown = pages()[currentPage()];
  const [p] = pages().splice(from, 1);
  pages().splice(to, 0, p);
  changed(pages().indexOf(shown));
}

/** Ger alla sidor samma bakgrund som den aktuella sidan. */
export function backgroundToAllPages() {
  const bg = state.doc.background;
  for (const p of pages()) if (p !== pages()[currentPage()]) p.background = deepClone(bg);
  emit('pages');
  emit('doc');
  commit();
  toast(`Bakgrunden används nu på alla ${pageCount()} sidor`, 'ok');
}

// ---------------- Sidremsan ----------------

const THUMB_H = 62; // px
const THUMB_W_MAX = 110;

let bar, list, counter, showMenu;
const thumbs = []; // canvas per sida

export function initPageBar(el, menu) {
  bar = el;
  showMenu = menu;
  counter = h('div', { class: 'pg-counter' });
  list = h('div', { class: 'pg-list' });
  bar.append(counter, list);
  list.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { list.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  setupReorder();

  const redrawCurrent = debounce(() => drawThumb(currentPage()), 250);
  const redrawAll = debounce(() => pages().forEach((_, i) => drawThumb(i)), 250);
  on('pages', rebuild);
  on('doc:resized', rebuild);
  on('page', () => { markActive(); redrawCurrent(); });
  on('doc', redrawCurrent);
  on('render', redrawCurrent);
  on('fonts', redrawAll);
  on('image-loaded', redrawAll);
  rebuild();
}

function rebuild() {
  if (!list) return;
  list.innerHTML = '';
  thumbs.length = 0;
  const d = state.doc;
  // Höjden är fast; breda format (t.ex. Facebook-omslag) begränsas i bredd
  const tw = Math.min(THUMB_W_MAX, THUMB_H * (d.width / d.height));
  const th = tw * (d.height / d.width);
  pages().forEach((_, i) => {
    const c = h('canvas', { class: 'pg-canvas', style: { width: `${tw}px`, height: `${th}px` } });
    thumbs.push(c);
    const more = h('span', { class: 'pg-more', title: 'Fler val', onclick: (e) => { e.stopPropagation(); pageMenu(i, e.currentTarget); } }, icon('dots'));
    const item = h('button', { class: 'pg-item', draggable: true, title: `Sida ${i + 1}`, onclick: () => goToPage(i) },
      h('span', { class: 'pg-frame' }, c, more),
      h('span', { class: 'pg-num' }, String(i + 1)),
    );
    item.dataset.i = i;
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); goToPage(i); pageMenu(i, { x: e.clientX, y: e.clientY }); });
    list.append(item);
  });
  list.append(h('button', { class: 'pg-add', title: 'Lägg till sida', onclick: () => addPage(pageCount() - 1) }, icon('plus')));
  markActive();
  pages().forEach((_, i) => drawThumb(i));
}

function markActive() {
  if (!list) return;
  const cur = currentPage();
  list.querySelectorAll('.pg-item').forEach((it) => it.classList.toggle('active', +it.dataset.i === cur));
  counter.textContent = pageCount() > 1 ? `Sida ${cur + 1} av ${pageCount()}` : '1 sida';
  list.querySelector('.pg-item.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function drawThumb(i) {
  const c = thumbs[i];
  if (!c || !pages()[i]) return;
  const d = state.doc;
  const dpr = window.devicePixelRatio || 1;
  const cssW = parseFloat(c.style.width), cssH = parseFloat(c.style.height);
  const scale = Math.min((cssW * dpr) / d.width, (cssH * dpr) / d.height);
  const src = renderToCanvas(pageView(d, i), scale, { background: '#ffffff' });
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
}

function pageMenu(i, anchor) {
  const n = pageCount();
  showMenu(anchor, [
    ['Lägg till sida efter', '', () => addPage(i)],
    ['Duplicera sida', '', () => duplicatePage(i)],
    null,
    ['Flytta vänster', '', () => movePage(i, i - 1), i === 0],
    ['Flytta höger', '', () => movePage(i, i + 1), i === n - 1],
    null,
    ['Ta bort sida', '', () => deletePage(i), n <= 1],
  ]);
}

// Dra och släpp för att ändra ordning
function setupReorder() {
  let from = null;
  const marker = h('div', { class: 'pg-drop' });
  const slot = (e) => {
    const items = [...list.querySelectorAll('.pg-item')];
    for (const [k, it] of items.entries()) {
      const r = it.getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) return { k, x: r.left };
    }
    const r = items[items.length - 1].getBoundingClientRect();
    return { k: items.length, x: r.right };
  };
  list.addEventListener('dragstart', (e) => {
    const it = e.target.closest?.('.pg-item');
    if (!it) return;
    from = +it.dataset.i;
    e.dataTransfer.setData('application/x-motiv-page', String(from));
    e.dataTransfer.effectAllowed = 'move';
    it.classList.add('dragging');
  });
  list.addEventListener('dragover', (e) => {
    if (from === null) return;
    e.preventDefault();
    e.stopPropagation();
    const s = slot(e);
    const lr = bar.getBoundingClientRect();
    marker.style.left = `${s.x - lr.left - 5}px`;
    if (!marker.isConnected) bar.append(marker);
  });
  const end = () => { from = null; marker.remove(); list.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging')); };
  list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) marker.remove(); });
  list.addEventListener('drop', (e) => {
    if (from === null) return;
    e.preventDefault();
    e.stopPropagation();
    const { k } = slot(e);
    const f = from;
    end();
    movePage(f, k > f ? k - 1 : k);
  });
  list.addEventListener('dragend', end);
}
