// Högerpanelen: egenskaper för det som är markerat.
import { state, on, emit, commit, selected, single, markDirty, DEFAULT_FILTERS } from './state.js';
import { h, deepClone, round } from './util.js';
import { Binder, numField, slider, select, toggleBtn, segmented, colorBtn, effectSection, section, row, icon } from './controls.js';
import { syncTextBox, isCurved, cssFamily } from './text.js';
import { openFontPicker } from './fontpicker.js';
import { ensureTextFont, weightsFor } from './fonts.js';
import { BLEND_MODES } from './render.js';
import * as A from './actions.js';
import { startCrop, finishCrop, startTextEdit } from './editor.js';
import { FILTER_PRESETS, getProcessed, ensureImage } from './images.js';
import { MASK_SHAPES, maskD, isOpenShape } from './shapes.js';
import { openBgRemoval, restoreBackground } from './bgremoval.js';
import { pickImages } from './bridge.js';
import { openColorPicker } from './colorpicker.js';
import { toast } from './dialogs.js';
import { addPage, duplicatePage, deletePage, backgroundToAllPages, pageCount, currentPage } from './pages.js';
import { loadImage, debounce } from './util.js';

let host;
let B = new Binder();
const commitSoon = debounce(() => commit(), 300);

export function initProperties(el) {
  host = el;
  on('selection', rebuild);
  on('crop', rebuild);
  on('doc:replaced', rebuild);
  on('pages', () => { if (!state.selection.length) rebuild(); });
  on('doc', () => { if (structureChanged()) rebuild(); else B.refresh(); });
  on('doc:live', () => B.refresh());
  on('fonts', () => B.refresh());
  rebuild();
}

let lastSig = '';
const signature = () => selected().map((e) => e.id + ':' + e.type + ':' + (e.kind || '') + ':' + (e.curve?.mode || '') + ':' + (e.maskShape || '') + ':' + !!e.maskAssetId + ':' + e.locked + ':' + (e.stroke?.enabled ?? '')).join(',') + '|' + !!state.doc.background.image + '|' + state.cropId;
function structureChanged() { return signature() !== lastSig; }

/** Ändrar alla markerade element. final = registrera ångringssteg. */
function apply(fn, final, { layout = true } = {}) {
  for (const el of selected()) {
    if (el.locked) continue;
    fn(el);
    if (layout && el.type === 'text') syncTextBox(el, isCurved(el) ? 'center' : 'top');
  }
  markDirty();
  emit('doc:live');
  emit('render');
  if (final) { commitSoon(); if (structureChanged()) rebuild(); }
}
const first = () => selected()[0];

export function rebuild() {
  lastSig = signature();
  B = new Binder();
  host.innerHTML = '';
  const els = selected();
  let content;
  if (state.cropId) content = cropPanel();
  else if (!els.length) content = pagePanel();
  else if (els.length > 1) content = multiPanel(els);
  else {
    const el = els[0];
    content = h('div', null,
      header(el),
      el.type === 'text' ? textPanel(el) : null,
      el.type === 'image' ? imagePanel(el) : null,
      el.type === 'shape' ? shapePanel(el) : null,
      el.type === 'group' ? groupPanel(el) : null,
      arrangePanel(el),
    );
  }
  host.append(content);
  B.refresh();
}

const TYPE_LABEL = { text: 'Text', image: 'Bild', shape: 'Form', group: 'Grupp' };
function header(el) {
  return h('div', { class: 'panel-head' },
    h('div', { class: 'ph-title' }, h('span', { class: 'ph-type' }, TYPE_LABEL[el.type]), h('span', { class: 'ph-name' }, el.type === 'text' ? '' : el.name)),
    h('div', { class: 'ph-actions' },
      h('button', { class: 'icon-btn', title: 'Duplicera (Ctrl+D)', onclick: () => A.duplicateSelection() }, icon('copy')),
      h('button', { class: 'icon-btn', title: el.locked ? 'Lås upp' : 'Lås', onclick: () => A.toggleLock() }, icon(el.locked ? 'lock' : 'unlock')),
      h('button', { class: 'icon-btn danger', title: 'Ta bort (Delete)', onclick: () => A.deleteSelection() }, icon('trash')),
    ),
  );
}

