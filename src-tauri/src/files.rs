use crate::util::{app_dir, err, strip_data_url};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Deserialize)]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

fn apply_filters(mut d: rfd::FileDialog, filters: &[DialogFilter]) -> rfd::FileDialog {
    for f in filters {
        let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
        d = d.add_filter(f.name.as_str(), exts.as_slice());
    }
    d
}

/// Visar en "Spara som"-dialog. Returnerar vald sökväg eller null.
/// Dialogen körs på en egen tråd så att gränssnittet inte fryser.
#[tauri::command]
pub async fn save_file_dialog(
    default_name: String,
    filters: Vec<DialogFilter>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_filters(rfd::FileDialog::new().set_file_name(default_name.as_str()), &filters)
            .save_file()
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(err)
}

/// Visar en "Öppna"-dialog. Returnerar valda sökvägar (tom lista om avbrutet).
#[tauri::command]
pub async fn open_file_dialog(
    filters: Vec<DialogFilter>,
    multiple: bool,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let d = apply_filters(rfd::FileDialog::new(), &filters);
        let picked: Vec<std::path::PathBuf> = if multiple {
            d.pick_files().unwrap_or_default()
        } else {
            d.pick_file().map(|p| vec![p]).unwrap_or_default()
        };
        picked
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<String>>()
    })
    .await
    .map_err(err)
}

#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(err)
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(err)
}

/// Skriver base64-kodad data (med eller utan data:-prefix) till fil.
#[tauri::command]
pub async fn write_binary_file(path: String, data: String) -> Result<(), String> {
    let bytes = STANDARD.decode(strip_data_url(&data)).map_err(err)?;
    std::fs::write(&path, bytes).map_err(err)
}

#[derive(Serialize)]
pub struct BinaryFile {
    pub name: String,
    pub data: String,
}

/// Läser en fil och returnerar den base64-kodad.
#[tauri::command]
pub async fn read_binary_file(path: String) -> Result<BinaryFile, String> {
    let bytes = std::fs::read(&path).map_err(err)?;
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(BinaryFile { name, data: STANDARD.encode(bytes) })
}

const AUTOSAVE: &str = "autosave.motiv";

#[tauri::command]
pub async fn autosave_write(app: AppHandle, contents: String) -> Result<(), String> {
    let dir = app_dir(&app)?;
    let tmp = dir.join("autosave.tmp");
    std::fs::write(&tmp, contents).map_err(err)?;
    std::fs::rename(&tmp, dir.join(AUTOSAVE)).map_err(err)
}

#[tauri::command]
pub async fn autosave_read(app: AppHandle) -> Result<Option<String>, String> {
    let p = app_dir(&app)?.join(AUTOSAVE);
    if p.exists() {
        Ok(Some(std::fs::read_to_string(p).map_err(err)?))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn autosave_clear(app: AppHandle) -> Result<(), String> {
    let p = app_dir(&app)?.join(AUTOSAVE);
    if p.exists() {
        std::fs::remove_file(p).map_err(err)?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
}

#[tauri::command]
pub async fn app_info(app: AppHandle) -> Result<AppInfo, String> {
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        data_dir: app_dir(&app)?.to_string_lossy().to_string(),
    })
}
