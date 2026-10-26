// Fonter: systemfonter (via Rust), Google Fonts (laddas ned och cachas
// lokalt av Rust) och egna fontfiler. Allt registreras med FontFace så att
// canvasen kan använda dem direkt.
import { isTauri, invoke, pickFontPaths } from './bridge.js';
import { base64ToArrayBuffer } from './util.js';
import { emit } from './state.js';
import { invalidateTextCache } from './text.js';

export const GOOGLE_FONTS = [
  // Sans
  'Montserrat', 'Poppins', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Raleway', 'Nunito', 'Work Sans', 'Rubik',
  'Outfit', 'Sora', 'Lexend', 'Space Grotesk', 'Josefin Sans', 'League Spartan', 'Archivo', 'Barlow', 'DM Sans', 'Manrope',
  'Plus Jakarta Sans', 'Syne', 'Unbounded', 'Kanit', 'Exo 2',
  // Display / rubrik
  'Bebas Neue', 'Anton', 'Oswald', 'Archivo Black', 'Alfa Slab One', 'Abril Fatface', 'Righteous', 'Bungee', 'Staatliches',
  'Teko', 'Barlow Condensed', 'Fjalla One', 'Russo One', 'Black Ops One', 'Monoton', 'Bangers', 'Ultra', 'Rye',
  'Orbitron', 'Audiowide', 'Press Start 2P', 'Rowdies', 'Titan One', 'Luckiest Guy', 'Passion One', 'Chango', 'Fredoka',
  'Comfortaa', 'Baloo 2', 'Creepster', 'Rubik Mono One', 'Big Shoulders Display', 'Dela Gothic One',
  // Serif
  'Playfair Display', 'Merriweather', 'Lora', 'Libre Baskerville', 'Cormorant Garamond', 'DM Serif Display', 'Cinzel',
  'Bodoni Moda', 'Crimson Text', 'EB Garamond', 'Prata', 'Zilla Slab', 'Roboto Slab', 'Fraunces', 'Yeseva One',
  // Handskrift / skript
  'Pacifico', 'Lobster', 'Dancing Script', 'Great Vibes', 'Satisfy', 'Sacramento', 'Caveat', 'Kaushan Script',
  'Permanent Marker', 'Shadows Into Light', 'Amatic SC', 'Yellowtail', 'Allura', 'Parisienne', 'Indie Flower',
  'Gloria Hallelujah', 'Courgette', 'Cookie', 'Homemade Apple', 'Mrs Saint Delafield', 'Rock Salt',
  // Mono
  'Space Mono', 'JetBrains Mono', 'Courier Prime', 'IBM Plex Mono',
];

const BROWSER_FALLBACK_SYSTEM = ['Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Ink Free', 'Lucida Console', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Black', 'Sitka Text', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

export const fontState = {
  system: [],
  app: [],            // [{family, weight, style, file, source}]
  loadedFamilies: new Set(),
  bytes: new Map(),   // "family|weight|style" -> base64 (för SVG-inbäddning)
  downloading: new Set(),
  recent: [],
};

try { fontState.recent = JSON.parse(localStorage.getItem('motiv.recentFonts') || '[]'); } catch { /* ignore */ }

let changeTimer = null;
function fontsChanged() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => { invalidateTextCache(); emit('fonts'); }, 30);
}

// När webbläsaren laddat klart en font måste textlayouten räknas om.
if (document.fonts) document.fonts.addEventListener('loadingdone', fontsChanged);

async function registerAppFont(f) {
  try {
    const b64 = await invoke('read_font_file', { file: f.file });
    const face = new FontFace(f.family, base64ToArrayBuffer(b64), { weight: String(f.weight), style: f.style });
    await face.load();
    document.fonts.add(face);
    fontState.bytes.set(`${f.family}|${f.weight}|${f.style}`, { b64, file: f.file });
    fontState.loadedFamilies.add(f.family);
  } catch (e) {
    console.warn('Kunde inte registrera font', f, e);
  }
}

export async function initFonts() {
  if (isTauri) {
    try { fontState.system = await invoke('list_system_fonts'); } catch { fontState.system = BROWSER_FALLBACK_SYSTEM; }
    try {
      fontState.app = await invoke('list_app_fonts');
      await Promise.all(fontState.app.map(registerAppFont));
    } catch (e) { console.warn(e); }
  } else {
    fontState.system = BROWSER_FALLBACK_SYSTEM;
  }
  // Standardfonten laddas direkt så att första texten ser rätt ut.
  ensureFamily('Montserrat').catch(() => {});
  fontsChanged();
}