// ---------------- Sida ----------------
function pagePanel() {
  const d = state.doc;
  const mm = (px) => round((px / d.dpi) * 25.4, 0);
  const bgImg = d.background.image;
  return h('div', null,
    h('div', { class: 'panel-head' }, h('div', { class: 'ph-title' }, h('span', { class: 'ph-type' }, pageCount() > 1 ? `Sida ${currentPage() + 1} av ${pageCount()}` : 'Sida'))),
    section('Sidor',
      h('div', { class: 'btn-grid two' },
        h('button', { class: 'btn', title: 'Ny tom sida efter den här (Ctrl+Enter)', onclick: () => addPage() }, icon('plus'), 'Ny sida'),
        h('button', { class: 'btn', title: 'Kopia av den här sidan', onclick: () => duplicatePage() }, icon('copy'), 'Duplicera'),
      ),
      pageCount() > 1 ? h('button', { class: 'btn full danger-ghost', onclick: () => deletePage() }, icon('trash'), 'Ta bort sidan') : null,
    ),
    section('Storlek',
      h('div', { class: 'info-line' }, h('b', null, `${d.width} × ${d.height} px`), h('span', { class: 'muted' }, ` · ${mm(d.width)} × ${mm(d.height)} mm vid ${d.dpi} dpi`)),
      h('button', { class: 'btn full', onclick: () => emit('open-tab', 'format') }, icon('layout'), 'Ändra storlek'),
    ),
    section('Bakgrund',
      row(colorBtn(B, {
        label: 'Färg',
        allowGradient: true, allowNone: true,
        get: () => d.background.fill,
        set: (v, final) => { d.background.fill = v; markDirty(); emit('doc:live'); emit('render'); if (final) commitSoon(); },
      })),
      bgImg ? h('div', null,
        slider(B, { label: 'Bildens opacitet', min: 0, max: 100, unit: '%', get: () => Math.round((d.background.image?.opacity ?? 1) * 100), set: (v, f) => { d.background.image.opacity = v / 100; markDirty(); emit('render'); if (f) commitSoon(); } }),
        row(
          h('button', { class: 'btn', onclick: () => A.detachBackgroundImage() }, 'Lossa bild'),
          h('button', { class: 'btn danger-ghost', onclick: () => { d.background.image = null; emit('doc'); commit(); } }, 'Ta bort bild'),
        ),
      ) : h('p', { class: 'muted small' }, 'Tips: högerklicka på en bild och välj "Använd som bakgrund".'),
      pageCount() > 1 ? h('button', { class: 'btn full', title: 'Kopiera den här sidans bakgrund till alla sidor', onclick: backgroundToAllPages }, icon('bg'), 'Använd på alla sidor') : null,
      h('button', { class: 'btn full ghost', onclick: () => emit('open-tab', 'background') }, icon('palette'), 'Fler bakgrunder'),
    ),
    palettePanel(),
    section('Kortkommandon',
      h('div', { class: 'shortcuts' },
        ...[['T', 'Ny text'], ['Dubbelklick', 'Redigera text / beskär bild'], ['Ctrl + D', 'Duplicera'], ['Alt + dra', 'Duplicera och flytta'], ['Shift + dra', 'Lås riktning / proportioner'], ['Ctrl + dra', 'Utan fästlinjer'], ['Mellanslag + dra', 'Panorera'], ['Ctrl + hjul', 'Zooma'], ['Ctrl + G', 'Gruppera'], ['Ctrl + 0', 'Anpassa till fönster'], ['Ctrl + Enter', 'Ny sida'], ['Page Up / Down', 'Byt sida']].map(([k, t]) => h('div', null, h('kbd', null, k), h('span', null, t))),
      ),
    ),
  );
}

// ---------------- Färgpalett ----------------
/**
 * Designens palett. Klick på en färg öppnar färgväljaren; den nya färgen
 * byts då ut överallt i designen där den gamla användes.
 */
function palettePanel() {
  const pal = state.doc.palette;
  const row = h('div', { class: 'palette-row' });
  pal.forEach((c, i) => {
    const b = h('button', { class: 'pal-sw', title: `${c} – klicka för att byta färgen i hela designen`, style: { '--c': c } });
    b.addEventListener('click', () => {
      let current = c;
      openColorPicker(b, {
        value: c,
        onChange: (v, final) => {
          if (v === current) return;
          pal[i] = v; // före bytet, så att palett och färger blir ett och samma ångringssteg
          replaceColorLive(current, v, final);
          current = v;
          b.style.setProperty('--c', v);
        },
      });
    });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); A.removePaletteColor(i); rebuild(); });
    row.append(b);
  });
  return section('Färgpalett',
    pal.length ? row : h('p', { class: 'muted small' }, 'Spara designens färger här så blir de lätta att återanvända. Byter du en färg i paletten ändras den i hela designen.'),
    pal.length ? h('p', { class: 'muted small' }, 'Klicka på en färg för att byta den överallt. Högerklick tar bort.') : null,
    h('button', { class: 'btn full', onclick: () => { const n = A.paletteFromDesign(); if (!n) toast('Designen har inga färger att hämta ännu', 'info'); rebuild(); } }, icon('palette'), 'Hämta färger från designen'),
  );
}
// Under dragning byts färgen direkt (utan ångringssteg), ett steg när man släpper
function replaceColorLive(from, to, final) {
  A.replaceColor(from, to, { commitNow: false });
  if (final) commit();
}

