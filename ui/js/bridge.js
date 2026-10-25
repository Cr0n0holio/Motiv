// Brygga mot Rust (Tauri). Har reservlösningar så att gränssnittet även
// går att köra i en vanlig webbläsare under utveckling.
import { blobToDataURL, dataURLToBase64, mimeFromExt } from './util.js';

const T = window.__TAURI__;
export const isTauri = !!(T && T.core && T.core.invoke);

export function invoke(cmd, args = {}) {
  if (!isTauri) return Promise.reject(new Error('Den här funktionen kräver skrivbordsappen'));
  return T.core.invoke(cmd, args);
}

export async function listen(evt, cb) {
  if (!isTauri || !T.event) return () => {};
  return T.event.listen(evt, (e) => cb(e.payload));
}

/** Sparar en Blob. Returnerar sökvägen (eller filnamnet i webbläsaren), null om avbrutet. */
export async function saveBlob(blob, defaultName, filters) {
  if (isTauri) {
    const path = await invoke('save_file_dialog', { defaultName, filters });
    if (!path) return null;
    const data = dataURLToBase64(await blobToDataURL(blob));
    await invoke('write_binary_file', { path, data });
    return path;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return defaultName;
}

/** Sparar text. Om path anges skrivs filen direkt utan dialog. */
export async function saveText(text, defaultName, filters, path = null) {
  if (isTauri) {
    if (!path) path = await invoke('save_file_dialog', { defaultName, filters });
    if (!path) return null;
    await invoke('write_text_file', { path, contents: text });
    return path;
  }
  return saveBlob(new Blob([text], { type: 'application/json' }), defaultName, filters);
}

function browserPick(accept, multiple) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = () => resolve([...inp.files]);
    inp.addEventListener('cancel', () => resolve([]));
    inp.click();
  });
}

/** Öppnar textfil. Returnerar { name, path, text } eller null. */
export async function openText(filters) {
  if (isTauri) {
    const [path] = await invoke('open_file_dialog', { filters, multiple: false });
    if (!path) return null;
    const text = await invoke('read_text_file', { path });
    return { name: path.split(/[\\/]/).pop(), path, text };
  }
  const accept = filters.flatMap((f) => f.extensions.map((e) => '.' + e)).join(',');
  const [file] = await browserPick(accept, false);
  if (!file) return null;
  return { name: file.name, path: null, text: await file.text() };
}

/** Väljer bilder. Returnerar [{ name, dataURL }]. */
export async function pickImages() {
  if (isTauri) {
    const paths = await invoke('open_file_dialog', {
      filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif'] }],
      multiple: true,
    });
    const out = [];
    for (const p of paths) {
      const f = await invoke('read_binary_file', { path: p });
      out.push({ name: f.name, dataURL: `data:${mimeFromExt(f.name)};base64,${f.data}` });
    }
    return out;
  }
  const files = await browserPick('image/*', true);
  return Promise.all(files.map(async (f) => ({ name: f.name, dataURL: await blobToDataURL(f) })));
}

/** Väljer fontfiler (endast skrivbordsappen). */
export async function pickFontPaths() {
  return invoke('open_file_dialog', { filters: [{ name: 'Fonter', extensions: ['ttf', 'otf'] }], multiple: true });
}
