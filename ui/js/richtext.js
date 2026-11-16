// Rik text: delar av en textruta kan ha egen färg, vikt, storlek, kursiv och
// understrykning. Formateringen ligger i el.runs som en lista av stycken i
// teckenordning: [{ n: antal tecken, color?, weight?, italic?, underline?, size? }].
// En egenskap som saknas ärvs från textrutan; size är en faktor av rutans
// fontSize, så att hela rutan kan skalas utan att förhållandena ändras.
// Utan el.runs är hela texten enhetlig.

export const RUN_KEYS = ['color', 'weight', 'italic', 'underline', 'size'];

const styleOf = (r) => {
  const s = {};
  for (const k of RUN_KEYS) if (r[k] !== undefined && r[k] !== null) s[k] = r[k];
  return s;
};
const same = (a, b) => RUN_KEYS.every((k) => a[k] === b[k]);
const plain = (r) => RUN_KEYS.every((k) => r[k] === undefined);

/** Styckena så att de täcker exakt hela texten (tål trasig eller saknad data). */
export function getRuns(el) {
  const len = el.text.length;
  const out = [];
  let sum = 0;
  for (const r of Array.isArray(el.runs) ? el.runs : []) {
    if (sum >= len) break;
    const n = Math.min(Math.max(0, r.n | 0), len - sum);
    if (n > 0) { out.push({ ...styleOf(r), n }); sum += n; }
  }
  if (sum < len) out.push({ n: len - sum });
  return out;
}

/** Sparar styckena: slår ihop lika grannar och tar bort listan om inget avviker. */
export function setRuns(el, runs) {
  const out = [];
  for (const r of runs) {
    if (!r.n) continue;
    const last = out[out.length - 1];
    if (last && same(last, r)) last.n += r.n; else out.push({ ...styleOf(r), n: r.n });
  }
  if (out.every(plain)) delete el.runs; else el.runs = out;
}

/** Styckena som täcker teckenintervallet [a, b). */
function sliceRuns(runs, a, b) {
  const out = [];
  let p = 0;
  for (const r of runs) {
    const s = Math.max(a, p), e = Math.min(b, p + r.n);
    if (e > s) out.push({ ...r, n: e - s });
    p += r.n;
  }
  return out;
}

/** Formateringen för tecknet på plats i ({} = som textrutan). */
export function styleAt(el, i) {
  let p = 0;
  for (const r of getRuns(el)) {
    if (i < p + r.n) return styleOf(r);
    p += r.n;
  }
  return {};
}

/** Ändrar formateringen i [a, b). Värdet null tar bort egenskapen (ärver igen). */
export function setRange(el, a, b, patch) {
  const len = el.text.length;
  a = Math.max(0, Math.min(a, len)); b = Math.max(a, Math.min(b, len));
  if (a === b) return;
  const runs = getRuns(el);
  const mid = sliceRuns(runs, a, b).map((r) => {
    const o = { ...r };
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined) delete o[k]; else o[k] = v; }
    return o;
  });
  setRuns(el, [...sliceRuns(runs, 0, a), ...mid, ...sliceRuns(runs, b, len)]);
}

/** Tar bort en egenskap ur alla stycken, så att textrutans eget värde gäller överallt. */
export function clearRunProp(el, key) {
  if (!el.runs) return;
  setRuns(el, getRuns(el).map((r) => { const o = { ...r }; delete o[key]; return o; }));
}

/**
 * Byter textrutans text och flyttar med formateringen. caret är markörens
 * plats efter ändringen (allt efter den är oförändrat), vilket gör att rätt
 * ställe hittas även när samma tecken upprepas. Ny text får samma
 * formatering som texten den ersätter eller står efter.
 */
export function replaceText(el, neu, caret = null) {
  const old = el.text;
  if (!el.runs) { el.text = neu; return; }
  const max = Math.min(old.length, neu.length);
  let s = 0;
  if (caret !== null) {
    const want = neu.length - caret;
    if (want >= 0 && want <= max && old.slice(old.length - want) === neu.slice(caret)) s = want; else caret = null;
  }
  if (caret === null) while (s < max && old[old.length - 1 - s] === neu[neu.length - 1 - s]) s++;
  let p = 0;
  while (p < max - s && old[p] === neu[p]) p++;
  const del = old.length - p - s, ins = neu.length - p - s;
  const st = del > 0 ? styleAt(el, p) : styleAt(el, p > 0 ? p - 1 : 0);
  const runs = getRuns(el);
  el.text = neu;
  setRuns(el, [...sliceRuns(runs, 0, p), { ...st, n: ins }, ...sliceRuns(runs, p + del, old.length)]);
}
