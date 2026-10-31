// Skapar ui/js/icondata.js med de ikoner som finns i Motiv, hämtade ur
// ikonbiblioteket Lucide (ISC-licens). Varje ikon blir en lista med
// SVG-sökvägar i ett 24×24-rutnät, så att appen inte behöver Lucide i sig.
//
//   npm install --no-save lucide@0.460.0
//   node verktyg/ikoner.mjs
//
// Lägg till eller ta bort ikoner i listan nedan: [lucide-namn, svensk etikett, sökord].
import { writeFile } from 'node:fs/promises';

const { icons } = await import('lucide');

const LIST = [
  // Kontakt och webb
  ['phone', 'Telefon', 'ring samtal'], ['mail', 'E-post', 'brev mejl'], ['message-circle', 'Meddelande', 'chatt prata'],
  ['map-pin', 'Plats', 'adress karta'], ['globe', 'Webb', 'internet värld'], ['link', 'Länk', 'url'], ['at-sign', 'Snabel-a', 'e-post'],
  ['send', 'Skicka', 'papperflygplan'], ['share-2', 'Dela', ''], ['wifi', 'Wifi', 'internet'], ['qr-code', 'QR-kod', 'skanna'],
  ['instagram', 'Instagram', 'sociala medier'], ['facebook', 'Facebook', 'sociala medier'], ['youtube', 'YouTube', 'video'], ['linkedin', 'LinkedIn', 'jobb'],
  // Tid
  ['calendar', 'Kalender', 'datum'], ['calendar-heart', 'Kalender med hjärta', 'datum bröllop'], ['clock', 'Klocka', 'tid'],
  ['alarm-clock', 'Väckarklocka', 'tid'], ['hourglass', 'Timglas', 'tid väntan'], ['timer', 'Timer', 'tid'],
  // Människor och känslor
  ['user', 'Person', 'människa'], ['users', 'Personer', 'grupp människor'], ['baby', 'Bebis', 'barn'], ['smile', 'Glad', 'leende'],
  ['laugh', 'Skratt', 'glad'], ['frown', 'Ledsen', ''], ['thumbs-up', 'Tumme upp', 'gilla'], ['handshake', 'Handslag', 'avtal'],
  ['hand-heart', 'Hand med hjärta', 'omtanke'], ['heart', 'Hjärta', 'kärlek'], ['heart-handshake', 'Samarbete', 'hjärta'],
  // Fest
  ['party-popper', 'Fest', 'kalas firande'], ['cake', 'Tårta', 'födelsedag kalas'], ['gift', 'Present', 'paket'],
  ['star', 'Stjärna', ''], ['sparkles', 'Gnistor', 'glitter magi'], ['crown', 'Krona', 'kung drottning'], ['trophy', 'Pokal', 'vinnare'],
  ['medal', 'Medalj', 'vinnare'], ['award', 'Utmärkelse', 'pris'], ['music', 'Musik', 'not'],
  ['wine', 'Vin', 'glas dryck'], ['beer', 'Öl', 'dryck'], ['martini', 'Drink', 'cocktail'],
  // Mat
  ['coffee', 'Kaffe', 'kopp fika'], ['cup-soda', 'Läsk', 'dryck'], ['utensils', 'Bestick', 'mat restaurang'], ['chef-hat', 'Kockmössa', 'mat'],
  ['pizza', 'Pizza', 'mat'], ['sandwich', 'Smörgås', 'mat'], ['salad', 'Sallad', 'mat'], ['soup', 'Soppa', 'mat'], ['fish', 'Fisk', 'mat djur'],
  ['egg', 'Ägg', 'mat påsk'], ['apple', 'Äpple', 'frukt'], ['cherry', 'Körsbär', 'frukt'], ['carrot', 'Morot', 'grönsak'],
  ['croissant', 'Croissant', 'bröd fika'], ['cookie', 'Kaka', 'fika'], ['ice-cream-cone', 'Glass', 'sommar'], ['candy', 'Godis', ''],
  // Natur och väder
  ['sun', 'Sol', 'sommar väder'], ['moon', 'Måne', 'natt'], ['cloud', 'Moln', 'väder'], ['cloud-rain', 'Regn', 'väder'],
  ['snowflake', 'Snöflinga', 'vinter jul'], ['umbrella', 'Paraply', 'regn'], ['rainbow', 'Regnbåge', ''], ['zap', 'Blixt', 'energi'],
  ['flame', 'Eld', 'brasa'], ['leaf', 'Löv', 'höst natur'], ['sprout', 'Grodd', 'växt'], ['flower', 'Blomma', 'vår'], ['flower-2', 'Solros', 'blomma'],
  ['tree-pine', 'Gran', 'jul skog'], ['tree-deciduous', 'Träd', 'skog'], ['mountain', 'Berg', 'natur'], ['waves', 'Vågor', 'hav vatten'],
  ['bird', 'Fågel', 'djur'], ['cat', 'Katt', 'djur'], ['dog', 'Hund', 'djur'], ['rabbit', 'Kanin', 'djur påsk'], ['paw-print', 'Tass', 'djur'],
  // Platser och resor
  ['house', 'Hus', 'hem'], ['building-2', 'Byggnad', 'kontor'], ['store', 'Butik', 'affär'], ['school', 'Skola', ''], ['church', 'Kyrka', ''],
  ['tent', 'Tält', 'camping'], ['car', 'Bil', 'resa'], ['bus', 'Buss', 'resa'], ['bike', 'Cykel', ''], ['plane', 'Flygplan', 'resa'],
  ['train-front', 'Tåg', 'resa'], ['ship', 'Båt', 'resa hav'], ['sailboat', 'Segelbåt', 'hav'], ['anchor', 'Ankare', 'hav'],
  ['map', 'Karta', ''], ['compass', 'Kompass', ''], ['luggage', 'Resväska', 'resa'], ['flag', 'Flagga', ''], ['parking-meter', 'Parkering', ''],
  // Handel och arbete
  ['shopping-cart', 'Kundvagn', 'handla'], ['shopping-bag', 'Kasse', 'handla'], ['tag', 'Prislapp', 'rea pris'], ['percent', 'Procent', 'rea'],
  ['badge-percent', 'Rea', 'procent'], ['credit-card', 'Betalkort', 'betala'], ['wallet', 'Plånbok', 'pengar'], ['banknote', 'Sedel', 'pengar'],
  ['briefcase', 'Portfölj', 'jobb'], ['chart-column', 'Stapeldiagram', 'statistik'], ['chart-pie', 'Cirkeldiagram', 'statistik'],
  ['trending-up', 'Uppåt', 'tillväxt'], ['target', 'Mål', 'sikte'], ['lightbulb', 'Glödlampa', 'idé'], ['rocket', 'Raket', 'lansering'],
  ['key', 'Nyckel', ''], ['lock', 'Lås', 'säker'], ['shield-check', 'Sköld', 'säker trygg'], ['badge-check', 'Godkänd', 'verifierad'],
  ['ticket', 'Biljett', 'evenemang'], ['receipt', 'Kvitto', ''], ['clipboard-list', 'Lista', 'att göra'], ['calendar-check', 'Bokad', 'datum'],
  // Media och skapande
  ['camera', 'Kamera', 'foto'], ['image', 'Bild', 'foto'], ['video', 'Video', 'film'], ['film', 'Film', 'bio'], ['headphones', 'Hörlurar', 'musik'],
  ['mic', 'Mikrofon', 'podd'], ['palette', 'Palett', 'konst färg'], ['brush', 'Pensel', 'måla'], ['pencil', 'Penna', 'skriva'],
  ['scissors', 'Sax', 'klippa'], ['book-open', 'Bok', 'läsa'], ['graduation-cap', 'Studentmössa', 'skola examen'], ['gamepad-2', 'Spel', 'tv-spel'],
  ['tv', 'Tv', ''], ['printer', 'Skrivare', 'utskrift'], ['newspaper', 'Tidning', 'nyheter'],
  // Hälsa och sport
  ['dumbbell', 'Hantel', 'träning gym'], ['activity', 'Puls', 'träning'], ['heart-pulse', 'Hälsa', 'puls'], ['footprints', 'Fotspår', 'promenad'],
  ['volleyball', 'Boll', 'sport'], ['stethoscope', 'Stetoskop', 'vård läkare'], ['pill', 'Piller', 'medicin'], ['accessibility', 'Tillgänglighet', 'rullstol'],
  // Symboler
  ['check', 'Bock', 'klar'], ['circle-check', 'Bock i cirkel', 'klar'], ['x', 'Kryss', 'stäng'], ['plus', 'Plus', ''], ['minus', 'Minus', ''],
  ['arrow-right', 'Pil höger', ''], ['arrow-left', 'Pil vänster', ''], ['arrow-up', 'Pil upp', ''], ['arrow-down', 'Pil ned', ''],
  ['chevron-right', 'Vinkel höger', 'pil'], ['circle-alert', 'Varning', 'obs'], ['info', 'Info', 'information'], ['circle-help', 'Fråga', 'hjälp'],
  ['bell', 'Ringklocka', 'notis'], ['search', 'Sök', 'förstoringsglas'], ['settings', 'Inställningar', 'kugghjul'], ['download', 'Ladda ned', ''],
  ['eye', 'Öga', 'se'], ['recycle', 'Återvinning', 'miljö'], ['quote', 'Citat', 'citattecken'], ['hash', 'Hashtag', ''], ['infinity', 'Oändlighet', ''],
];

