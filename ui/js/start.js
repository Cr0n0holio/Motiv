// Startskärmen: visas när appen öppnas och via Arkiv → Startsida. Härifrån
// börjar man en ny design i ett vanligt format, öppnar en tidigare design
// eller utgår från en mall. Själva åtgärderna ligger i main.js; en åtgärd
// som returnerar false (t.ex. avbruten dialog) lämnar startskärmen öppen.
import { h } from './util.js';
import { icon } from './controls.js';
import { TEMPLATES, TEMPLATE_CATS } from './templates.js';
import { templateThumb } from './leftpanel.js';

// [namn, bredd, höjd, enhet] – de vanligaste formaten; resten finns under Format
const FORMATS = [
  ['A4 stående', 210, 297, 'mm'], ['A4 liggande', 297, 210, 'mm'], ['Affisch 50×70 cm', 500, 700, 'mm'], ['Vykort 10×15 cm', 148, 105, 'mm'],
  ['Instagram-inlägg', 1080, 1080, 'px'], ['Story / Reels', 1080, 1920, 'px'], ['Facebook-omslag', 1640, 624, 'px'], ['Presentation 16:9', 1920, 1080, 'px'],
];

let screen = null;
let closed = null;

export const startScreenOpen = () => !!screen;

export function closeStartScreen() {
  if (!screen) return;
  screen.remove();
  screen = null;
  document.removeEventListener('keydown', onKey, true);
  const fn = closed;
  closed = null;
  fn?.();
}

// Tangenter hör till startskärmen medan den visas, inte till editorn bakom.
// En dialog ovanpå (t.ex. "Osparade ändringar") sköter sina egna tangenter.
function onKey(e) {
  if (document.querySelector('.modal-backdrop')) return;
  e.stopPropagation();
  if (e.key === 'Escape') closeStartScreen();
}

/**
 * opts:
 *   recent: [{ path, name, thumb }]   senaste designer (skrivbordsappen)
 *   autosave: { name, onRestore, onDiscard } | null
 *   onNew(w, h, unit), onCustom(), onOpen(), onOpenRecent(path), onTemplate(t)
 *   onClose()   anropas när skärmen stängs, oavsett hur
 */
export function openStartScreen(opts) {
  closeStartScreen();
  closed = opts.onClose || null;
  // Stänger skärmen när åtgärden är klar, om den inte avbröts
  const go = (fn) => async () => { if ((await fn()) !== false) closeStartScreen(); };

  const formatCard = ([name, w, hh, unit]) => h('button', { class: 'st-card st-format', onclick: go(() => opts.onNew(w, hh, unit)) },
    h('span', { class: 'st-page-box' }, h('span', { class: 'st-page', style: { width: `${Math.round(54 * Math.min(1, w / hh))}px`, height: `${Math.round(54 * Math.min(1, hh / w))}px` } })),
    h('span', { class: 'st-name' }, name),
    h('span', { class: 'st-sub' }, unit === 'mm' ? `${w} × ${hh} mm` : `${w} × ${hh} px`));

  const recentCard = (r) => h('button', { class: 'st-card st-recent', title: r.path, onclick: go(() => opts.onOpenRecent(r.path)) },
    h('span', { class: 'st-thumb' }, r.thumb ? h('img', { src: r.thumb, alt: '', draggable: false }) : icon('image')),
    h('span', { class: 'st-name' }, r.name));

  // Mallar, filtrerade på kategori
  let cat = null;
  const grid = h('div', { class: 'st-grid st-templates' });
  const chips = h('div', { class: 'st-chips' });
  const fillTemplates = () => {
    chips.innerHTML = '';
    chips.append(...[null, ...TEMPLATE_CATS].map((c) => h('button', { class: 'st-chip' + (c === cat ? ' active' : ''), onclick: () => { cat = c; fillTemplates(); } }, c || 'Alla')));
    grid.innerHTML = '';
    grid.append(...TEMPLATES.filter((t) => !cat || t.cat === cat).map((t) => h('button', { class: 'tpl', title: `${t.name} – ${t.fmt}`, onclick: go(() => opts.onTemplate(t)) },
      templateThumb(t),
      h('span', { class: 'tpl-name' }, t.name),
      h('span', { class: 'tpl-fmt muted small' }, t.fmt))));
  };
  fillTemplates();

  const a = opts.autosave;
  const banner = a ? h('div', { class: 'st-banner' },
    h('div', null, h('b', null, 'Fortsätt där du slutade'), h('span', { class: 'muted' }, ` – "${a.name}" sparades automatiskt och har ändringar som inte hann sparas.`)),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn ghost', onclick: () => { a.onDiscard(); banner.remove(); } }, 'Släng'),
    h('button', { class: 'btn primary', onclick: go(a.onRestore) }, 'Återställ')) : null;

  screen = h('div', { class: 'start-screen' },
    h('div', { class: 'st-inner' },
      h('header', { class: 'st-head' },
        h('span', { class: 'logo' }),
        h('div', null, h('h1', null, 'Vad vill du skapa?'), h('p', { class: 'muted' }, 'Börja med ett tomt format, öppna en design eller utgå från en mall.')),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: go(opts.onOpen) }, icon('upload'), 'Öppna fil…'),
        h('button', { class: 'icon-btn', title: 'Stäng (Esc)', onclick: closeStartScreen }, icon('close'))),
      banner,
      h('section', null,
        h('h2', null, 'Ny design'),
        h('div', { class: 'st-grid st-formats' }, FORMATS.map(formatCard),
          h('button', { class: 'st-card st-format', onclick: go(opts.onCustom) },
            h('span', { class: 'st-page-box' }, h('span', { class: 'st-page st-custom' }, icon('plus'))),
            h('span', { class: 'st-name' }, 'Egen storlek'),
            h('span', { class: 'st-sub' }, 'px, mm, cm eller tum')))),
      opts.recent?.length ? h('section', null,
        h('h2', null, 'Senaste designer'),
        h('div', { class: 'st-grid st-recents' }, opts.recent.map(recentCard))) : null,
      h('section', null,
        h('div', { class: 'st-row' }, h('h2', null, 'Mallar'), chips),
        grid)));
  document.body.append(screen);
  document.addEventListener('keydown', onKey, true);
}
