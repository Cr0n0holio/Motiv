// Fontväljare: sökbar lista med förhandsvisning i respektive font.
import { h } from './util.js';
import { fontState, GOOGLE_FONTS, ensureFamily, isAvailable, addCustomFonts, removeAppFont, pushRecentFont } from './fonts.js';
import { isTauri } from './bridge.js';
import { on, emit } from './state.js';
import { icon } from './controls.js';

let pop = null;
let outside = null;
let offFonts = null;

export function closeFontPicker() {
  if (!pop) return;
  pop.remove();
  pop = null;
  document.removeEventListener('pointerdown', outside, true);
  offFonts?.();
}

export function openFontPicker(anchor, current, onPick) {
  if (pop) { closeFontPicker(); return; }
  const search = h('input', { class: 'fp-search', placeholder: 'Sök font…', spellcheck: false });
  const list = h('div', { class: 'fp-list' });
  const tabs = h('div', { class: 'seg fp-tabs' });
  let tab = 'all';
  ['all:Alla', 'google:Google', 'system:System', 'custom:Egna'].forEach((t) => {
    const [k, l] = t.split(':');
    const b = h('button', { onclick: () => { tab = k; render(); } }, l);
    b.dataset.k = k;
    tabs.append(b);
  });
  const addBtn = isTauri ? h('button', {
    class: 'btn small', onclick: async () => {
      try {
        const added = await addCustomFonts();
        if (added.length) { emit('toast', { msg: `Lade till ${added.map((a) => a.family).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`, type: 'ok' }); tab = 'custom'; render(); }
      } catch (e) { emit('toast', { msg: String(e.message || e), type: 'error' }); }
    },
  }, icon('upload'), 'Lägg till fontfil…') : null;

  pop = h('div', { class: 'popover font-pop' },
    search, tabs, list,
    h('div', { class: 'fp-foot' }, addBtn, h('span', { class: 'muted small' }, 'Google-fonter laddas ned första gången och fungerar sedan offline.')),
  );

  const row = (family, kind) => {
    const avail = isAvailable(family);
    const downloading = fontState.downloading.has(family);
    const r = h('button', { class: 'fp-row' + (family === current ? ' active' : ''), title: family },
      h('span', { class: 'fp-name', style: avail ? { fontFamily: `"${family}", "Segoe UI", sans-serif` } : null }, family),
      kind === 'google' && !avail ? h('span', { class: 'fp-badge' + (downloading ? ' spin' : '') }, downloading ? '⟳' : icon('download')) : null,
      kind === 'custom' ? h('span', {
        class: 'fp-del', title: 'Ta bort font', onclick: async (e) => {
          e.stopPropagation();
          await removeAppFont(family);
          render();
        },
      }, icon('trash')) : null,
    );
    r.addEventListener('click', async () => {
      pushRecentFont(family);
      current = family;
      onPick(family);
      render();
      if (!isAvailable(family)) await ensureFamily(family);
    });
    return r;
  };

  function render() {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.k === tab));
    const q = search.value.trim().toLowerCase();
    const match = (f) => !q || f.toLowerCase().includes(q);
    const customs = [...new Set(fontState.app.filter((f) => f.source === 'custom').map((f) => f.family))];
    list.innerHTML = '';
    const sec = (title, fams, kind) => {
      const items = fams.filter(match);
      if (!items.length) return;
      list.append(h('div', { class: 'fp-sec' }, title));
      items.forEach((f) => list.append(row(f, kind)));
    };
    if (tab === 'all' && !q && fontState.recent.length) sec('Senast använda', fontState.recent, 'recent');
    if (tab === 'all' || tab === 'custom') sec('Egna fonter', customs, 'custom');
    if (tab === 'all' || tab === 'google') sec('Google Fonts', GOOGLE_FONTS, 'google');
    if (tab === 'all' || tab === 'system') sec('Systemfonter', fontState.system.filter((f) => !GOOGLE_FONTS.includes(f)), 'system');
    if (!list.children.length) list.append(h('div', { class: 'fp-empty' }, q ? `Ingen font matchar "${search.value}"` : 'Inga fonter här ännu'));
  }
  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFontPicker();
    if (e.key === 'Enter') { const first = list.querySelector('.fp-row'); first?.click(); }
  });

  document.body.append(pop);
  const ar = anchor.getBoundingClientRect();
  let left = ar.left - 300 - 12;
  if (left < 8) left = ar.left;
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${Math.max(8, Math.min(ar.top - 20, window.innerHeight - 560))}px`;
  render();
  search.focus();
  outside = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closeFontPicker(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  offFonts = on('fonts', () => { if (pop) { const st = list.scrollTop; render(); list.scrollTop = st; } });
}
