// Renderar varje mall med appens egen renderingskod och skickar bilden till
// mallbilder.py, som sparar den i ui/img/mallar.
import { TEMPLATES, templateSlug } from '../ui/js/leftpanel.js';
import { invalidateTextCache } from '../ui/js/text.js';
import { relayoutAllText } from '../ui/js/actions.js';
import { renderToCanvas } from '../ui/js/render.js';
import { canvasToBlob } from '../ui/js/util.js';

const MAX_SIDA = 360; // px – miniatyrerna visas runt 130 px breda, ×2 för skarpa skärmar
const status = document.getElementById('status');
const lista = document.getElementById('lista');

/**
 * Laddar exakt de vikter mallen använder direkt från Google Fonts.
 * (Appens webbläsarläge laddar bara 400/700, skrivbordsappen alla vikter.)
 */
async function loadFonts(elements) {
  const combos = new Map();
  const walk = (list) => list.forEach((e) => {
    if (e.type === 'text') combos.set(`${e.fontFamily}|${e.fontWeight}|${e.italic ? 1 : 0}`, e);
    if (e.type === 'group') walk(e.children);
  });
  walk(elements);
  const css = (e, ital) => new Promise((klar) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${e.fontFamily.replace(/ /g, '+')}:ital,wght@${ital},${e.fontWeight}&display=block`;
    l.onload = l.onerror = klar;
    document.head.append(l);
  });
  // Rak stil laddas alltid: fonter utan kursiv (t.ex. Oswald) lutas då
  // konstgjort, precis som i appen.
  await Promise.all([...combos.values()].flatMap((e) => (e.italic ? [css(e, 0), css(e, 1)] : [css(e, 0)])));
  await Promise.all([...combos.values()].map((e) => document.fonts.load(`${e.italic ? 'italic ' : ''}${e.fontWeight} 40px "${e.fontFamily}"`).catch(() => {})));
  invalidateTextCache(); // textmåtten räknas om med de nya fonterna
}

for (const [i, t] of TEMPLATES.entries()) {
  status.textContent = `Renderar ${i + 1}/${TEMPLATES.length}: ${t.name}`;
  // Fonterna laddas först, sedan byggs mallen om så att texten placeras med rätt mått
  await loadFonts(t.build().elements);
  const doc = t.build();
  relayoutAllText(doc.elements);
  const canvas = renderToCanvas(doc, MAX_SIDA / Math.max(doc.width, doc.height));
  const blob = await canvasToBlob(canvas, 'image/webp', 0.86);
  const namn = `${templateSlug(t)}.webp`;
  const svar = await fetch(`/spara/${namn}`, { method: 'PUT', body: blob });
  if (!svar.ok) throw new Error(`Kunde inte spara ${namn}: ${svar.status}`);
  lista.append(Object.assign(document.createElement('figure'), { innerHTML: `<img src="${URL.createObjectURL(blob)}"><figcaption>${namn}</figcaption>` }));
}
status.textContent = `Klart – ${TEMPLATES.length} bilder sparade i ui/img/mallar.`;
