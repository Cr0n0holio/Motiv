// Exportdialog: PNG / JPG / WebP / PDF (vektor eller raster) / SVG.
import { state } from './state.js';
import { h, canvasToBlob, round } from './util.js';
import { modal, toast } from './dialogs.js';
import { renderDoc, drawBackground } from './render.js';
import { buildSVG, rasterSVG } from './svgexport.js';
import { ensureAllImages } from './images.js';
import { ensureDocFonts } from './fonts.js';
import { isTauri, invoke, saveBlob } from './bridge.js';
import { finishTextEdit, finishCrop } from './editor.js';

let last = { format: 'png', scale: 1, quality: 92, transparent: false, bleed: 3, marks: true, raster: false };
try { Object.assign(last, JSON.parse(localStorage.getItem('motiv.export') || '{}')); } catch { /* ignore */ }

const MAX_SIDE = 16000;
const safeName = () => (state.fileName || 'design').replace(/\.(motiv|ediholio)$/i, '').replace(/[\\/:*?"<>|]+/g, '_');

/** Renderar dokumentet (ev. med utfall) till en canvas i given skala. */
export async function renderExportCanvas(scale, { transparent = false, bleedPx = 0, background = null } = {}) {
  await ensureAllImages();
  await ensureDocFonts(state.doc.elements);
  const d = state.doc;
  const W = Math.round((d.width + bleedPx * 2) * scale), H = Math.round((d.height + bleedPx * 2) * scale);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, W, H); }
  ctx.scale(scale, scale);
  ctx.translate(bleedPx, bleedPx);
  if (!transparent) drawBackground(ctx, d, scale, bleedPx, { exact: true });
  renderDoc(ctx, d, scale, { transparent: true, exact: true });
  return c;
}