// ---------------- Flera markerade ----------------
function multiPanel(els) {
  return h('div', null,
    h('div', { class: 'panel-head' },
      h('div', { class: 'ph-title' }, h('span', { class: 'ph-type' }, `${els.length} element`)),
      h('div', { class: 'ph-actions' },
        h('button', { class: 'icon-btn', title: 'Duplicera', onclick: () => A.duplicateSelection() }, icon('copy')),
        h('button', { class: 'icon-btn danger', title: 'Ta bort', onclick: () => A.deleteSelection() }, icon('trash')),
      )),
    section('Justera mot varandra', alignButtons(), row(
      h('button', { class: 'btn', title: 'Fördela horisontellt', onclick: () => A.distribute('h') }, icon('distH'), 'Fördela ↔'),
      h('button', { class: 'btn', title: 'Fördela vertikalt', onclick: () => A.distribute('v') }, icon('distV'), 'Fördela ↕'),
    )),
    section('Gruppera', h('button', { class: 'btn full primary', onclick: () => A.groupSelection() }, icon('group'), 'Gruppera (Ctrl+G)')),
    section('Utseende',
      slider(B, { label: 'Opacitet', min: 0, max: 100, unit: '%', get: () => Math.round((first()?.opacity ?? 1) * 100), set: (v, f) => apply((e) => { e.opacity = v / 100; }, f) }),
      select(B, { label: 'Blandningsläge', options: BLEND_MODES, get: () => first()?.blend || 'normal', set: (v) => apply((e) => { e.blend = v; }, true) }),
    ),
    section('Ordning', arrangeButtons()),
  );
}

function alignButtons() {
  return h('div', { class: 'btn-grid six' },
    ...[['left', 'alignLeft', 'Vänster'], ['center', 'alignCenterH', 'Centrera horisontellt'], ['right', 'alignRight', 'Höger'], ['top', 'alignTop', 'Topp'], ['middle', 'alignMiddle', 'Centrera vertikalt'], ['bottom', 'alignBottom', 'Botten']]
      .map(([k, ic, t]) => h('button', { class: 'icon-btn boxed', title: t, onclick: () => A.align(k) }, icon(ic))),
  );
}
function arrangeButtons() {
  return h('div', { class: 'btn-grid four' },
    h('button', { class: 'icon-btn boxed', title: 'Längst fram (Ctrl+Shift+])', onclick: () => A.arrange('front') }, icon('front')),
    h('button', { class: 'icon-btn boxed', title: 'Framåt (Ctrl+])', onclick: () => A.arrange('forward') }, icon('forward')),
    h('button', { class: 'icon-btn boxed', title: 'Bakåt (Ctrl+[)', onclick: () => A.arrange('backward') }, icon('backward')),
    h('button', { class: 'icon-btn boxed', title: 'Längst bak (Ctrl+Shift+[)', onclick: () => A.arrange('back') }, icon('back')),
  );
}

