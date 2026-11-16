// Tester som kör appens egen kod i en riktig webbläsare (canvas, fonter,
// SVG). Öppna verktyg/tester.html via en lokal server, eller kör
// `npm test` som startar en webbläsare och läser av resultatet.
import * as S from '../ui/js/state.js';
import * as A from '../ui/js/actions.js';
import * as P from '../ui/js/pages.js';
import { renderToCanvas } from '../ui/js/render.js';
import { layoutText, textPlateRect, syncTextBox, caretRect, indexAtPoint, selectionRects, caretLineMove, wordRange } from '../ui/js/text.js';
import { getRuns, setRange, clearRunProp, replaceText, styleAt } from '../ui/js/richtext.js';
import { buildSVG } from '../ui/js/svgexport.js';
import { shrinkImage, alphaAt, ensureImage } from '../ui/js/images.js';
import { TEMPLATES, templateSlug } from '../ui/js/templates.js';
import { gradientLine } from '../ui/js/paint.js';
import { resizedView, renderExportCanvas } from '../ui/js/exporter.js';
import { parseColor } from '../ui/js/util.js';
import { ICON_LIST } from '../ui/js/icondata.js';
import { qrPath } from '../ui/js/qr.js';

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

test('text i en speglad grupp förblir rättvänd, och avgruppering ändrar inte bilden', () => {
  for (const [fx, fy] of [[true, false], [false, true], [true, true]]) {
    fresh();
    const t = A.addText('heading', { text: 'ABC', fontSize: 160 }); t.rotation = 15; t.x -= 150;
    const b = A.addShape('rect'); b.y += 300;
    const plain = snapshotPixels();
    S.select([t.id, b.id]); A.groupSelection();
    const g = S.single(); g.flipX = fx; g.flipY = fy;
    const flipped = snapshotPixels();
    A.ungroupSelection();
    eq(pixelDiff(flipped, snapshotPixels()), 0, `avgruppering, spegling ${fx},${fy}:`);
    const txt = S.state.doc.elements.find((e) => e.type === 'text');
    ok(!txt.flipX && !txt.flipY, 'texten blev speglad');
    // Speglad åt båda hållen = ett halvt varv för gruppen, men texten står kvar rättvänd
    if (fx && fy) near(txt.rotation, 15, 0.01, 'textens rotation:');
    ok(plain.length === flipped.length);
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

// ---------- Ramar, ikoner och QR-koder ----------
test('en bild som läggs i en ram fyller den och beskärs, tomma ramar exporteras inte', async () => {
  fresh(1000, 1000);
  const g = A.addGrid('två-bredvid');
  const frame = g.children[0];
  let svg = await buildSVG(S.pageView(S.state.doc, 0), {});
  ok(!svg.includes('<image'), 'en tom ram kom med i exporten');
  const c = document.createElement('canvas'); c.width = 1000; c.height = 500;
  c.getContext('2d').fillRect(0, 0, 1000, 500);
  await A.fillFrame(frame, c.toDataURL('image/png'));
  ok(frame.assetId, 'ramen fick ingen bild');
  // Den synliga delen av bilden (1000×500 px) ska ha ramens proportioner
  near((frame.crop.w * 1000) / (frame.crop.h * 500), frame.w / frame.h, 0.01, 'beskärningen följer ramens proportioner:');
  svg = await buildSVG(S.pageView(S.state.doc, 0), {});
  eq((svg.match(/<image /g) || []).length, 1);
  A.emptyFrame(frame);
  eq(frame.assetId, null);
});

test('ikoner ritas, exporteras som vektor och byter färg med paletten', async () => {
  fresh(400, 400);
  const def = ICON_LIST.find((d) => d.id === 'heart');
  const ic = A.addIcon(def);
  ic.color = '#ff0000';
  const px = snapshotPixels();
  let red = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] < 80) red++;
  ok(red > 50, 'ikonen syns inte');
  const svg = await buildSVG(S.pageView(S.state.doc, 0), {});
  ok(svg.includes(def.d[0]), 'ikonens linjer saknas i SVG:n');
  eq(A.replaceColor('#ff0000', '#00ff00'), 1);
  eq(ic.color, '#00ff00');
  ok(ICON_LIST.length >= 150 && new Set(ICON_LIST.map((d) => d.id)).size === ICON_LIST.length, 'ikonlistan');
});

test('QR-koder har giltig storlek, sökarmönster i hörnen och klarar å, ä, ö', () => {
  for (const text of ['https://exempel.se', 'Hej på dig, åäö!']) {
    const q = qrPath(text, 'M');
    ok(q && (q.n - 21) % 4 === 0, `ogiltig storlek ${q?.n}`);
    // Sökarmönstrets yttre ram (7 rutor) börjar i övre vänstra hörnet
    ok(q.d.startsWith('M0 0h7v1h-7z'), 'sökarmönster saknas');
  }
  eq(qrPath('', 'M'), null);
  eq(qrPath('x'.repeat(5000), 'H'), null, 'för lång text');
});

// ---------- Rik text och listor ----------
test('formatering av en del av texten följer med när texten ändras', () => {
  fresh();
  const el = A.addText('heading', { text: 'Hej stora världen' });
  setRange(el, 4, 9, { color: '#ff0000', weight: 400 });
  eq(el.runs, [{ n: 4 }, { color: '#ff0000', weight: 400, n: 5 }, { n: 8 }]);
  // Skriv i mitten av det formaterade ordet: den nya texten ärver formateringen
  replaceText(el, 'Hej stoXXra världen', 9);
  eq(el.runs.map((r) => r.n), [4, 7, 8]);
  // Skriv före: formateringen flyttas
  replaceText(el, 'Åh, Hej stoXXra världen', 4);
  eq(styleAt(el, 8).color, '#ff0000');
  eq(styleAt(el, 7).color, undefined);
  // Ta bort hela det formaterade ordet
  replaceText(el, 'Åh, Hej  världen', 8);
  eq(el.runs, undefined, 'ingen formatering kvar:');
  eq(getRuns(el), [{ n: el.text.length }]);
});

test('samma formatering slås ihop och kan nollställas', () => {
  fresh();
  const el = A.addText('heading', { text: 'abcdefgh' });
  setRange(el, 0, 4, { italic: true });
  setRange(el, 4, 8, { italic: true });
  eq(el.runs, [{ italic: true, n: 8 }]);
  setRange(el, 2, 6, { color: '#00ff00' });
  eq(el.runs.length, 3);
  clearRunProp(el, 'italic');
  eq(el.runs, [{ n: 2 }, { color: '#00ff00', n: 4 }, { n: 2 }]);
  setRange(el, 0, 8, { color: null });
  eq(el.runs, undefined);
  // Trasig data tål layouten: för många eller för få tecken
  el.runs = [{ n: 3, size: 2 }, { n: 100, color: '#123456' }];
  eq(getRuns(el).map((r) => r.n), [3, 5]);
  el.runs = [{ n: 2, size: 2 }];
  eq(getRuns(el).map((r) => r.n), [2, 6]);
  ok(layoutText(el).lines.length >= 1);
});

test('rik text: större text ger högre rad och delarna ligger kant i kant', () => {
  fresh();
  const el = A.addText('heading', { text: 'liten STOR liten\nrad två', fontSize: 100, width: 5000, align: 'left', lineHeight: 1.2 });
  const before = layoutText(el);
  near(before.lines[0].height, 120);
  setRange(el, 6, 10, { size: 2, weight: 400 });
  syncTextBox(el, 'top');
  const L = layoutText(el);
  eq(L.lines[0].segs.map((s) => s.text), ['liten ', 'STOR', ' liten']);
  near(L.lines[0].height, 240, 0.01, 'första radens höjd:');
  near(L.lines[1].height, 120, 0.01, 'andra radens höjd:');
  near(el.h, 360, 0.01, 'rutans höjd:');
  const [a, b, c] = L.lines[0].segs;
  ok(b.x > a.x && c.x > b.x + b.width - 1, 'delarna ligger i ordning');
  near(L.lines[0].width, c.x + c.width - a.x, 0.5, 'radens bredd:');
  // Ritningen ändras av färg på en del
  el.x = 20; el.y = 20;
  const p0 = snapshotPixels();
  setRange(el, 0, 5, { color: '#ff0000' });
  ok(pixelDiff(p0, snapshotPixels()) > 20, 'färgad del syns i ritningen');
});

test('markör och markering följer textlayouten', () => {
  fresh();
  const el = A.addText('heading', { text: 'ett två tre\nfyra fem', fontSize: 100, width: 5000, align: 'left' });
  setRange(el, 4, 7, { size: 2 });
  syncTextBox(el, 'top');
  const L = layoutText(el);
  eq(caretRect(el, 0).x, L.lines[0].x);
  near(caretRect(el, 11).x, L.lines[0].x + L.lines[0].width, 0.5, 'radens slut:');
  ok(caretRect(el, 12).y >= L.lines[1].top, 'position 12 står på andra raden');
  // Klick mitt i ett tecken hamnar på närmaste teckengräns
  for (const i of [0, 3, 5, 8, 11, 14, 20]) {
    const c = caretRect(el, i);
    eq(indexAtPoint(el, c.x + 0.5, c.y + c.h / 2), i, `klick vid position ${i}:`);
  }
  eq(indexAtPoint(el, -50, 10), 0);
  eq(indexAtPoint(el, 99999, 99999), el.text.length);
  eq(selectionRects(el, 2, 15).length, 2, 'markering över två rader:');
  eq(selectionRects(el, 5, 5), []);
  eq(caretLineMove(el, 0, 1), 12, 'rad ned från början:');
  eq(caretLineMove(el, 14, -1) <= 11, true);
  eq(caretLineMove(el, 3, -1), 0, 'rad upp från första raden:');
  eq(wordRange(el, 5), [4, 7]);
});

test('listor: punkter och nummer får indrag och hoppar över tomma rader', () => {
  fresh();
  const el = A.addText('body', { text: 'första\n\nandra som är lång nog att brytas på flera rader i rutan\ntredje', fontSize: 60, width: 700, align: 'left' });
  const plainX = layoutText(el).lines[0].x;
  el.list = 'bullet';
  syncTextBox(el, 'top');
  let L = layoutText(el);
  ok(L.lines[0].x > plainX + 20, 'texten är indragen');
  eq(L.lines.filter((l) => l.marker).map((l) => l.marker.text), ['•', '•', '•']);
  ok(L.lines.every((l) => l.x === L.lines[0].x), 'fortsättningsrader har samma indrag');
  ok(L.lines[0].marker.x >= 0 && L.lines[0].marker.x < L.lines[0].x, 'punkten står i indraget');
  ok(L.lines.every((l) => l.x + l.width <= 700.5), 'texten håller sig i rutan');
  el.list = 'number';
  L = layoutText(el);
  eq(L.lines.filter((l) => l.marker).map((l) => l.marker.text), ['1.', '2.', '3.']);
  eq(L.lines[1].marker, null, 'tom rad har inget nummer:');
});

test('SVG-export: rik text och listor', async () => {
  fresh();
  const el = A.addText('heading', { text: 'Röd och stor\nrad två', fontSize: 100, width: 2000, align: 'left', underline: false });
  setRange(el, 0, 3, { color: '#ff0000', underline: true });
  setRange(el, 8, 12, { size: 1.5, italic: true, weight: 400 });
  el.list = 'number';
  syncTextBox(el, 'top');
  const svg = await buildSVG(S.pageView(S.state.doc, 0), {});
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  ok(!doc.querySelector('parsererror'), 'giltig SVG');
  const texts = [...doc.querySelectorAll('text')];
  eq(texts.map((t) => t.textContent), ['1.', 'Röd', ' och ', 'stor', '2.', 'rad två']);
  eq(texts[1].getAttribute('fill'), 'rgb(255,0,0)');
  eq(texts[3].getAttribute('font-size'), '150');
  eq(texts[3].getAttribute('font-style'), 'italic');
  eq(texts[3].getAttribute('font-weight'), '400');
  eq(texts[2].getAttribute('font-size'), null, 'oformaterad del ärver:');
  eq(doc.querySelectorAll('rect[fill="rgb(255,0,0)"]').length, 1, 'understrykning i delens färg:');
});

test('palettbyte når färger på delar av en text', () => {
  fresh();
  const el = A.addText('heading', { text: 'abc def' });
  setRange(el, 0, 3, { color: '#ff0000' });
  S.commit();
  A.replaceColor('#ff0000', '#00ff00');
  eq(el.runs[0].color, '#00ff00');
});

// ---------- Mallar ----------
test('alla mallar byggs och har innehåll på sidan', () => {
  ok(TEMPLATES.length >= 26, `bara ${TEMPLATES.length} mallar`);
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
