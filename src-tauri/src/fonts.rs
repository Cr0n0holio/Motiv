//! Fonthantering: systemfonter, Google Fonts (laddas ned och cachas lokalt)
//! och egna fontfiler. Alla app-fonter ligger i <appdata>/fonts och listas
//! i fonts.json så att gränssnittet kan registrera dem vid start och så att
//! PDF-exporten hittar samma filer.

use crate::util::{app_subdir, err, safe_name};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use svg2pdf::usvg::fontdb;
use tauri::AppHandle;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppFont {
    pub family: String,
    pub weight: u16,
    /// "normal" eller "italic"
    pub style: String,
    /// Filnamn relativt fonts-mappen
    pub file: String,
    /// "google" eller "custom"
    pub source: String,
}

pub fn fonts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app_subdir(app, "fonts")
}

fn manifest_path(dir: &Path) -> PathBuf {
    dir.join("fonts.json")
}

fn read_manifest(dir: &Path) -> Vec<AppFont> {
    std::fs::read_to_string(manifest_path(dir))
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<AppFont>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|f| dir.join(&f.file).exists())
        .collect()
}

fn write_manifest(dir: &Path, list: &[AppFont]) -> Result<(), String> {
    let s = serde_json::to_string_pretty(list).map_err(err)?;
    std::fs::write(manifest_path(dir), s).map_err(err)
}

fn upsert(list: &mut Vec<AppFont>, f: AppFont) {
    list.retain(|x| !(x.family == f.family && x.weight == f.weight && x.style == f.style));
    list.push(f);
}

/// Alla installerade systemfonter (familjenamn, sorterade, unika).
#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut set = BTreeSet::new();
        for face in db.faces() {
            if let Some((name, _)) = face.families.first() {
                let n = name.trim();
                if !n.is_empty() && !n.starts_with('.') {
                    set.insert(n.to_string());
                }
            }
        }
        set.into_iter().collect::<Vec<String>>()
    })
    .await
    .map_err(err)
}

/// Fonter som appen själv har (nedladdade Google Fonts + egna).
#[tauri::command]
pub async fn list_app_fonts(app: AppHandle) -> Result<Vec<AppFont>, String> {
    let dir = fonts_dir(&app)?;
    Ok(read_manifest(&dir))
}

/// Läser en app-font som base64 så att webbvyn kan registrera den med FontFace.
#[tauri::command]
pub async fn read_font_file(app: AppHandle, file: String) -> Result<String, String> {
    let dir = fonts_dir(&app)?;
    // Skydd mot sökvägar utanför fonts-mappen
    let name = Path::new(&file)
        .file_name()
        .ok_or_else(|| "Ogiltigt filnamn".to_string())?;
    let sub = Path::new(&file).parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let sub_ok = sub.as_os_str().is_empty() || sub == Path::new("google") || sub == Path::new("custom");
    if !sub_ok {
        return Err("Ogiltig sökväg".into());
    }
    let bytes = std::fs::read(dir.join(sub).join(name)).map_err(err)?;
    Ok(STANDARD.encode(bytes))
}

struct CssFace {
    weight: u16,
    style: String,
    url: String,
}

/// Plockar ut @font-face-block ur Google Fonts CSS.
fn parse_google_css(css: &str) -> Vec<CssFace> {
    let mut out = Vec::new();
    for block in css.split("@font-face").skip(1) {
        let body = match (block.find('{'), block.find('}')) {
            (Some(a), Some(b)) if b > a => &block[a + 1..b],
            _ => continue,
        };
        let mut weight: u16 = 400;
        let mut style = "normal".to_string();
        let mut url = String::new();
        for decl in body.split(';') {
            let decl = decl.trim();
            if let Some(v) = decl.strip_prefix("font-weight:") {
                // Variabla fonter anges som "100 900" – ta första värdet
                let first = v.trim().split_whitespace().next().unwrap_or("400");
                weight = first.parse().unwrap_or(400);
            } else if let Some(v) = decl.strip_prefix("font-style:") {
                style = if v.trim() == "italic" { "italic".into() } else { "normal".into() };
            } else if decl.starts_with("src:") {
                if let Some(a) = decl.find("url(") {
                    let rest = &decl[a + 4..];
                    if let Some(b) = rest.find(')') {
                        url = rest[..b].trim_matches(|c| c == '\'' || c == '"').to_string();
                    }
                }
            }
        }
        if !url.is_empty() {
            out.push(CssFace { weight, style, url });
        }
    }
    out
}

