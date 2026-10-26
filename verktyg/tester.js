// Tester som kör appens egen kod i en riktig webbläsare (canvas, fonter,
// SVG). Öppna verktyg/tester.html via en lokal server, eller kör
// `npm test` som startar en webbläsare och läser av resultatet.
import * as S from '../ui/js/state.js';
import * as A from '../ui/js/actions.js';
import * as P from '../ui/js/pages.js';
import { renderToCanvas } from '../ui/js/render.js';
import { layoutText, textPlateRect } from '../ui/js/text.js';
import { buildSVG } from '../ui/js/svgexport.js';
import { shrinkImage, alphaAt, ensureImage } from '../ui/js/images.js';
import { TEMPLATES, templateSlug } from '../ui/js/leftpanel.js';
import { gradientLine } from '../ui/js/paint.js';
import { resizedView, renderExportCanvas } from '../ui/js/exporter.js';
import { parseColor } from '../ui/js/util.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- Hjälpare ----------
class Fel extends Error {}
const ok = (v, msg = 'förväntade sant') => { if (!v) throw new Fel(msg); };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Fel(`${msg} väntade ${JSON.stringify(b)}, fick ${JSON.stringify(a)}`); };
const near = (a, b, tol = 0.5, msg = '') => { if (Math.abs(a - b) > tol) throw new Fel(`${msg} väntade ≈${b}, fick ${a}`); };
const fresh = (w = 1000, h = 1000) => { S.loadDoc(S.newDoc(w, h, 72), { fileName: 'test', filePath: null }); return S.state.doc; };
/** Antal pixlar som skiljer sig mellan två renderingar av den aktuella sidan. */
function snapshotPixels() {
  const c = renderToCanvas(S.pageView(S.state.doc, S.state.doc.pageIndex), 0.25);
  return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
}
function pixelDiff(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++;
  return n;
}

// ---------- Dokument och sidor ----------
test('nytt dokument har en tom sida och en tom palett', () => {
  const d = fresh();
  eq(d.pages.length, 1);
  eq(d.elements.length, 0);
  eq(d.palette, []);
});

test('doc.elements och doc.background följer den aktuella sidan', () => {
  fresh();
  A.addShape('rect');
  P.addPage();
  eq(S.state.doc.elements.length, 0, 'ny sida');
  A.addShape('star');
  A.addShape('ellipse');
  P.goToPage(0);
  eq(S.state.doc.elements.length, 1, 'sida 1');
  eq(S.allElements().length, 3, 'alla sidor');
});

test('spara och öppna behåller sidor och palett, men inte interna egenskaper', () => {
  fresh();
  A.addText('heading', { text: 'Hej' });
  P.addPage();
  S.state.doc.palette.push('#ff0000');
  const json = S.serializeDoc();
  const o = JSON.parse(json);
  eq(o.version, 2);
  ok(!('elements' in o.doc) && !('pageIndex' in o.doc) && !('groupPath' in o.doc), 'interna egenskaper sparades');
  const back = S.parseDoc(json);
  eq(back.pages.length, 2);
  eq(back.palette, ['#ff0000']);
  eq(back.pages[0].elements[0].text, 'Hej');
});

test('gamla projekt (version 1) öppnas som en design med en sida', () => {
  const v1 = { app: 'ediholio', version: 1, doc: { width: 500, height: 500, dpi: 72, background: { fill: { type: 'solid', color: '#123456' }, image: null }, elements: [S.createText({ text: 'gammal' })], assets: {} } };
  const d = S.parseDoc(JSON.stringify(v1));
  eq(d.pages.length, 1);
  eq(d.elements[0].text, 'gammal');
  eq(d.background.fill.color, '#123456');
});

test('ångra och gör om hoppar till sidan där ändringen gjordes', () => {
  fresh();
  P.addPage();
  A.addShape('star');
  P.goToPage(0);
  S.undo();
  eq(S.state.doc.pageIndex, 1, 'efter ångra');
  eq(S.state.doc.elements.length, 0, 'stjärnan är borta');
  S.redo();
  eq(S.state.doc.elements.length, 1, 'stjärnan är tillbaka');
});

test('sidor kan dupliceras (nya id:n), flyttas och tas bort', () => {
  fresh();
  A.addText('heading', { text: 'A' });
  P.duplicatePage();
  const ids = S.allElements().map((e) => e.id);
  eq(new Set(ids).size, 2, 'unika id:n');
  P.addPage();
  A.addText('heading', { text: 'C' });
  P.movePage(2, 0);
  eq(S.state.doc.pages[0].elements[0].text, 'C');
  P.deletePage(0);
  eq(S.state.doc.pages.length, 2);
});

