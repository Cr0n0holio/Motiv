//! Vektor-PDF för tryck: gränssnittet bygger en SVG (med utfall och
//! skärmärken) och här konverteras den med usvg + svg2pdf. Fonter hämtas
//! från systemet och appens fontmapp så att texten förblir vektor.

use crate::fonts::build_font_db;
use crate::util::err;
use std::sync::Arc;
use svg2pdf::usvg;
use tauri::AppHandle;

/// svg2pdf har bytt returtyp mellan versioner (Vec<u8> / Result<Vec<u8>, _>).
/// Den här lilla traiten gör koden oberoende av vilken som används.
trait IntoPdfBytes {
    fn into_pdf_bytes(self) -> Result<Vec<u8>, String>;
}
impl IntoPdfBytes for Vec<u8> {
    fn into_pdf_bytes(self) -> Result<Vec<u8>, String> {
        Ok(self)
    }
}
impl<E: std::fmt::Debug> IntoPdfBytes for Result<Vec<u8>, E> {
    fn into_pdf_bytes(self) -> Result<Vec<u8>, String> {
        self.map_err(|e| format!("PDF-konverteringen misslyckades: {e:?}"))
    }
}

#[tauri::command]
pub async fn export_pdf(app: AppHandle, path: String, svg: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut opt = usvg::Options::default();
        opt.fontdb = Arc::new(build_font_db(&app));
        let tree = usvg::Tree::from_str(&svg, &opt).map_err(|e| format!("Ogiltig SVG: {e}"))?;
        let pdf = svg2pdf::to_pdf(
            &tree,
            svg2pdf::ConversionOptions::default(),
            svg2pdf::PageOptions::default(),
        )
        .into_pdf_bytes()?;
        std::fs::write(&path, pdf).map_err(err)
    })
    .await
    .map_err(err)?
}