// ---------------- Position / ordning ----------------
function arrangePanel(el) {
  const isText = el.type === 'text';
  const isLine = el.type === 'shape' && isOpenShape(el.kind);
  return h('div', null,
    section('Position',
      h('div', { class: 'grid2' },
        numField(B, { label: 'X', get: () => first()?.x, set: (v, f) => apply((e) => { e.x = v; }, f, { layout: false }) }),
        numField(B, { label: 'Y', get: () => first()?.y, set: (v, f) => apply((e) => { e.y = v; }, f, { layout: false }) }),
        numField(B, {
          label: 'B', title: isText ? 'Radbrytningsbredd' : 'Bredd', min: 1,
          get: () => (isText ? first()?.width : first()?.w),
          set: (v, f) => apply((e) => {
            if (e.type === 'text') { e.width = v; return; }
            if (e.type === 'group') { const s = v / e.w; const cx = e.x + e.w / 2, cy = e.y + e.h / 2; A.scaleProps(e, s); e.x = cx - e.w / 2; e.y = cy - e.h / 2; return; }
            const cx = e.x + e.w / 2; e.w = v; e.x = cx - v / 2;
          }, f),
        }),
        isText || isLine ? numField(B, { label: 'H', title: 'Höjd (automatisk)', get: () => first()?.h, set: () => {} }) :
          numField(B, { label: 'H', title: 'Höjd', min: 1, get: () => first()?.h, set: (v, f) => apply((e) => {
            if (e.type === 'group') { const s = v / e.h; const cx = e.x + e.w / 2, cy = e.y + e.h / 2; A.scaleProps(e, s); e.x = cx - e.w / 2; e.y = cy - e.h / 2; return; }
            const cy = e.y + e.h / 2; e.h = v; e.y = cy - v / 2;
          }, f) }),
        numField(B, { label: '↻', title: 'Rotation', unit: '°', min: -360, max: 360, get: () => first()?.rotation || 0, set: (v, f) => apply((e) => { e.rotation = v; }, f, { layout: false }) }),
        el.type !== 'text' ? h('div', { class: 'row tight' },
          h('button', { class: 'icon-btn boxed', title: 'Spegla horisontellt', onclick: () => A.flip('x') }, icon('flipH')),
          h('button', { class: 'icon-btn boxed', title: 'Spegla vertikalt', onclick: () => A.flip('y') }, icon('flipV')),
        ) : h('span'),
      ),
      h('div', { class: 'sub-label' }, state.doc.groupPath.length ? 'Justera mot gruppen' : 'Justera mot sidan'),
      alignButtons(),
    ),
    section('Utseende',
      slider(B, { label: 'Opacitet', min: 0, max: 100, unit: '%', get: () => Math.round((first()?.opacity ?? 1) * 100), set: (v, f) => apply((e) => { e.opacity = v / 100; }, f, { layout: false }) }),
      select(B, { label: 'Blandningsläge', options: BLEND_MODES, get: () => first()?.blend || 'normal', set: (v) => apply((e) => { e.blend = v; }, true, { layout: false }) }),
    ),
    section('Ordning', arrangeButtons()),
  );
}

// ---------------- Text ----------------
const WEIGHT_NAMES = { 100: 'Tunn', 200: 'Extra lätt', 300: 'Lätt', 400: 'Normal', 500: 'Medium', 600: 'Halvfet', 700: 'Fet', 800: 'Extra fet', 900: 'Svart' };

function shadowControls(get, setShadow) {
  return h('div', null,
    row(colorBtn(B, { label: 'Färg', get: () => get().color, set: (v, f) => setShadow((s) => { s.color = v; }, f) })),
    slider(B, { label: 'Oskärpa', min: 0, max: 200, get: () => get().blur, set: (v, f) => setShadow((s) => { s.blur = v; }, f) }),
    h('div', { class: 'grid2' },
      numField(B, { label: 'X', get: () => get().x, set: (v, f) => setShadow((s) => { s.x = v; }, f) }),
      numField(B, { label: 'Y', get: () => get().y, set: (v, f) => setShadow((s) => { s.y = v; }, f) }),
    ),
  );
}

