# Motiv

En Canva-inspirerad editor för posters och bildredigering. Kärnan är skriven i
**Rust (Tauri 2)** och själva editorn (canvas och paneler) i ren JavaScript,
utan byggsteg.

## Kom igång (Windows)

1. Installera **Rust** från https://rustup.rs. Välj standardinstallationen;
   den installerar även *Visual Studio Build Tools* (MSVC) om de saknas.
2. Dubbelklicka på **`start.bat`**.
   Första bygget tar 5–15 minuter (AI-motorn och PDF-biblioteket kompileras).
   Efter det startar appen på några sekunder.

WebView2 finns redan i Windows 10/11.

**Installerare (.msi/.exe):** kör `bygg-installerare.bat`. Den installerar
Tauri CLI en gång och lägger installeraren i `src-tauri\target\release\bundle\`.

## Linux (.deb och AppImage)

Kör `./bygg-linux.sh` på Ubuntu/Debian, eller i WSL på Windows
(`wsl --install` som administratör, starta om, öppna sedan Ubuntu och gå till
projektmappen, t.ex. `cd /mnt/c/Users/<namn>/Documents/AI/Ediholio`).
Skriptet installerar systempaket, Rust och Tauri CLI vid behov och lägger
`.deb` och `.AppImage` i `dist/linux/`.

- **.deb**: `sudo apt install ./dist/linux/Motiv_*.deb`
- **AppImage**: `chmod +x Motiv_*.AppImage` och kör filen direkt, ingen installation.

## Funktioner

**Text**
- Redigera direkt på sidan (dubbelklick eller Enter) med riktig textmarkör,
  markering, IME och ångra
- **Rik text**: markera en del av texten och ge den egen färg, storlek, vikt,
  kursiv eller understrykning (panelen eller Ctrl+B/I/U)
- **Punktlistor och numrerade listor** med hängande indrag
- Fonter: alla systemfonter, ca 100 utvalda Google Fonts som laddas ned vid
  första användning och sedan fungerar offline, samt egna TTF/OTF-filer
- Kontur, ihålig text, skugga, glöd/neon, textplatta, gradientfyllning
- Böjd text (båge åt båda hållen) och vågtext
- Teckenavstånd, radavstånd, versaler, justering, fet/kursiv/understruken
- 12 färdiga textstilar

**Bilder**
- Uppladdning via knapp, dra och släpp från Utforskaren eller Ctrl+V
- Beskärning (dubbelklick), där sidhandtagen beskär som i Canva
- 12 filter plus reglage för ljusstyrka, kontrast, mättnad, värme, nyans,
  vinjett, oskärpa, gråskala, sepia och invertering
- Masker/former (cirkel, rundad, stjärna, hjärta, valv …), ram och skugga
- **Ta bort bakgrund med AI**, lokalt på datorn (U²-Net/IS-Net i Rust via
  tract). Modellen laddas ned första gången (5–170 MB beroende på kvalitet).
- Använd en bild som sidbakgrund
- **Fotoramar och bildrutnät**: ramar i olika former, polaroid och färdiga
  rutnät – släpp en bild på ramen så fyller och beskär den sig själv

**Design**
- 16 former, linjer och pilar, gradienter, kantlinjer (heldragen, streckad, prickad)
- **Ikoner**: drygt 170 sökbara ikoner (svenska och engelska sökord) från
  [Lucide](https://lucide.dev), i valfri färg och linjetjocklek
- **QR-koder** för länkar och text (även å, ä, ö), som vektor i alla exportformat
- **Verktygsrad vid markeringen** med de vanligaste valen: färg, textstorlek,
  fet/kursiv, justering, beskär, byt bild, duplicera, lås och ta bort
- **Kopiera stil** mellan element med penseln i verktygsraden eller Ctrl+Alt+C / Ctrl+Alt+V
- Lager: dra för att ändra ordning, dölj, lås, byt namn
- Opacitet och 16 blandningslägen
- **Färgpalett** för designen: spara färger, hämta dem från designen, och byt en
  palettfärg för att ändra den överallt i designen på en gång
- Gruppera, justera, fördela, spegla, rotera, fästlinjer (smart snapping)
- Redigera inuti grupper: dubbelklicka på en grupp för att ändra en del utan att dela upp den (Esc eller Klar för att lämna)
- Ångra/gör om (150 steg), kopiera/klistra, Alt+dra för att duplicera
- **Linjaler, hjälplinjer och marginal**: dra ut hjälplinjer från linjalerna (mm för
  tryckformat, annars px), ställ in en marginal – element fäster mot dem, och
  inget av det kommer med i en export
- Format för tryck (A-serien, affischer) och sociala medier, eller egen storlek
  i px/mm/cm/tum med valfri dpi
- **Flera sidor** per design: sidremsa med förhandsbilder, lägg till, duplicera,
  ta bort och dra för att ändra ordning; samma bakgrund på alla sidor med ett klick
- **Startsida** när appen öppnas: nya designer i vanliga format, senaste designer
  med förhandsbild och alla mallar (även via logotypen eller Arkiv → Startsida)
- **Sidor från en lista**: läs in en CSV- eller Excel-fil (eller klistra in från Excel) och
  få en sida per rad – namnskyltar, diplom, prislappar. Koppla kolumner till texter,
  QR-koder och bilder, eller skriv `{Kolumnnamn}` direkt i en text. För lång text krymps.
- 26 startmallar i fem kategorier, som kan ersätta designen eller läggas till som ny sida

**Export**
- PNG, JPG och WebP (0,5×–4×, genomskinlig bakgrund), en sida eller en fil per sida
- **Flera format på en gång**: t.ex. Instagram-inlägg, story och Facebook-omslag
  från samma design – innehållet skalas och centreras i varje format
- **PDF för tryck** med alla sidor i en fil, vektortext, utfall (bleed) och
  skärmärken, eller rastrerad PDF för exakt utseende
- SVG med inbäddade fonter (en sida)
- Projektfiler (`.motiv`; äldre `.ediholio`-filer går också att öppna) med allt redigerbart, plus autosparning

## Kortkommandon

| Kommando | Funktion |
|---|---|
| Ctrl+S / Ctrl+Shift+S | Spara / Spara som |
| Ctrl+O / Ctrl+N / Ctrl+E | Öppna / Ny / Exportera |
| Ctrl+Z / Ctrl+Y | Ångra / Gör om |
| Ctrl+C / X / V / D | Kopiera / Klipp ut / Klistra in / Duplicera |
| Ctrl+G / Ctrl+Shift+G | Gruppera / Dela upp |
| Ctrl+] / Ctrl+[ | Framåt / Bakåt (med Shift: längst fram/bak) |
| Ctrl+B / I / U | Fet / Kursiv / Understruken (hela texten eller den markerade delen) |
| Ctrl+Alt+C / Ctrl+Alt+V | Kopiera stil / Klistra in stil |
| Ctrl+L | Lås/lås upp |
| Shift+R | Visa/dölj linjaler |
| T / R / O / L | Ny text / rektangel / ellips / linje |
| Pilar (Shift = 10×) | Flytta markerat |
| Ctrl+Enter | Ny sida |
| Page Up / Page Down | Föregående / nästa sida |
| Mellanslag+dra, mitthjul | Panorera |
| Ctrl+hjul, Ctrl+0, Ctrl+1 | Zooma, anpassa, 100 % |
| Shift vid dra | Lås riktning / fri skalning |
| Alt vid skalning | Skala från mitten |
| Ctrl vid dra | Stäng av fästlinjer |

## Struktur

```
ui/                    Gränssnittet (laddas direkt av Tauri, inget byggsteg)
  index.html
  css/app.css
  js/
    main.js            Start, menyer, kortkommandon, fil, autosparning
    start.js           Startsidan
    bulk.js            Sidor från en lista (massproduktion)
    tabledata.js       Läser CSV och Excel-filer (.xlsx)
    pages.js           Sidor: sidremsan och sidåtgärder
    editor.js          Canvas: rendering, markering, transformering, text/krop
    state.js           Dokumentmodell, händelser, ångra/gör om
    render.js          Rendering (delas av editor och rasterexport)
    text.js            Textlayout, böjd text, effekter, markör och markering
    richtext.js        Formatering av delar av en text (el.runs)
    svgexport.js       SVG (även underlag för PDF)
    images.js          Bildcache, filter, masker
    shapes.js          Formgeometri
    paint.js           Färger och gradienter
    fonts.js           Fonthantering
    properties.js      Högerpanelen
    toolbar.js         Verktygsraden vid markeringen
    leftpanel.js       Vänsterpanelen (format, text, element, bilder, bakgrund, lager)
    templates.js       Startmallarna
    colorpicker.js / fontpicker.js / controls.js / dialogs.js / exporter.js / bgremoval.js
