// Ediholio – Rust-kärnan.
// Webbgränssnittet (ui/) sköter canvas och redigering; här finns allt som
// kräver systemåtkomst eller tunga beräkningar: filer, fonter,
// AI-bakgrundsborttagning och vektor-PDF.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bgremove;
mod files;
mod fonts;
mod pdf;
mod util;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            files::save_file_dialog,
            files::open_file_dialog,
            files::write_text_file,
            files::read_text_file,
            files::write_binary_file,
            files::read_binary_file,
            files::autosave_write,
            files::autosave_read,
            files::autosave_clear,
            files::app_info,
            fonts::list_system_fonts,
            fonts::list_app_fonts,
            fonts::read_font_file,
            fonts::download_google_font,
            fonts::add_custom_fonts,
            fonts::remove_app_font,
            bgremove::bg_models,
            bgremove::bg_download_model,
            bgremove::bg_remove,
            pdf::export_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("Kunde inte starta Ediholio");
}
