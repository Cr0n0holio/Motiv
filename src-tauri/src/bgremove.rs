//! AI-bakgrundsborttagning med U²-Net / IS-Net (ONNX) körda i tract,
//! en ren Rust-motor – inga externa DLL:er behövs.
//! Modellerna laddas ned vid första användning till <appdata>/models.

use crate::util::{app_subdir, err, strip_data_url};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{imageops::FilterType, DynamicImage, GrayImage, ImageFormat, Luma, RgbaImage};
use serde::Serialize;
use std::io::{Cursor, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tract_onnx::prelude::*;

struct ModelDef {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    url: &'static str,
    size_mb: u32,
    input: usize,
    mean: [f32; 3],
    std: [f32; 3],
}

const MODELS: &[ModelDef] = &[
    ModelDef {
        id: "u2netp",
        name: "Snabb",
        description: "U²-Net lite – liten och snabb, bra för tydliga motiv",
        url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx",
        size_mb: 5,
        input: 320,
        mean: [0.485, 0.456, 0.406],
        std: [0.229, 0.224, 0.225],
    },
    ModelDef {
        id: "u2net",
        name: "Bra kvalitet",
        description: "U²-Net – noggrannare kanter, allround",
        url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx",
        size_mb: 168,
        input: 320,
        mean: [0.485, 0.456, 0.406],
        std: [0.229, 0.224, 0.225],
    },
    ModelDef {
        id: "u2net_human_seg",
        name: "Personer",
        description: "U²-Net tränad på människor – bäst för porträtt",
        url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx",
        size_mb: 168,
        input: 320,
        mean: [0.485, 0.456, 0.406],
        std: [0.229, 0.224, 0.225],
    },
    ModelDef {
        id: "isnet-general-use",
        name: "Högsta kvalitet",
        description: "IS-Net – skarpast kanter, långsammare (1024 px)",
        url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
        size_mb: 170,
        input: 1024,
        mean: [0.5, 0.5, 0.5],
        std: [1.0, 1.0, 1.0],
    },
];

fn model_def(id: &str) -> Result<&'static ModelDef, String> {
    MODELS
        .iter()
        .find(|m| m.id == id)
        .ok_or_else(|| format!("Okänd modell: {id}"))
}

fn model_path(app: &AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    Ok(app_subdir(app, "models")?.join(format!("{id}.onnx")))
}

#[derive(Serialize)]
pub struct ModelInfo {
    id: String,
    name: String,
    description: String,
    size_mb: u32,
    downloaded: bool,
}

#[tauri::command]
pub async fn bg_models(app: AppHandle) -> Result<Vec<ModelInfo>, String> {
    let mut out = Vec::new();
    for m in MODELS {
        out.push(ModelInfo {
            id: m.id.into(),
            name: m.name.into(),
            description: m.description.into(),
            size_mb: m.size_mb,
            downloaded: model_path(&app, m.id)?.exists(),
        });
    }
    Ok(out)
}

#[derive(Serialize, Clone)]
struct Progress {
    id: String,
    downloaded: u64,
    total: u64,
}

/// Laddar ned en modell och skickar "bg-progress"-händelser under tiden.
#[tauri::command]
pub async fn bg_download_model(app: AppHandle, id: String) -> Result<(), String> {
    let def = model_def(&id)?;
    let path = model_path(&app, &id)?;
    if path.exists() {
        return Ok(());
    }
    let part = path.with_extension("part");
    let client = reqwest::Client::builder()
        .user_agent("Motiv/0.1")
        .build()
        .map_err(err)?;
    let mut resp = client
        .get(def.url)
        .send()
        .await
        .map_err(|e| format!("Nedladdningen misslyckades: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Nedladdningen misslyckades: {e}"))?;
    let total = resp.content_length().unwrap_or(def.size_mb as u64 * 1024 * 1024);
    let mut file = std::fs::File::create(&part).map_err(err)?;
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;
    while let Some(chunk) = resp.chunk().await.map_err(err)? {
        file.write_all(&chunk).map_err(err)?;
        downloaded += chunk.len() as u64;
        if downloaded - last_emit > 256 * 1024 || downloaded >= total {
            last_emit = downloaded;
            let _ = app.emit("bg-progress", Progress { id: id.clone(), downloaded, total });
        }
    }
    file.flush().map_err(err)?;
    drop(file);
    std::fs::rename(&part, &path).map_err(err)?;
    Ok(())
}

