use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Gör om valfritt fel till en sträng som kan skickas till gränssnittet.
pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Appens datamapp (t.ex. %APPDATA%\se.micke.ediholio), skapas vid behov.
pub fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(err)?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

/// En undermapp i appens datamapp, skapas vid behov.
pub fn app_subdir(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app_dir(app)?.join(name);
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

/// Tar bort ett eventuellt "data:...;base64,"-prefix.
pub fn strip_data_url(s: &str) -> &str {
    match s.find(";base64,") {
        Some(i) if s.starts_with("data:") => &s[i + 8..],
        _ => s,
    }
}

/// Filnamnssäker version av en sträng.
pub fn safe_name(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if cleaned.is_empty() {
        "font".to_string()
    } else {
        cleaned
    }
}
