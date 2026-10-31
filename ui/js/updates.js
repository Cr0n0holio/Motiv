// Automatiska uppdateringar (bara i skrivbordsappen). Appen läser latest.json
// från den senaste GitHub-releasen; finns en nyare, signerad version erbjuds
// den i en notis. Installationen startar om appen.
import { h } from './util.js';
import { isTauri } from './bridge.js';
import { state } from './state.js';
import { toast, modal } from './dialogs.js';

const T = window.__TAURI__;
const available = () => isTauri && T?.updater?.check;

let saveFirst = async () => true;
let busy = false;

/** save: funktion som sparar designen och returnerar true om det gick. */
export function initUpdates({ save }) {
  saveFirst = save;
  // Kolla i lugn och ro en stund efter start, utan att störa om inget finns
  if (available()) setTimeout(() => checkForUpdates(false), 6000);
}

/** manual: visa även "du har senaste versionen" och fel. */
export async function checkForUpdates(manual = true) {
  if (!available()) {
    if (manual) toast('Uppdateringar finns bara i skrivbordsappen', 'info');
    return;
  }
  if (busy) return;
  busy = true;
  try {
    const update = await T.updater.check();
    if (!update) {
      if (manual) toast('Du har den senaste versionen av Motiv', 'ok');
      return;
    }
    toast(`Motiv ${update.version} finns att hämta`, 'info', {
      timeout: 0,
      action: { label: 'Uppdatera', onClick: () => install(update) },
    });
  } catch (e) {
    if (manual) toast(`Kunde inte söka efter uppdateringar: ${e.message || e}`, 'error');
    else console.warn('Uppdateringskontroll misslyckades', e);
  } finally {
    busy = false;
  }
}

async function install(update) {
  if (state.dirty && !(await askSave())) return;
  const bar = h('div', { class: 'bar' });
  const text = h('span', { class: 'ptext' }, 'Laddar ned…');
  const dlg = modal({
    title: `Uppdaterar till Motiv ${update.version}`,
    body: h('div', null,
      h('div', { class: 'progress' }, bar, text),
      h('p', { class: 'muted small' }, 'Motiv startar om när uppdateringen är installerad.')),
  });
  try {
    let total = 0, done = 0;
    await update.downloadAndInstall((ev) => {
      if (ev.event === 'Started') total = ev.data.contentLength || 0;
      if (ev.event === 'Progress') {
        done += ev.data.chunkLength;
        if (total) { bar.style.width = `${(done / total) * 100}%`; text.textContent = `Laddar ned… ${Math.round((done / total) * 100)} %`; }
      }
      if (ev.event === 'Finished') text.textContent = 'Installerar…';
    });
    // På Windows avslutar installeraren appen själv; annars startas den om här
    await T.process.relaunch();
  } catch (e) {
    dlg.close();
    toast(`Uppdateringen misslyckades: ${e.message || e}`, 'error', { timeout: 0 });
  }
}

/** Fråga om osparade ändringar ska sparas innan appen startar om. */
function askSave() {
  return new Promise((resolve) => {
    let answer = false;
    modal({
      title: 'Spara innan uppdateringen?',
      body: h('p', null, 'Motiv startar om för att uppdateras. Vill du spara designen först?'),
      onClose: () => resolve(answer),
      actions: [
        { label: 'Avbryt' },
        { label: 'Uppdatera utan att spara', danger: true, onClick: () => { answer = true; } },
        { label: 'Spara och uppdatera', primary: true, onClick: async () => { answer = await saveFirst(); return answer ? true : false; } },
      ],
    });
  });
}