src-tauri/             Rust
  src/main.rs          Kommandon som gränssnittet anropar
  src/files.rs         Dialoger, filer, autosparning
  src/fonts.rs         Systemfonter, Google Fonts-nedladdning, egna fonter
  src/bgremove.rs      AI-bakgrundsborttagning (tract + ONNX)
  src/pdf.rs           SVG → vektor-PDF (usvg + svg2pdf)
```

Appens data (nedladdade fonter, AI-modeller, autosparning) ligger i
`%APPDATA%\se.micke.motiv`. Data från när appen hette Ediholio flyttas dit automatiskt vid första start.

## Utveckla gränssnittet i webbläsaren

Gränssnittet går att köra utan Rust för snabb iteration:

```
cd ui
python -m http.server 8000
```

Öppna http://localhost:8000. PDF, bakgrundsborttagning och systemfonter
kräver skrivbordsappen, men allt annat fungerar.

### Tester

Testerna kör appens egen kod (dokument, sidor, grupper, text, färger, mallar,
export) i en riktig webbläsare:

```
npm install
npx playwright install chromium
npm test
```

Med `MOTIV_BROWSER=msedge npm test` används Microsoft Edge i stället, utan att
något behöver laddas ned. Testerna går också att se i webbläsaren: starta
`python verktyg/mallbilder.py` och öppna http://localhost:8010/verktyg/tester.html.

### GitHub

`.github/workflows/bygg.yml` kör testerna vid varje push. Windows- och
Linux-paketen byggs bara när en versionstagg pushas (t.ex.
`git tag v0.4.0 && git push --tags`) eller när arbetsflödet startas för hand
under *Actions*. En versionstagg skapar en release med installationsfilerna och
`latest.json`.

### Automatiska uppdateringar

Skrivbordsappen letar efter nya versioner i den senaste releasen (`latest.json`)
strax efter start och via **Arkiv → Sök efter uppdateringar**. Uppdateringarna
är signerade; appen installerar bara filer som är signerade med projektets
nyckel.

- Nyckeln ligger i `%USERPROFILE%\.tauri\motiv-uppdatering.key` och får aldrig
  checkas in. **Gör en säkerhetskopia** – utan den kan redan installerade appar
  inte uppdateras.
- På GitHub ligger samma nyckel i hemligheten `TAURI_SIGNING_PRIVATE_KEY`
  (Settings → Secrets and variables → Actions). Byggen utan den misslyckas.
- Den publika nyckeln finns i `tauri.conf.json` (`plugins.updater.pubkey`).
- Repot måste vara publikt för att appen ska nå releaserna.
- Lokala byggen (`start.bat`, `bygg-installerare.bat`) signeras inte och
  behöver ingen nyckel.

### Ikoner

`ui/js/icondata.js` skapas av `verktyg/ikoner.mjs` ur Lucide. Ändra listan i
skriptet och kör:

```
npm install --no-save lucide@0.460.0
node verktyg/ikoner.mjs
```

QR-koderna görs med [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
(MIT), som ligger i `ui/js/vendor/`.

### Förhandsbilder för mallarna

Mallpanelen visar färdigrenderade bilder från `ui/img/mallar/`. När en mall
ändras eller läggs till tas bilderna fram igen med:

```
python verktyg/mallbilder.py
```

Öppna sedan http://localhost:8010/verktyg/mallbilder.html – alla mallar
renderas med appens egen kod och sparas automatiskt. En mall utan bild visas
med en enkel färgruta.