export const isGoogle = (family) => GOOGLE_FONTS.includes(family);
export const isAppFont = (family) => fontState.app.some((f) => f.family === family);
export const isSystem = (family) => fontState.system.includes(family);
export const isAvailable = (family) => fontState.loadedFamilies.has(family) || isSystem(family);

/** Ser till att en familj finns (laddar ned Google Font vid behov). */
export async function ensureFamily(family) {
  if (!family || fontState.loadedFamilies.has(family) || isSystem(family)) return true;
  if (!isGoogle(family)) return false;
  if (fontState.downloading.has(family)) return false;
  fontState.downloading.add(family);
  emit('fonts:downloading', family);
  try {
    if (isTauri) {
      const added = await invoke('download_google_font', { family });
      fontState.app = fontState.app.filter((f) => f.family !== family).concat(added);
      await Promise.all(added.map(registerAppFont));
    } else {
      // Webbläsarläge: hämta CSS direkt från Google
      await new Promise((res) => {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
        l.onload = res; l.onerror = res;
        document.head.append(l);
      });
      await Promise.all(['400', '700'].map((w) => document.fonts.load(`${w} 40px "${family}"`).catch(() => {})));
      fontState.loadedFamilies.add(family);
    }
    return true;
  } catch (e) {
    emit('toast', { msg: `Kunde inte ladda ned ${family}: ${e.message || e}`, type: 'error' });
    return false;
  } finally {
    fontState.downloading.delete(family);
    fontsChanged();
  }
}

/** Ser till att fonten för ett textelement är laddad i rätt vikt. */
export async function ensureTextFont(el) {
  await ensureFamily(el.fontFamily);
  try { await document.fonts.load(`${el.italic ? 'italic ' : ''}${el.fontWeight} ${Math.min(el.fontSize, 200)}px "${el.fontFamily}"`); } catch { /* ignore */ }
}

export async function ensureDocFonts(els) {
  const fams = new Set();
  const walk = (list) => list.forEach((e) => { if (e.type === 'text') fams.add(e); if (e.type === 'group') walk(e.children); });
  walk(els);
  await Promise.all([...fams].map(ensureTextFont));
  fontsChanged();
}

/** Fontfamiljer som används i elementen men inte finns på datorn (sorterade). */
export function missingFamilies(els) {
  const fams = new Set();
  const walk = (list) => list.forEach((e) => { if (e.type === 'text') fams.add(e.fontFamily); if (e.type === 'group') walk(e.children); });
  walk(els);
  return [...fams].filter((f) => f && !isAvailable(f)).sort();
}

export function pushRecentFont(family) {
  fontState.recent = [family, ...fontState.recent.filter((f) => f !== family)].slice(0, 8);
  try { localStorage.setItem('motiv.recentFonts', JSON.stringify(fontState.recent)); } catch { /* ignore */ }
}

export async function addCustomFonts() {
  const paths = await pickFontPaths();
  if (!paths.length) return [];
  const added = await invoke('add_custom_fonts', { paths });
  fontState.app = fontState.app.filter((f) => !added.some((a) => a.family === f.family && a.weight === f.weight && a.style === f.style)).concat(added);
  await Promise.all(added.map(registerAppFont));
  fontsChanged();
  return added;
}

export async function removeAppFont(family) {
  await invoke('remove_app_font', { family });
  fontState.app = fontState.app.filter((f) => f.family !== family);
  fontsChanged();
}

/** @font-face-regler för SVG-export (bara app-fonter kan bäddas in). */
export function fontFaceCss(families) {
  let css = '';
  for (const [key, v] of fontState.bytes) {
    const [family, weight, style] = key.split('|');
    if (!families.has(family)) continue;
    const fmt = v.file.endsWith('.otf') ? 'opentype' : 'truetype';
    css += `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};src:url(data:font/${fmt === 'opentype' ? 'otf' : 'ttf'};base64,${v.b64}) format("${fmt}");}`;
  }
  return css;
}

/** Vikter som finns för en familj (för viktväljaren). */
export function weightsFor(family) {
  const app = fontState.app.filter((f) => f.family === family).map((f) => f.weight);
  if (app.length) return [...new Set(app)].sort((a, b) => a - b);
  return [300, 400, 500, 600, 700, 800, 900];
}