function textPanel(el) {
  const fontBtn = h('button', { class: 'font-btn', title: 'Välj font' }, h('span', { class: 'fb-name' }), icon('chevron'));
  const nameSpan = fontBtn.querySelector('.fb-name');
  B.add(() => { const f = first()?.fontFamily; nameSpan.textContent = f; nameSpan.style.fontFamily = cssFamily(f); });
  fontBtn.addEventListener('click', () => openFontPicker(fontBtn, first().fontFamily, (family) => {
    apply((e) => { e.fontFamily = family; }, true);
    selected().forEach((e) => ensureTextFont(e).then(() => { apply(() => {}, false); }));
  }));

  const weightSel = h('select', { class: 'select' });
  const fillWeights = () => {
    const ws = weightsFor(first()?.fontFamily);
    const cur = first()?.fontWeight || 400;
    const all = [...new Set([...ws, cur])].sort((a, b) => a - b);
    weightSel.innerHTML = '';
    all.forEach((w) => weightSel.append(h('option', { value: w }, `${WEIGHT_NAMES[w] || w}`)));
    weightSel.value = cur;
  };
  weightSel.addEventListener('change', () => { apply((e) => { e.fontWeight = +weightSel.value; }, true); selected().forEach((e) => ensureTextFont(e)); });
  B.add(() => { if (document.activeElement !== weightSel) fillWeights(); });

  const setT = (fn, f) => apply(fn, f);

  return h('div', null,
    section('Text',
      fontBtn,
      h('div', { class: 'grid2' },
        numField(B, { label: 'Storlek', min: 1, max: 5000, get: () => first()?.fontSize, set: (v, f) => setT((e) => { e.fontSize = v; }, f) }),
        weightSel,
      ),
      h('div', { class: 'row tight' },
        toggleBtn(B, { iconName: 'bold', title: 'Fet (Ctrl+B)', get: () => (first()?.fontWeight || 400) >= 600, set: (v) => { setT((e) => { e.fontWeight = v ? 700 : 400; }, true); selected().forEach((e) => ensureTextFont(e)); } }),
        toggleBtn(B, { iconName: 'italic', title: 'Kursiv (Ctrl+I)', get: () => first()?.italic, set: (v) => { setT((e) => { e.italic = v; }, true); selected().forEach((e) => ensureTextFont(e)); } }),
        toggleBtn(B, { iconName: 'underline', title: 'Understruken (Ctrl+U)', get: () => first()?.underline, set: (v) => setT((e) => { e.underline = v; }, true) }),
        toggleBtn(B, { iconName: 'caps', title: 'Versaler', get: () => first()?.uppercase, set: (v) => setT((e) => { e.uppercase = v; }, true) }),
        h('span', { class: 'spacer' }),
        segmented(B, { options: [['left', 'textLeft', 'Vänster'], ['center', 'textCenter', 'Centrerad'], ['right', 'textRight', 'Höger']], get: () => first()?.align, set: (v) => setT((e) => { e.align = v; }, true) }),
      ),
      slider(B, { label: 'Radavstånd', min: 0.5, max: 3, step: 0.05, decimals: 2, get: () => first()?.lineHeight, set: (v, f) => setT((e) => { e.lineHeight = v; }, f) }),
      slider(B, { label: 'Teckenavstånd', min: -200, max: 1000, step: 5, get: () => first()?.letterSpacing || 0, set: (v, f) => setT((e) => { e.letterSpacing = v; }, f) }),
      row(colorBtn(B, { label: 'Färg', allowGradient: true, allowNone: true, get: () => first()?.fill, set: (v, f) => setT((e) => { e.fill = deepClone(v); }, f) })),
      h('button', { class: 'btn full ghost', onclick: () => startTextEdit(first(), true) }, 'Redigera text (Enter)'),
    ),
    section('Böj text',
      segmented(B, { cls: 'wide', options: [['none', 'Ingen'], ['arc', 'Båge'], ['wave', 'Våg']], get: () => first()?.curve?.mode || 'none', set: (v) => setT((e) => { e.curve = { ...(e.curve || { amount: 50 }), mode: v }; }, true) }),
      (first().curve?.mode || 'none') !== 'none' ? slider(B, { label: first().curve.mode === 'arc' ? 'Böjning' : 'Amplitud', min: -100, max: 100, get: () => first()?.curve?.amount ?? 50, set: (v, f) => setT((e) => { e.curve.amount = v; }, f) }) : null,
    ),
    section('Effekter',
      effectSection(B, {
        title: 'Kontur',
        get: () => first()?.stroke?.enabled,
        set: (v) => setT((e) => { e.stroke.enabled = v; if (v && e.stroke.width < e.fontSize * 0.02) e.stroke.width = Math.max(2, Math.round(e.fontSize * 0.04)); }, true),
        body: h('div', null,
          row(colorBtn(B, { label: 'Färg', get: () => first()?.stroke.color, set: (v, f) => setT((e) => { e.stroke.color = v; }, f) })),
          slider(B, { label: 'Tjocklek', min: 0, max: Math.max(40, Math.round(el.fontSize * 0.25)), step: 0.5, decimals: 1, get: () => first()?.stroke.width, set: (v, f) => setT((e) => { e.stroke.width = v; }, f) }),
          h('label', { class: 'check' }, (() => {
            const c = h('input', { type: 'checkbox' });
            c.addEventListener('change', () => setT((e) => { e.fill = c.checked ? { type: 'none' } : { type: 'solid', color: '#1d1d24' }; }, true));
            B.add(() => { c.checked = first()?.fill?.type === 'none'; });
            return c;
          })(), 'Ihålig text (bara kontur)'),
        ),
      }),
      effectSection(B, {
        title: 'Skugga',
        get: () => first()?.shadow?.enabled,
        set: (v) => setT((e) => { e.shadow.enabled = v; if (v && e.shadow.blur === 12 && e.shadow.x === 6) { const k = e.fontSize / 60; e.shadow.blur = 8 * k; e.shadow.x = 4 * k; e.shadow.y = 4 * k; } }, true),
        body: shadowControls(() => first()?.shadow || {}, (fn, f) => setT((e) => fn(e.shadow), f)),
      }),
      effectSection(B, {
        title: 'Glöd / neon',
        get: () => first()?.glow?.enabled,
        set: (v) => setT((e) => { e.glow.enabled = v; if (v && e.glow.blur === 30) e.glow.blur = e.fontSize * 0.3; }, true),
        body: h('div', null,
          row(colorBtn(B, { label: 'Färg', get: () => first()?.glow.color, set: (v, f) => setT((e) => { e.glow.color = v; }, f) })),
          slider(B, { label: 'Styrka', min: 0, max: 300, get: () => first()?.glow.blur, set: (v, f) => setT((e) => { e.glow.blur = v; }, f) }),
        ),
      }),
      effectSection(B, {
        title: 'Textplatta',
        get: () => first()?.background?.enabled,
        set: (v) => setT((e) => { e.background.enabled = v; }, true),
        body: h('div', null,
          row(colorBtn(B, { label: 'Färg', get: () => first()?.background.color, set: (v, f) => setT((e) => { e.background.color = v; }, f) })),
          slider(B, { label: 'Utfyllnad', min: 0, max: 150, unit: '%', get: () => Math.round((first()?.background.padding ?? 0.25) * 100), set: (v, f) => setT((e) => { e.background.padding = v / 100; }, f) }),
          slider(B, { label: 'Hörnradie', min: 0, max: 100, unit: '%', get: () => Math.round((first()?.background.radius ?? 0.2) * 100), set: (v, f) => setT((e) => { e.background.radius = v / 100; }, f) }),
        ),
      }),
    ),
  );
}

