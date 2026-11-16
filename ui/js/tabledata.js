// Läser in tabeller för massproduktion: CSV, text inklistrad från Excel
// (tabbseparerad) och Excel-filer (.xlsx). Allt blir rader av strängar.
// En .xlsx-fil är ett zip-arkiv med XML; den packas upp här med
// webbläsarens egen DecompressionStream, utan externa bibliotek.

// ---------- CSV och inklistrad text ----------

/** Gissar avgränsaren utifrån första raden: tabb, semikolon eller komma (utanför citattecken). */
function detectDelimiter(text) {
  const count = { '\t': 0, ';': 0, ',': 0 };
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && c in count) count[c]++;
  }
  if (count['\t']) return '\t';
  return count[';'] >= count[','] && count[';'] ? ';' : ',';
}

/** Avgränsad text → rader. Hanterar citattecken, radbrytningar i celler och BOM. */
export function parseDelimited(text, delimiter = null) {
  text = String(text).replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return tidy(rows);
}

/** Tar bort tomma rader och gör alla rader lika långa. */
function tidy(rows) {
  rows = rows.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some((c) => c !== ''));
  const n = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(n - r.length).fill('')]);
}

/** CSV-fil som byte: UTF-8 om det är giltigt, annars Windows-1252 (som Excel sparar på svenska datorer). */
export function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}

// ---------- Excel (.xlsx) ----------

/** Filerna i ett zip-arkiv: { namn: () => Promise<Uint8Array> }. */
function zipEntries(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Filen är inte en giltig Excel-fil');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = {};
  for (let i = 0; i < count && v.getUint32(p, true) === 0x02014b50; i++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    out[name] = async () => {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method !== 8 || typeof DecompressionStream !== 'function') throw new Error('Excel-filen kan inte packas upp här – spara den som CSV i stället');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
/** Är talformatet ett datum eller en tid? (bokstäverna d, m, y, h, s utanför citat och hakparenteser) */
const isDateFormat = (code) => /[dmyhs]/i.test(String(code).replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));

/** Excels datumnummer → "2026-05-17" (med klockslag om det finns ett). */
function excelDate(n) {
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(n);
  const iso = d.toISOString();
  const time = iso.slice(11, 16);
  if (n < 1) return time;
  return time === '00:00' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${time}`;
}

const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/[^A-Z]/gi, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** Första bladet i en .xlsx-fil → rader av strängar. */
export async function parseXlsx(bytes) {
  const files = zipEntries(bytes);
  const xml = async (name) => (files[name] ? new DOMParser().parseFromString(new TextDecoder().decode(await files[name]()), 'application/xml') : null);
  const tags = (node, name) => [...node.getElementsByTagName(name)];

  // Vilken fil är första bladet?
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await xml('xl/workbook.xml'), rels = await xml('xl/_rels/workbook.xml.rels');
  const firstSheet = wb && tags(wb, 'sheet')[0];
  const rid = firstSheet?.getAttribute('r:id') || firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const rel = rid && rels && tags(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid);
  if (rel) { const t = rel.getAttribute('Target'); sheetPath = t.startsWith('/') ? t.slice(1) : `xl/${t}`; }
  const sheet = await xml(sheetPath);
  if (!sheet) throw new Error('Hittade inget blad i Excel-filen');

  // Delade strängar (formaterad text ligger i flera <t>; fonetisk text hoppas över)
  const sst = await xml('xl/sharedStrings.xml');
  const text = (node) => tags(node, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join('');
  const strings = sst ? tags(sst, 'si').map(text) : [];

  // Vilka cellformat är datum?
  const styles = await xml('xl/styles.xml');
  const custom = new Map(styles ? tags(styles, 'numFmt').map((f) => [+f.getAttribute('numFmtId'), f.getAttribute('formatCode')]) : []);
  const cellXfs = styles && tags(styles, 'cellXfs')[0];
  const dateStyle = cellXfs ? tags(cellXfs, 'xf').map((x) => { const id = +x.getAttribute('numFmtId'); return BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id))); }) : [];

  const rows = [];
  for (const r of tags(sheet, 'row')) {
    const row = [];
    let next = 0;
    for (const c of tags(r, 'c')) {
      const ref = c.getAttribute('r');
      const col = ref ? colIndex(ref) : next;
      next = col + 1;
      const t = c.getAttribute('t'), v = tags(c, 'v')[0]?.textContent ?? '';
      let val;
      if (t === 's') val = strings[+v] ?? '';
      else if (t === 'inlineStr') val = text(c);
      else if (t === 'b') val = v === '1' ? 'Ja' : 'Nej';
      else if (t === 'str' || t === 'e') val = v;
      else if (v === '') val = '';
      else if (dateStyle[+c.getAttribute('s')]) val = excelDate(+v);
      else val = String(+(+v).toPrecision(15)); // 0.30000000000000004 → 0.3
      row[col] = val;
    }
    const idx = +r.getAttribute('r') - 1;
    rows[Number.isInteger(idx) && idx >= rows.length ? idx : rows.length] = Array.from(row, (x) => x ?? '');
  }
  return tidy(Array.from(rows, (r) => r || []));
}

/** Läser en tabellfil utifrån filnamnet. */
export async function parseTableFile(name, bytes) {
  if (/\.xlsx$/i.test(name)) return parseXlsx(bytes);
  if (/\.xls$/i.test(name)) throw new Error('Gamla Excel-filer (.xls) stöds inte – spara som .xlsx eller CSV');
  return parseDelimited(decodeText(bytes));
}
