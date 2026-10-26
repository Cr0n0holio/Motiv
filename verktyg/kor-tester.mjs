// Kör testerna i verktyg/tester.html i en riktig webbläsare (Playwright) och
// avslutar med felkod om något test misslyckas. Används av `npm test` och
// av GitHub-arbetsflödet.
//
//   npm install
//   npx playwright install chromium
//   npm test
//
// MOTIV_BROWSER=msedge använder Microsoft Edge i stället för Playwrights Chromium.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json' };

// En enkel statisk server för projektmappen
const server = http.createServer(async (req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/verktyg/tester.html`;

const browser = await chromium.launch(process.env.MOTIV_BROWSER ? { channel: process.env.MOTIV_BROWSER } : {});
let exitCode = 1;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('Sidfel:', e.message));
  await page.goto(url);
  const r = await page.waitForFunction(() => window.__resultat, null, { timeout: 120000 }).then((h) => h.jsonValue());
  for (const f of r.fel) console.error(`✗ ${f.test}\n    ${f.fel}`);
  console.log(`${r.passed} lyckades, ${r.failed} misslyckades`);
  exitCode = r.failed ? 1 : 0;
} catch (e) {
  console.error('Testerna kunde inte köras:', e.message);
} finally {
  await browser.close();
  server.close();
}
process.exit(exitCode);