// ---------------- Bild ----------------
function imagePanel(el) {
  const setI = (fn, f) => apply(fn, f, { layout: false });
  const presetGrid = h('div', { class: 'preset-grid' });
  const buildPresets = async () => {
    await ensureImage(el.assetId);
    if (el.maskAssetId) await ensureImage(el.maskAssetId);
    presetGrid.innerHTML = '';
    const aspect = el.w / el.h;
    const tw = 72, th = Math.round(72 / Math.max(0.5, Math.min(2, aspect)));
    for (const p of FILTER_PRESETS) {
      const tmp = { ...el, maskShape: 'none', filters: { ...DEFAULT_FILTERS, ...p.f }, w: tw, h: th };
      const c = getProcessed(tmp, tw, th);
      const b = h('button', { class: 'preset', title: p.name, onclick: () => setI((e) => { e.filters = { ...DEFAULT_FILTERS, ...p.f }; e.preset = p.id; }, true) },
        c ? (() => { const cv = h('canvas', { width: tw, height: th }); cv.getContext('2d').drawImage(c, 0, 0); return cv; })() : null,
        h('span', null, p.name));
      b.dataset.id = p.id;
      presetGrid.append(b);
    }
    B.refresh();
  };
  B.add(() => presetGrid.querySelectorAll('.preset').forEach((b) => b.classList.toggle('active', b.dataset.id === (first()?.preset || 'none'))));
  buildPresets();

  const adj = (key, label, min, max, unit = '') => slider(B, {
    label, min, max, unit,
    get: () => first()?.filters?.[key] || 0,
    set: (v, f) => setI((e) => { e.filters = { ...DEFAULT_FILTERS, ...e.filters, [key]: v }; e.preset = 'custom'; }, f),
  });

  const maskGrid = h('div', { class: 'mask-grid' }, MASK_SHAPES.map(([k, name]) => {
    const b = h('button', { class: 'mask-btn', title: name, html: k === 'none' ? '<svg viewBox="0 0 32 32"><rect x="5" y="7" width="22" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/></svg>' : `<svg viewBox="0 0 32 32"><path d="${maskD(k, 24, 24, 5)}" transform="translate(4 4)" fill="currentColor"/></svg>` });
    b.addEventListener('click', () => setI((e) => { e.maskShape = k; if (k === 'ellipse' || k === 'heart' || k === 'star' || k === 'hexagon') { const s = Math.min(e.w, e.h); const cx = e.x + e.w / 2, cy = e.y + e.h / 2; /* gör kvadratisk för snygg form */ if (Math.abs(e.w - e.h) > 1) { const sw = e.crop.w * (s / e.w), sh = e.crop.h * (s / e.h); e.crop = { x: e.crop.x + (e.crop.w - sw) / 2, y: e.crop.y + (e.crop.h - sh) / 2, w: sw, h: sh }; e.w = s; e.h = s; e.x = cx - s / 2; e.y = cy - s / 2; } } }, true));
    b.dataset.k = k;
    return b;
  }));
  B.add(() => maskGrid.querySelectorAll('.mask-btn').forEach((b) => b.classList.toggle('active', b.dataset.k === (first()?.maskShape || 'none'))));

  return h('div', null,
    section('Bild',
      h('div', { class: 'btn-grid two' },
        h('button', { class: 'btn', onclick: () => startCrop(first()) }, icon('crop'), 'Beskär'),
        h('button', { class: 'btn accent', onclick: () => openBgRemoval(first()) }, icon('magic'), 'Ta bort bakgrund'),
        h('button', {
          class: 'btn', onclick: async () => {
            const [img] = await pickImages();
            if (!img) return;
            const url = await A.prepareUpload(img.dataURL);
            const im = await loadImage(url);
            const id = await A.addAsset(url);
            const e = first();
            // Behåll rutans storlek, fyll den som "cover"
            const r = im.naturalWidth / im.naturalHeight, rr = e.w / e.h;
            e.crop = r > rr ? { x: (1 - rr / r) / 2, y: 0, w: rr / r, h: 1 } : { x: 0, y: (1 - r / rr) / 2, w: 1, h: r / rr };
            e.assetId = id; e.maskAssetId = null;
            emit('assets'); emit('doc'); commit();
          },
        }, icon('replace'), 'Ersätt'),
        h('button', { class: 'btn', onclick: () => A.setImageAsBackground(first()) }, icon('bg'), 'Som bakgrund'),
      ),
      el.maskAssetId ? h('button', { class: 'btn full ghost', onclick: () => restoreBackground(first()) }, 'Återställ originalbakgrund') : null,
    ),
    section('Filter', presetGrid),
    section('Justera',
      adj('brightness', 'Ljusstyrka', -100, 100),
      adj('contrast', 'Kontrast', -100, 100),
      adj('saturation', 'Mättnad', -100, 100),
      adj('warmth', 'Värme', -100, 100),
      adj('hue', 'Nyans', -180, 180, '°'),
      adj('vignette', 'Vinjett', 0, 100),
      adj('blur', 'Oskärpa', 0, 60),
      adj('grayscale', 'Gråskala', 0, 100, '%'),
      adj('sepia', 'Sepia', 0, 100, '%'),
      adj('invert', 'Invertera', 0, 100, '%'),
      h('button', { class: 'btn full ghost', onclick: () => setI((e) => { e.filters = { ...DEFAULT_FILTERS }; e.preset = 'none'; }, true) }, 'Återställ justeringar'),
    ),
    section('Form / mask', maskGrid,
      (el.maskShape === 'rounded') ? slider(B, { label: 'Hörnradie', min: 0, max: Math.round(Math.min(el.w, el.h) / 2), get: () => first()?.radius || Math.min(first().w, first().h) * 0.12, set: (v, f) => setI((e) => { e.radius = v; }, f) }) : null,
    ),
    section('Effekter',
      effectSection(B, {
        title: 'Ram',
        get: () => first()?.border?.enabled,
        set: (v) => setI((e) => { e.border.enabled = v; if (v) e.border.width = Math.max(4, Math.min(e.w, e.h) * 0.02); }, true),
        body: h('div', null,
          row(colorBtn(B, { label: 'Färg', get: () => first()?.border.color, set: (v, f) => setI((e) => { e.border.color = v; }, f) })),
          slider(B, { label: 'Tjocklek', min: 0, max: Math.round(Math.min(el.w, el.h) / 4), get: () => first()?.border.width, set: (v, f) => setI((e) => { e.border.width = v; }, f) }),
        ),
      }),
      effectSection(B, {
        title: 'Skugga',
        get: () => first()?.shadow?.enabled,
        set: (v) => setI((e) => { e.shadow.enabled = v; if (v) { const k = Math.min(e.w, e.h) / 300; e.shadow.blur = 25 * k; e.shadow.x = 0; e.shadow.y = 12 * k; e.shadow.color = '#00000059'; } }, true),
        body: shadowControls(() => first()?.shadow || {}, (fn, f) => setI((e) => fn(e.shadow), f)),
      }),
    ),
  );
}