/// Laddar ned en Google Font (vanliga vikter + kursiv där det finns)
/// och sparar den lokalt så att den fungerar offline och i PDF-export.
#[tauri::command]
pub async fn download_google_font(app: AppHandle, family: String) -> Result<Vec<AppFont>, String> {
    let dir = fonts_dir(&app)?;
    let gdir = dir.join("google");
    std::fs::create_dir_all(&gdir).map_err(err)?;

    // Utan webbläsar-User-Agent levererar Google Fonts TTF-filer,
    // vilket både webbvyn och PDF-motorn kan läsa.
    let client = reqwest::Client::builder()
        .user_agent(concat!("Motiv/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(err)?;

    let fam_q = family.trim().replace(' ', "+");
    let variants = [
        ":ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700",
        ":ital,wght@0,400;0,700;1,400;1,700",
        ":wght@300;400;500;600;700;800;900",
        ":wght@400;700",
        ":ital@0;1",
        "",
    ];
    let mut faces: Vec<CssFace> = Vec::new();
    for v in variants {
        let url = format!("https://fonts.googleapis.com/css2?family={}{}&display=swap", fam_q, v);
        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => return Err(format!("Kunde inte nå Google Fonts: {e}")),
        };
        if !resp.status().is_success() {
            continue;
        }
        let css = resp.text().await.map_err(err)?;
        faces = parse_google_css(&css);
        if !faces.is_empty() {
            break;
        }
    }
    if faces.is_empty() {
        return Err(format!("Hittade ingen Google Font som heter \"{family}\""));
    }

    let mut manifest = read_manifest(&dir);
    let mut added = Vec::new();
    let mut done_urls = BTreeSet::new();
    for f in faces {
        if !done_urls.insert(f.url.clone()) {
            continue;
        }
        let bytes = client
            .get(&f.url)
            .send()
            .await
            .map_err(err)?
            .error_for_status()
            .map_err(err)?
            .bytes()
            .await
            .map_err(err)?;
        let ext = if f.url.ends_with(".otf") { "otf" } else { "ttf" };
        let fname = format!(
            "{}-{}{}.{}",
            safe_name(&family),
            f.weight,
            if f.style == "italic" { "i" } else { "" },
            ext
        );
        std::fs::write(gdir.join(&fname), &bytes).map_err(err)?;
        let entry = AppFont {
            family: family.trim().to_string(),
            weight: f.weight,
            style: f.style,
            file: format!("google/{fname}"),
            source: "google".into(),
        };
        upsert(&mut manifest, entry.clone());
        added.push(entry);
    }
    write_manifest(&dir, &manifest)?;
    Ok(added)
}

/// Lägger till egna fontfiler (TTF/OTF). Familj, vikt och stil läses ur filen.
#[tauri::command]
pub async fn add_custom_fonts(app: AppHandle, paths: Vec<String>) -> Result<Vec<AppFont>, String> {
    let dir = fonts_dir(&app)?;
    let cdir = dir.join("custom");
    std::fs::create_dir_all(&cdir).map_err(err)?;
    let mut manifest = read_manifest(&dir);
    let mut added = Vec::new();

    for p in paths {
        let src = PathBuf::from(&p);
        let bytes = std::fs::read(&src).map_err(err)?;
        let mut db = fontdb::Database::new();
        db.load_font_data(bytes.clone());
        let face = match db.faces().next() {
            Some(f) => f,
            None => return Err(format!("Kunde inte läsa fonten: {p}")),
        };
        let family = face
            .families
            .first()
            .map(|(n, _)| n.clone())
            .unwrap_or_else(|| "Egen font".into());
        let weight = face.weight.0;
        let style = match face.style {
            fontdb::Style::Normal => "normal",
            _ => "italic",
        }
        .to_string();
        let ext = src
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_else(|| "ttf".into());
        let fname = format!(
            "{}-{}{}.{}",
            safe_name(&family),
            weight,
            if style == "italic" { "i" } else { "" },
            ext
        );
        std::fs::write(cdir.join(&fname), &bytes).map_err(err)?;
        let entry = AppFont {
            family,
            weight,
            style,
            file: format!("custom/{fname}"),
            source: "custom".into(),
        };
        upsert(&mut manifest, entry.clone());
        added.push(entry);
    }
    write_manifest(&dir, &manifest)?;
    Ok(added)
}

/// Tar bort alla filer för en app-font-familj.
#[tauri::command]
pub async fn remove_app_font(app: AppHandle, family: String) -> Result<(), String> {
    let dir = fonts_dir(&app)?;
    let mut manifest = read_manifest(&dir);
    for f in manifest.iter().filter(|f| f.family == family) {
        let _ = std::fs::remove_file(dir.join(&f.file));
    }
    manifest.retain(|f| f.family != family);
    write_manifest(&dir, &manifest)
}

/// Bygger en fontdatabas med systemfonter + appens fonter (för PDF-export).
pub fn build_font_db(app: &AppHandle) -> fontdb::Database {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    if let Ok(dir) = fonts_dir(app) {
        db.load_fonts_dir(dir);
    }
    // Reservfonter: Windows har Arial/Times, Linux oftast Liberation eller DejaVu
    let has = |name: &str| db.faces().any(|f| f.families.iter().any(|(n, _)| n == name));
    let pick = |names: &[&'static str]| names.iter().copied().find(|n| has(n)).unwrap_or(names[0]);
    let sans = pick(&["Arial", "Liberation Sans", "DejaVu Sans", "Noto Sans"]);
    let serif = pick(&["Times New Roman", "Liberation Serif", "DejaVu Serif", "Noto Serif"]);
    db.set_sans_serif_family(sans);
    db.set_serif_family(serif);
    db
}
