//! Vektor-PDF för tryck: gränssnittet bygger en SVG per sida (med utfall och
//! skärmärken) och här konverteras de med usvg + svg2pdf och sätts ihop till
//! en PDF med en sida per SVG. Fonter hämtas från systemet och appens
//! fontmapp så att texten förblir vektor.

use crate::fonts::build_font_db;
use crate::util::err;
use pdf_writer::{Content, Finish, Name, Pdf, Rect, Ref};
use std::collections::HashMap;
use std::sync::Arc;
use svg2pdf::usvg;
use tauri::AppHandle;

#[tauri::command]
pub async fn export_pdf(app: AppHandle, path: String, svgs: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        if svgs.is_empty() {
            return Err("Inga sidor att exportera".into());
        }
        let mut opt = usvg::Options::default();
        opt.fontdb = Arc::new(build_font_db(&app));

        let mut alloc = Ref::new(1);
        let catalog_id = alloc.bump();
        let page_tree_id = alloc.bump();
        let mut pdf = Pdf::new();
        let mut page_ids = Vec::with_capacity(svgs.len());

        for (i, svg) in svgs.iter().enumerate() {
            let tree = usvg::Tree::from_str(svg, &opt).map_err(|e| format!("Ogiltig SVG (sida {}): {e}", i + 1))?;
            // SVG:ns width/height är redan i punkter (1/72 tum)
            let (w, h) = (tree.size().width(), tree.size().height());
            let (chunk, svg_ref) = svg2pdf::to_chunk(&tree, svg2pdf::ConversionOptions::default())
                .map_err(|e| format!("PDF-konverteringen misslyckades (sida {}): {e:?}", i + 1))?;

            // Sidans objekt får nya nummer så att de inte krockar med andra sidors
            let mut map = HashMap::new();
            let chunk = chunk.renumber(|old| *map.entry(old).or_insert_with(|| alloc.bump()));
            let svg_ref = map[&svg_ref];

            let page_id = alloc.bump();
            let content_id = alloc.bump();
            page_ids.push(page_id);
            let svg_name = Name(b"S1");

            let mut page = pdf.page(page_id);
            page.media_box(Rect::new(0.0, 0.0, w, h));
            page.parent(page_tree_id);
            page.contents(content_id);
            page.resources().x_objects().pair(svg_name, svg_ref);
            page.finish();

            // SVG-objektet är 1×1 enheter och skalas upp till hela sidan
            let mut content = Content::new();
            content.transform([w, 0.0, 0.0, h, 0.0, 0.0]).x_object(svg_name);
            pdf.stream(content_id, &content.finish());
            pdf.extend(&chunk);
        }

        pdf.catalog(catalog_id).pages(page_tree_id);
        pdf.pages(page_tree_id).count(page_ids.len() as i32).kids(page_ids);
        std::fs::write(&path, pdf.finish()).map_err(err)
    })
    .await
    .map_err(err)?
}