function cropPanel() {
  return h('div', null,
    h('div', { class: 'panel-head' }, h('div', { class: 'ph-title' }, h('span', { class: 'ph-type' }, 'Beskär'))),
    section(null,
      h('p', { class: 'muted small' }, 'Dra i hörnen för att beskära. Dra i bilden för att flytta den inom ramen.'),
      h('div', { class: 'btn-grid two' },
        h('button', { class: 'btn', onclick: () => finishCrop(false) }, 'Avbryt (Esc)'),
        h('button', { class: 'btn primary', onclick: () => finishCrop(true) }, 'Klar (Enter)'),
      ),
      h('button', {
        class: 'btn full ghost', onclick: () => {
          const e = single();
          if (!e) return;
          const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
          const Fw = e.w / e.crop.w, Fh = e.h / e.crop.h;
          e.crop = { x: 0, y: 0, w: 1, h: 1 }; e.w = Fw; e.h = Fh; e.x = cx - Fw / 2; e.y = cy - Fh / 2;
          emit('doc');
        },
      }, 'Återställ beskärning'),
    ),
  );
}

// ---------------- Form ----------------
function shapePanel(el) {
  const setS = (fn, f) => apply(fn, f, { layout: false });
  const open = isOpenShape(el.kind);
  const hasRadius = ['rect', 'rounded', 'triangle', 'diamond', 'polygon', 'star', 'burst', 'cross', 'arrowShape', 'parallelogram', 'speech'].includes(el.kind);
  const hasPoints = ['polygon', 'star', 'burst'].includes(el.kind);
  const hasInner = ['star', 'burst', 'ring'].includes(el.kind);
  return h('div', null,
    !open ? section('Fyllning', row(colorBtn(B, { label: 'Färg', allowGradient: true, allowNone: true, get: () => first()?.fill, set: (v, f) => setS((e) => { e.fill = deepClone(v); }, f) }))) : null,
    open ? section('Linje',
      row(colorBtn(B, { label: 'Färg', get: () => first()?.stroke.color, set: (v, f) => setS((e) => { e.stroke.color = v; e.stroke.enabled = true; }, f) })),
      slider(B, { label: 'Tjocklek', min: 1, max: 200, get: () => first()?.stroke.width, set: (v, f) => setS((e) => { e.stroke.width = v; e.h = Math.max(e.h, v * 3.5); }, f) }),
      select(B, { label: 'Stil', options: [['solid', 'Heldragen'], ['dashed', 'Streckad'], ['dotted', 'Prickad']], get: () => first()?.stroke.dash || 'solid', set: (v) => setS((e) => { e.stroke.dash = v; }, true) }),
      h('div', { class: 'row tight' },
        toggleBtn(B, { label: '◀ Pil i början', get: () => first()?.arrowStart, set: (v) => setS((e) => { e.arrowStart = v; }, true) }),
        toggleBtn(B, { label: 'Pil i slutet ▶', get: () => first()?.arrowEnd, set: (v) => setS((e) => { e.arrowEnd = v; }, true) }),
      ),
    ) : section('Kantlinje',
      effectSection(B, {
        title: 'Visa kantlinje',
        get: () => first()?.stroke?.enabled,
        set: (v) => setS((e) => { e.stroke.enabled = v; }, true),
        body: h('div', null,
          row(colorBtn(B, { label: 'Färg', get: () => first()?.stroke.color, set: (v, f) => setS((e) => { e.stroke.color = v; }, f) })),
          slider(B, { label: 'Tjocklek', min: 0, max: Math.round(Math.min(el.w, el.h) / 4) || 50, get: () => first()?.stroke.width, set: (v, f) => setS((e) => { e.stroke.width = v; }, f) }),
          select(B, { label: 'Stil', options: [['solid', 'Heldragen'], ['dashed', 'Streckad'], ['dotted', 'Prickad']], get: () => first()?.stroke.dash || 'solid', set: (v) => setS((e) => { e.stroke.dash = v; }, true) }),
        ),
      }),
    ),
    hasRadius || hasPoints || hasInner ? section('Form',
      hasRadius ? slider(B, { label: 'Hörnradie', min: 0, max: Math.round(Math.min(el.w, el.h) / 2), get: () => first()?.radius || 0, set: (v, f) => setS((e) => { e.radius = v; }, f) }) : null,
      hasPoints ? slider(B, { label: el.kind === 'polygon' ? 'Hörn' : 'Uddar', min: 3, max: 40, get: () => first()?.points, set: (v, f) => setS((e) => { e.points = v; }, f) }) : null,
      hasInner ? slider(B, { label: el.kind === 'ring' ? 'Hål' : 'Djup', min: 5, max: 95, unit: '%', get: () => Math.round((first()?.innerRatio ?? 0.45) * 100), set: (v, f) => setS((e) => { e.innerRatio = v / 100; }, f) }) : null,
    ) : null,
    section('Effekter', effectSection(B, {
      title: 'Skugga',
      get: () => first()?.shadow?.enabled,
      set: (v) => setS((e) => { e.shadow.enabled = v; if (v) { const k = Math.min(e.w, e.h) / 300; e.shadow.blur = Math.max(6, 25 * k); e.shadow.x = 0; e.shadow.y = Math.max(3, 12 * k); e.shadow.color = '#00000059'; } }, true),
      body: shadowControls(() => first()?.shadow || {}, (fn, f) => setS((e) => fn(e.shadow), f)),
    })),
  );
}

function groupPanel() {
  return section('Grupp',
    h('p', { class: 'muted small' }, `${first().children.length} element. Dubbelklicka på gruppen för att ändra en del utan att dela upp den.`),
    h('button', { class: 'btn full primary', onclick: () => { const g = first(); A.enterGroup(g, g.children[g.children.length - 1]?.id); } }, icon('group'), 'Redigera innehåll'),
    h('button', { class: 'btn full', onclick: () => A.ungroupSelection() }, icon('ungroup'), 'Dela upp grupp (Ctrl+Shift+G)'),
  );
}