const num = (v) => +(+v).toFixed(3);
function toPath(tag, a) {
  switch (tag) {
    case 'path': return a.d;
    case 'circle': { const { cx, cy, r } = a; return `M${num(cx - r)} ${num(cy)}a${num(r)} ${num(r)} 0 1 0 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-2 * r)} 0`; }
    case 'ellipse': { const { cx, cy, rx, ry } = a; return `M${num(cx - rx)} ${num(cy)}a${num(rx)} ${num(ry)} 0 1 0 ${num(2 * rx)} 0a${num(rx)} ${num(ry)} 0 1 0 ${num(-2 * rx)} 0`; }
    case 'line': return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
    case 'polyline':
    case 'polygon': {
      const p = String(a.points).trim().split(/[\s,]+/).map(Number);
      let d = `M${num(p[0])} ${num(p[1])}`;
      for (let i = 2; i < p.length; i += 2) d += `L${num(p[i])} ${num(p[i + 1])}`;
      return tag === 'polygon' ? d + 'Z' : d;
    }
    case 'rect': {
      const x = +a.x || 0, y = +a.y || 0, w = +a.width, h = +a.height;
      const r = Math.min(+(a.rx ?? a.ry ?? 0), w / 2, h / 2);
      if (!r) return `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}Z`;
      return `M${num(x + r)} ${num(y)}h${num(w - 2 * r)}a${num(r)} ${num(r)} 0 0 1 ${num(r)} ${num(r)}v${num(h - 2 * r)}a${num(r)} ${num(r)} 0 0 1 ${num(-r)} ${num(r)}h${num(-(w - 2 * r))}a${num(r)} ${num(r)} 0 0 1 ${num(-r)} ${num(-r)}v${num(-(h - 2 * r))}a${num(r)} ${num(r)} 0 0 1 ${num(r)} ${num(-r)}Z`;
    }
    default: throw new Error(`Okänd SVG-tagg: ${tag}`);
  }
}

const pascal = (s) => s.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
const out = [];
const missing = [];
for (const [id, label, kw] of LIST) {
  const node = icons[pascal(id)];
  if (!node) { missing.push(id); continue; }
  const children = node[0] === 'svg' ? node[2] : node; // äldre och nyare Lucide-format
  out.push({ id, label, kw, d: children.map(([tag, attrs]) => toPath(tag, attrs)) });
}
if (missing.length) console.warn('Saknas i Lucide:', missing.join(', '));

const js = `// Genererad av verktyg/ikoner.mjs – ändra inte för hand.
// Ikonerna kommer från Lucide (https://lucide.dev), ISC-licens:
// Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part
// of Feather (MIT). All other copyright (c) for Lucide are held by Lucide
// Contributors 2022. Permission to use, copy, modify, and/or distribute this
// software for any purpose with or without fee is hereby granted, provided that
// the above copyright notice and this permission notice appear in all copies.
//
// Varje ikon: { id, label (svenska), kw (sökord), d: [SVG-sökvägar i 24×24] }.
export const ICON_LIST = ${JSON.stringify(out)};
`;
await writeFile(new URL('../ui/js/icondata.js', import.meta.url), js);
console.log(`${out.length} ikoner skrivna till ui/js/icondata.js`);
