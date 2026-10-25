// Dialog för AI-bakgrundsborttagning (körs i Rust med tract).
import { h, fmtBytes } from './util.js';
import { isTauri, invoke, listen } from './bridge.js';
import { state, emit, commit, getById } from './state.js';
import { modal, toast } from './dialogs.js';
import { addAsset } from './actions.js';
import { ensureImage, clearImageCaches } from './images.js';

let chosen = null;
try { chosen = localStorage.getItem('ediholio.bgModel'); } catch { /* ignore */ }

export async function openBgRemoval(el) {
  if (!el || el.type !== 'image') return;
  if (!isTauri) { toast('Bakgrundsborttagning kräver skrivbordsappen (Rust-delen).', 'error'); return; }
  let models;
  try { models = await invoke('bg_models'); } catch (e) { toast(String(e), 'error'); return; }
  if (!chosen || !models.some((m) => m.id === chosen)) chosen = (models.find((m) => m.downloaded) || models[0]).id;

  const list = h('div', { class: 'model-list' });
  const progress = h('div', { class: 'progress hidden' }, h('div', { class: 'bar' }), h('span', { class: 'ptext' }));
  const status = h('p', { class: 'muted small' }, 'Bilden behandlas lokalt på din dator – inget laddas upp.');

  const render = () => {
    list.innerHTML = '';
    for (const m of models) {
      const r = h('label', { class: 'model' + (m.id === chosen ? ' active' : '') },
        h('input', { type: 'radio', name: 'bgm', checked: m.id === chosen, onchange: () => { chosen = m.id; render(); } }),
        h('div', null,
          h('div', { class: 'model-name' }, m.name, h('span', { class: 'model-size' }, m.downloaded ? 'Nedladdad' : `${m.size_mb} MB`)),
          h('div', { class: 'muted small' }, m.description)),
      );
      list.append(r);
    }
  };
  render();

  const dlg = modal({
    title: 'Ta bort bakgrund',
    width: 480,
    body: h('div', null, list, progress, status),
    actions: [
      { label: 'Avbryt' },
      {
        label: 'Ta bort bakgrund', primary: true, onClick: async (btn) => {
          try { localStorage.setItem('ediholio.bgModel', chosen); } catch { /* ignore */ }
          const m = models.find((x) => x.id === chosen);
          const bar = progress.querySelector('.bar'), ptext = progress.querySelector('.ptext');
          progress.classList.remove('hidden');
          if (!m.downloaded) {
            const un = await listen('bg-progress', (p) => {
              if (p.id !== m.id) return;
              const pct = p.total ? (p.downloaded / p.total) * 100 : 0;
              bar.style.width = `${pct}%`;
              ptext.textContent = `Laddar ned modell… ${fmtBytes(p.downloaded)} / ${fmtBytes(p.total)}`;
            });
            try { await invoke('bg_download_model', { id: m.id }); } finally { un(); }
            m.downloaded = true;
          }
          progress.classList.add('indeterminate');
          ptext.textContent = 'Analyserar bilden…';
          btn.textContent = 'Arbetar…';
          const t0 = performance.now();
          const maskB64 = await invoke('bg_remove', { id: m.id, image: state.doc.assets[el.assetId] });
          const maskId = await addAsset(`data:image/png;base64,${maskB64}`);
          await ensureImage(maskId);
          const cur = getById(el.id) || el;
          cur.maskAssetId = maskId;
          clearImageCaches();
          emit('doc');
          commit();
          toast(`Bakgrunden borttagen på ${((performance.now() - t0) / 1000).toFixed(1)} s`, 'ok');
          return true;
        },
      },
    ],
  });
  return dlg;
}

export function restoreBackground(el) {
  if (!el) return;
  el.maskAssetId = null;
  clearImageCaches();
  emit('doc');
  commit();
}
