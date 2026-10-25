// Modala dialoger och notiser.
import { h } from './util.js';
import { icon } from './controls.js';

let toastHost = null;

export function toast(msg, type = 'info', { action = null, timeout = 3800 } = {}) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts' }); document.body.append(toastHost); }
  const t = h('div', { class: `toast ${type}` },
    h('span', null, msg),
    action ? h('button', { class: 'btn small', onclick: () => { action.onClick(); close(); } }, action.label) : null,
    h('button', { class: 'icon-btn', onclick: () => close() }, icon('close')),
  );
  const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 250); };
  toastHost.append(t);
  if (timeout) setTimeout(close, timeout);
  return close;
}

export function modal({ title, body, actions = [], width = 460, onClose }) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey, true); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const foot = h('div', { class: 'modal-foot' }, actions.map((a) => {
    const b = h('button', { class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '') }, a.label);
    b.addEventListener('click', async () => {
      if (a.onClick) {
        b.disabled = true;
        try { const keep = await a.onClick(b); if (keep === false) { b.disabled = false; return; } } catch (e) { b.disabled = false; toast(String(e.message || e), 'error'); return; }
      }
      close();
    });
    return b;
  }));
  const box = h('div', { class: 'modal', style: { width: `${width}px` } },
    h('div', { class: 'modal-head' }, h('h3', null, title), h('button', { class: 'icon-btn', onclick: close }, icon('close'))),
    h('div', { class: 'modal-body' }, body),
    actions.length ? foot : null,
  );
  backdrop.append(box);
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey, true);
  return { close, el: box };
}

export function confirmDialog(title, msg, { ok = 'OK', cancel = 'Avbryt', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title,
      body: h('p', null, msg),
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        { label: cancel, onClick: () => { answered = true; resolve(false); } },
        { label: ok, primary: !danger, danger, onClick: () => { answered = true; resolve(true); } },
      ],
    });
  });
}
