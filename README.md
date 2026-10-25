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

**Design**
- 16 former, linjer och pilar, gradienter, kantlinjer (heldragen, streckad, prickad)
- Lager: dra för att ändra ordning, dölj, lås, byt namn
- Opacitet och 16 blandningslägen
- Gruppera, justera, fördela, spegla, rotera, fästlinjer (smart snapping)
- Ångra/gör om (150 steg), kopiera/klistra, Alt+dra för att duplicera
- Format för tryck (A-serien, affischer) och sociala medier, eller egen storlek
  i px/mm/cm/tum med valfri dpi
- 4 startmallar

**Export**
- PNG, JPG och WebP (0,5×–4×, genomskinlig bakgrund)
- **PDF för tryck** med vektortext, utfall (bleed) och skärmärken, eller
  rastrerad PDF för exakt utseende
- SVG med inbäddade fonter
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
| Ctrl+B / I / U | Fet / Kursiv / Understruken (text) |
| Ctrl+L | Lås/lås upp |
| T / R / O / L | Ny text / rektangel / ellips / linje |
| Pilar (Shift = 10×) | Flytta markerat |
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
    editor.js          Canvas: rendering, markering, transformering, text/krop
    state.js           Dokumentmodell, händelser, ångra/gör om
    render.js          Rendering (delas av editor och rasterexport)
    text.js            Textlayout, böjd text, effekter
    svgexport.js       SVG (även underlag för PDF)
    images.js          Bildcache, filter, masker
    shapes.js          Formgeometri
    paint.js           Färger och gradienter
    fonts.js           Fonthantering
    properties.js      Högerpanelen
    leftpanel.js       Vänsterpanelen (format, text, element, bilder, bakgrund, lager)
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
