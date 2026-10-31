// Skapar latest.json, som appens uppdateringsfunktion läser för att se om det
// finns en ny version och var den ska hämtas.
//
//   node verktyg/latest-json.mjs <mapp med paket> <tagg, t.ex. v0.4.0> <ägare/repo>
//
// Varje installationsfil som har en signatur (.sig, skapad av Tauri med
// signeringsnyckeln) blir en post. Windows uppdateras med NSIS-installeraren,
// Linux med AppImage; de används också som standard för respektive system.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const [dir, tag, repo] = process.argv.slice(2);
if (!dir || !tag || !repo) {
  console.error('Användning: node verktyg/latest-json.mjs <mapp> <tagg> <ägare/repo>');
  process.exit(1);
}

async function filesIn(d) {
  const out = [];
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) out.push(...(await filesIn(p)));
    else out.push(p);
  }
  return out;
}

const KINDS = [
  { test: (f) => f.endsWith('-setup.exe'), os: 'windows', installer: 'nsis', standard: true },
  { test: (f) => f.endsWith('.msi'), os: 'windows', installer: 'msi' },
  { test: (f) => f.endsWith('.AppImage'), os: 'linux', installer: 'appimage', standard: true },
  { test: (f) => f.endsWith('.deb'), os: 'linux', installer: 'deb' },
];

const files = await filesIn(dir);
const platforms = {};
for (const f of files) {
  const kind = KINDS.find((k) => k.test(f));
  if (!kind || !files.includes(`${f}.sig`)) continue;
  const entry = {
    signature: (await readFile(`${f}.sig`, 'utf8')).trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(basename(f))}`,
  };
  platforms[`${kind.os}-x86_64-${kind.installer}`] = entry;
  if (kind.standard) platforms[`${kind.os}-x86_64`] = entry;
}

if (!Object.keys(platforms).length) {
  console.error('Hittade inga signerade paket (.sig). Är hemligheten TAURI_SIGNING_PRIVATE_KEY satt?');
  process.exit(1);
}

const latest = {
  version: tag.replace(/^v/, ''),
  notes: `Motiv ${tag}`,
  pub_date: new Date().toISOString(),
  platforms,
};
await writeFile(join(dir, 'latest.json'), JSON.stringify(latest, null, 2));
console.log(`latest.json: ${Object.keys(platforms).join(', ')}`);