/// Tar bort bakgrunden ur en bild. Tar emot base64 (PNG/JPEG/WebP …) och
/// returnerar en mask som PNG (vit med alfakanal = motivet), i originalstorlek.
#[tauri::command]
pub async fn bg_remove(app: AppHandle, id: String, image: String) -> Result<String, String> {
    let def = model_def(&id)?;
    let path = model_path(&app, &id)?;
    if !path.exists() {
        return Err("Modellen är inte nedladdad".into());
    }
    tauri::async_runtime::spawn_blocking(move || run_model(def, &path, &image))
        .await
        .map_err(err)?
}

type Runnable = TypedRunnableModel<TypedModel>;

/// Senast använda modellen, färdigoptimerad. Att läsa och optimera en modell
/// tar flera sekunder (IS-Net är 170 MB), så den sparas mellan körningarna.
/// Bara en hålls i minnet åt gången för att inte binda upp hundratals MB.
static MODEL_CACHE: Mutex<Option<(&'static str, Arc<Runnable>)>> = Mutex::new(None);

fn cached_model(def: &'static ModelDef, path: &std::path::Path) -> Result<Arc<Runnable>, String> {
    if let Some((id, m)) = MODEL_CACHE.lock().map_err(err)?.as_ref() {
        if *id == def.id {
            return Ok(m.clone());
        }
    }
    let s = def.input;
    let model = tract_onnx::onnx()
        .model_for_path(path)
        .map_err(|e| format!("Kunde inte läsa modellen: {e}"))?
        .with_input_fact(0, f32::fact([1, 3, s, s]).into())
        .map_err(err)?
        .into_optimized()
        .map_err(|e| format!("Modellen stöds inte: {e}"))?
        .into_runnable()
        .map_err(err)?;
    let model = Arc::new(model);
    *MODEL_CACHE.lock().map_err(err)? = Some((def.id, model.clone()));
    Ok(model)
}

fn run_model(def: &'static ModelDef, path: &std::path::Path, image_b64: &str) -> Result<String, String> {
    let bytes = STANDARD.decode(strip_data_url(image_b64)).map_err(err)?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("Kunde inte läsa bilden: {e}"))?;
    let (ow, oh) = (img.width(), img.height());
    let s = def.input;

    // Förbehandling: skala till modellens storlek, normalisera.
    let small = img.resize_exact(s as u32, s as u32, FilterType::Triangle).to_rgb8();
    let mut max_v: f32 = 1.0 / 255.0;
    for p in small.pixels() {
        for c in 0..3 {
            max_v = max_v.max(p[c] as f32 / 255.0);
        }
    }
    let input: Tensor = tract_ndarray::Array4::from_shape_fn((1, 3, s, s), |(_, c, y, x)| {
        let v = small.get_pixel(x as u32, y as u32)[c] as f32 / 255.0 / max_v;
        (v - def.mean[c]) / def.std[c]
    })
    .into();

    let model = cached_model(def, path)?;
    let result = model.run(tvec!(input.into())).map_err(|e| format!("Körningen misslyckades: {e}"))?;
    let out = result[0].to_array_view::<f32>().map_err(err)?;
    let shape = out.shape().to_vec();
    if shape.len() < 2 {
        return Err("Oväntat svar från modellen".into());
    }
    let mh = shape[shape.len() - 2];
    let mw = shape[shape.len() - 1];
    let flat: Vec<f32> = out.iter().copied().take(mw * mh).collect();

    // Normalisera till 0..1
    let (mut mi, mut ma) = (f32::MAX, f32::MIN);
    for &v in &flat {
        mi = mi.min(v);
        ma = ma.max(v);
    }
    let range = (ma - mi).max(1e-6);
    let mut mask = GrayImage::new(mw as u32, mh as u32);
    for y in 0..mh {
        for x in 0..mw {
            let v = (flat[y * mw + x] - mi) / range;
            mask.put_pixel(x as u32, y as u32, Luma([(v * 255.0).round().clamp(0.0, 255.0) as u8]));
        }
    }

    // Skala upp masken till originalstorlek och lägg den i alfakanalen.
    let big = DynamicImage::ImageLuma8(mask)
        .resize_exact(ow, oh, FilterType::CatmullRom)
        .to_luma8();
    let mut rgba = RgbaImage::new(ow, oh);
    for (x, y, p) in big.enumerate_pixels() {
        // Lätt kurva för renare kanter: tryck ned brus, behåll mjuka hårstrån.
        let a = p[0] as f32 / 255.0;
        let a = ((a - 0.04) / 0.92).clamp(0.0, 1.0);
        rgba.put_pixel(x, y, image::Rgba([255, 255, 255, (a * 255.0).round() as u8]));
    }
    let mut png = Vec::new();
    DynamicImage::ImageRgba8(rgba)
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(err)?;
    Ok(STANDARD.encode(png))
}