export function openExportDialog() {
  finishTextEdit();
  finishCrop(true);
  const d = state.doc;
  const o = { ...last };

  const fmtSeg = h('div', { class: 'seg wide export-formats' });
  const FORMATS = [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP'], ['pdf', 'PDF'], ['svg', 'SVG']];
  const opts = h('div', { class: 'export-opts' });
  const info = h('div', { class: 'export-info muted small' });

  const render = () => {
    fmtSeg.innerHTML = '';
    FORMATS.forEach(([k, l]) => fmtSeg.append(h('button', { class: o.format === k ? 'active' : '', onclick: () => { o.format = k; render(); } }, l)));
    opts.innerHTML = '';
    const raster = ['png', 'jpg', 'webp'].includes(o.format);
    if (raster) {
      const scaleSel = h('div', { class: 'seg wide' }, [0.5, 1, 2, 3, 4].map((s) => h('button', { class: o.scale === s ? 'active' : '', onclick: () => { o.scale = s; render(); } }, `${s}×`)));
      opts.append(h('div', { class: 'field' }, h('span', null, 'Storlek'), scaleSel));
      if (o.format !== 'png') {
        const q = h('input', { type: 'range', min: 40, max: 100, value: o.quality, class: 'range' });
        const qv = h('span', null, `${o.quality}%`);
        q.addEventListener('input', () => { o.quality = +q.value; qv.textContent = `${o.quality}%`; });
        opts.append(h('div', { class: 'slider-row' }, h('div', { class: 'slider-head' }, h('span', null, 'Kvalitet'), qv), q));
      }
      if (o.format !== 'jpg') {
        const t = h('input', { type: 'checkbox', checked: o.transparent, onchange: () => { o.transparent = t.checked; } });
        opts.append(h('label', { class: 'check' }, t, 'Genomskinlig bakgrund'));
      }
      const W = Math.round(d.width * o.scale), H = Math.round(d.height * o.scale);
      info.textContent = `${W} × ${H} px` + (W > MAX_SIDE || H > MAX_SIDE ? ' – för stort, minska storleken' : '');
    } else if (o.format === 'pdf') {
      const bleed = h('input', { class: 'num-input', type: 'number', min: 0, max: 20, step: 0.5, value: o.bleed });
      bleed.addEventListener('change', () => { o.bleed = Math.max(0, +bleed.value || 0); });
      const marks = h('input', { type: 'checkbox', checked: o.marks, onchange: () => { o.marks = marks.checked; } });
      const rast = h('input', { type: 'checkbox', checked: o.raster, onchange: () => { o.raster = rast.checked; } });
      opts.append(
        h('label', { class: 'field' }, h('span', null, 'Utfall (mm)'), bleed),
        h('label', { class: 'check' }, marks, 'Skärmärken'),
        h('label', { class: 'check' }, rast, 'Rastrera allt (exakt utseende, ingen vektortext)'),
        h('p', { class: 'muted small' }, 'Vektor-PDF behåller text och former skarpa i alla storlekar. Utfallet fylls med bakgrunden och element som sticker ut över kanten.'),
      );
      const mm = (px) => round((px / d.dpi) * 25.4, 1);
      info.textContent = `${mm(d.width)} × ${mm(d.height)} mm (${d.dpi} dpi)`;
      if (!isTauri) info.textContent += ' – PDF kräver skrivbordsappen';
    } else {
      opts.append(h('p', { class: 'muted small' }, 'SVG kan öppnas och redigeras vidare i t.ex. Inkscape, Illustrator eller Figma. Bilder och filtereffekter bäddas in. Egna och nedladdade fonter bäddas in.'));
      info.textContent = `${d.width} × ${d.height}`;
    }
  };
  render();

  modal({
    title: 'Exportera',
    width: 460,
    body: h('div', null, fmtSeg, opts, info),
    actions: [
      { label: 'Avbryt' },
      {
        label: 'Exportera', primary: true, onClick: async (btn) => {
          btn.textContent = 'Exporterar…';
          last = { ...o };
          try { localStorage.setItem('motiv.export', JSON.stringify(last)); } catch { /* ignore */ }
          await doExport(o);
          return true;
        },
      },
    ],
  });
}

async function doExport(o) {
  const d = state.doc;
  const name = safeName();
  if (['png', 'jpg', 'webp'].includes(o.format)) {
    let scale = o.scale;
    const maxS = Math.min(MAX_SIDE / d.width, MAX_SIDE / d.height);
    if (scale > maxS) { scale = maxS; toast('Storleken begränsades till max 16000 px', 'info'); }
    const transparent = o.transparent && o.format !== 'jpg';
    const c = await renderExportCanvas(scale, { transparent, background: o.format === 'jpg' ? '#ffffff' : null });
    const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[o.format];
    const blob = await canvasToBlob(c, mime, o.format === 'png' ? undefined : o.quality / 100);
    const ext = o.format;
    const path = await saveBlob(blob, `${name}.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }]);
    if (path) toast(`Sparad: ${path.split(/[\\/]/).pop()}`, 'ok');
  } else if (o.format === 'svg') {
    const svg = await buildSVG(d, { embedFonts: true, imgScale: 1 });
    const path = await saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`, [{ name: 'SVG', extensions: ['svg'] }]);
    if (path) toast(`Sparad: ${path.split(/[\\/]/).pop()}`, 'ok');
  } else if (o.format === 'pdf') {
    if (!isTauri) throw new Error('PDF-export kräver skrivbordsappen');
    const path = await invoke('save_file_dialog', { defaultName: `${name}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!path) return;
    const bleedPx = (o.bleed / 25.4) * d.dpi;
    let svg;
    if (o.raster) {
      const c = await renderExportCanvas(1, { bleedPx });
      svg = rasterSVG(c.toDataURL('image/jpeg', 0.95), d, { bleedMm: o.bleed, cropMarks: o.marks });
    } else {
      await ensureDocFonts(d.elements);
      svg = await buildSVG(d, { forPdf: true, bleedMm: o.bleed, cropMarks: o.marks, imgScale: 1 });
    }
    await invoke('export_pdf', { path, svg });
    toast(`PDF sparad: ${path.split(/[\\/]/).pop()}`, 'ok');
  }
}