// ---------- Grupper ----------
test('avgruppering av en roterad och speglad grupp ändrar inte bilden', () => {
  for (const [fx, fy] of [[true, false], [false, true], [true, true]]) {
    fresh();
    const a = A.addShape('triangle'); a.rotation = 25; a.x -= 200;
    const b = A.addShape('arrowShape'); b.x += 150; b.y += 100; b.flipY = true; b.rotation = -40;
    S.select([a.id, b.id]); A.groupSelection();
    const g = S.single(); g.flipX = fx; g.flipY = fy; g.rotation = 30;
    const before = snapshotPixels();
    A.ungroupSelection();
    eq(pixelDiff(before, snapshotPixels()), 0, `spegling ${fx},${fy}:`);
  }
});

test('redigering i grupp: lämna gruppen ändrar inte bilden och ger inget ångringssteg', () => {
  fresh();
  const a = A.addShape('rect'); a.x = 100; a.y = 100; a.w = 200; a.h = 200;
  const b = A.addShape('star'); b.x = 500; b.y = 500;
  S.select([a.id, b.id]); A.groupSelection();
  const g = S.single(); g.rotation = 20; g.flipX = true; S.commit();
  A.enterGroup(g, g.children[0].id);
  S.single().x += 300; // flytta en del inne i gruppen
  S.commit();
  const before = snapshotPixels();
  A.exitGroup();
  eq(S.state.doc.groupPath.length, 0);
  eq(pixelDiff(before, snapshotPixels()), 0, 'efter omräkning av ramen:');
  S.undo();
  near(S.state.doc.elements[0].children.length, 2, 0, 'gruppen finns kvar efter ångra');
});

test('en grupp med en del kvar löses upp när man lämnar den', () => {
  fresh();
  const a = A.addShape('rect'), b = A.addShape('star');
  S.select([a.id, b.id]); A.groupSelection();
  const g = S.single();
  A.enterGroup(g, g.children[0].id);
  A.deleteSelection();
  A.exitGroup();
  eq(S.state.doc.elements.map((e) => e.type), ['shape']);
});

// ---------- Text ----------
test('lång text bryts på flera rader inom rutans bredd', () => {
  fresh();
  const t = A.addText('body', { text: 'Det här är en ganska lång mening som ska brytas', width: 300, fontSize: 30 });
  const L = layoutText(t);
  ok(L.lines.length > 1, 'bara en rad');
  ok(L.lines.every((ln) => ln.width <= 300 + 0.5), 'en rad är för bred');
});

test('textplattan följer texten i stället för hela rutan', () => {
  fresh();
  const t = A.addText('body', { text: 'Kort', width: 800, fontSize: 40, background: { enabled: true, color: '#000', padding: 0.25, radius: 0 } });
  const p = textPlateRect(t);
  ok(p.w < 400, `plattan är ${Math.round(p.w)} px bred`);
});

// ---------- Färger ----------
test('gradientlinjen följer CSS-vinklar', () => {
  const [x1, y1, x2, y2] = gradientLine(90, 0, 0, 100, 100);
  near(x1, 0); near(y1, 50); near(x2, 100); near(y2, 50);
});

test('byta en färg i hela designen behåller genomskinligheten', () => {
  fresh();
  const s = A.addShape('rect', { fill: { type: 'solid', color: '#ff0000' } });
  s.stroke = { enabled: true, color: '#ff000080', width: 4, dash: 'solid' };
  S.state.doc.background.fill = { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#FF0000' }, { offset: 1, color: '#ffffff' }] };
  const n = A.replaceColor('#ff0000', '#00ff00');
  eq(n, 3);
  eq(s.fill.color, '#00ff00');
  eq(parseColor(s.stroke.color).a.toFixed(2), '0.50');
  eq(S.state.doc.background.fill.stops[1].color, '#ffffff', 'andra färger rörs inte');
});

test('paletten hämtar designens färger', () => {
  fresh();
  A.addShape('rect', { fill: { type: 'solid', color: '#123456' } });
  A.paletteFromDesign();
  ok(S.state.doc.palette.includes('#123456'));
});

// ---------- Storlek ----------
test('anpassa till nytt format skalar och centrerar innehållet', () => {
  fresh(1000, 1000);
  const r = A.addShape('rect'); r.x = 0; r.y = 0; r.w = 1000; r.h = 1000;
  A.fitElements([r], 1000, 1000, 2000, 1000, true);
  near(r.w, 1000); near(r.x, 500); near(r.y, 0);
});

test('export i ett annat format: innehållet ryms och originalet ändras inte', async () => {
  fresh(1000, 1000);
  const r = A.addShape('rect'); r.x = 0; r.y = 0; r.w = 1000; r.h = 1000;
  const v = resizedView(0, 1080, 1920);
  eq([v.width, v.height], [1080, 1920]);
  const c = v.elements[0];
  ok(c.x >= -0.5 && c.y >= -0.5 && c.x + c.w <= 1080.5 && c.y + c.h <= 1920.5, 'innehållet sticker ut');
  eq([r.x, r.w], [0, 1000], 'originalet ändrades:');
  const canvas = await renderExportCanvas(1, { view: v });
  eq([canvas.width, canvas.height], [1080, 1920]);
});

// ---------- Mallar ----------
test('alla mallar byggs och har innehåll på sidan', () => {
  ok(TEMPLATES.length >= 21, `bara ${TEMPLATES.length} mallar`);
  const slugs = new Set();
  for (const t of TEMPLATES) {
    const d = t.build();
    ok(d.elements.length > 0, `${t.name} är tom`);
    for (const el of d.elements) {
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      ok(cx > -d.width * 0.2 && cx < d.width * 1.2 && cy > -d.height * 0.2 && cy < d.height * 1.2, `${t.name}: "${el.name}" ligger utanför sidan`);
    }
    slugs.add(templateSlug(t));
  }
  eq(slugs.size, TEMPLATES.length, 'mallarnas filnamn är unika:');
});

// ---------- Export ----------
test('SVG-export innehåller text och böjd text med gradient', async () => {
  fresh();
  A.addText('heading', { text: 'Rak' });
  A.addText('heading', { text: 'Böjd', curve: { mode: 'arc', amount: 40 }, fill: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#f00' }, { offset: 1, color: '#00f' }] } });
  const svg = await buildSVG(S.pageView(S.state.doc, 0), { forPdf: true });
  ok(svg.startsWith('<?xml') && svg.includes('<svg'), 'ingen svg');
  ok(svg.includes('>Rak</text>'), 'rak text saknas');
  ok(/rotate="[-\d.]+"/.test(svg), 'böjd text placeras inte med rotate');
  ok(svg.includes('<linearGradient'), 'gradienten saknas');
});

// ---------- Bilder ----------
test('stora foton krymps, små lämnas orörda', async () => {
  const big = document.createElement('canvas'); big.width = 4000; big.height = 2000;
  big.getContext('2d').fillRect(0, 0, 4000, 2000);
  const r = await shrinkImage(big.toDataURL('image/jpeg', 0.9), 2000);
  ok(r, 'stort foto krymptes inte');
  eq(r.to, [2000, 1000]);
  const small = document.createElement('canvas'); small.width = 500; small.height = 500;
  eq(await shrinkImage(small.toDataURL('image/png'), 2000), null);
});

test('genomskinliga delar av en bild känns igen', async () => {
  fresh();
  const c = document.createElement('canvas'); c.width = 100; c.height = 100;
  c.getContext('2d').fillRect(50, 0, 50, 100); // högra halvan täckande
  const el = await A.addImageFromDataURL(c.toDataURL('image/png'));
  await ensureImage(el.assetId);
  ok(alphaAt(el.assetId, null, 0.25, 0.5) < 16, 'vänster halva borde vara genomskinlig');
  ok(alphaAt(el.assetId, null, 0.75, 0.5) > 200, 'höger halva borde vara täckande');
});

// ---------- Kör ----------
const lista = document.getElementById('lista');
const resultat = { passed: 0, failed: 0, fel: [] };
for (const t of tests) {
  const li = document.createElement('li');
  try {
    await t.fn();
    resultat.passed++;
    li.innerHTML = `<span class="ok">✓</span> ${t.name}`;
  } catch (e) {
    resultat.failed++;
    resultat.fel.push({ test: t.name, fel: String(e.message || e) });
    li.innerHTML = `<span class="fel">✗</span> ${t.name}<pre>${String(e.stack || e)}</pre>`;
  }
  lista.append(li);
}
document.getElementById('sammanfattning').innerHTML = resultat.failed
  ? `<span class="fel">${resultat.failed} av ${tests.length} tester misslyckades</span>`
  : `<span class="ok">Alla ${tests.length} tester lyckades</span>`;
window.__resultat = resultat;
