use std::ffi::OsStr;
use std::path::Path;

use rayon::prelude::*;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::error::AppError;
use crate::models::{ImportResult, Item};
use crate::thumbnail::generate_thumbnail;

const SUPPORTED_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp"];

fn is_supported_image(path: &Path) -> bool {
    path
        .extension()
        .and_then(OsStr::to_str)
        .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

struct ProcessedFile {
    item: Item,
    thumb_path: Option<std::path::PathBuf>,
}

fn compute_sha256(path: &Path) -> Result<String, AppError> {
    let data = std::fs::read(path)?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Ok(format!("{:x}", hasher.finalize()))
}

fn copy_to_library(src: &Path, library_path: &Path, id: &str) -> Result<std::path::PathBuf, AppError> {
    let ext = src
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("jpg");
    let dest_dir = library_path.join("images");
    std::fs::create_dir_all(&dest_dir)?;
    let dest = dest_dir.join(format!("{id}.{ext}"));
    std::fs::copy(src, &dest)?;
    Ok(dest)
}

pub fn import_directory(
    conn: &Connection,
    library_path: &Path,
    source_path: &Path,
) -> Result<ImportResult, AppError> {
    let mut result = ImportResult::default();

    // Phase 1: collect all image files
    let files: Vec<std::path::PathBuf> = WalkDir::new(source_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| is_supported_image(e.path()))
        .map(|e| e.into_path())
        .collect();

    if files.is_empty() {
        return Ok(result);
    }

    let thumb_dir = library_path.join(".shark").join("thumbnails");

    // Phase 2: parallel processing (no DB lock held)
    let processed: Vec<Result<ProcessedFile, AppError>> = files
        .par_iter()
        .map(|path| {
            let id = uuid::Uuid::new_v4().to_string();
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str().map(String::from))
                .unwrap_or_default();
            let file_size = path.metadata().map(|m| m.len() as i64).unwrap_or(0);
            let ext = path
                .extension()
                .and_then(OsStr::to_str)
                .map(|e| e.to_uppercase())
                .unwrap_or_else(|| "JPG".to_string());

            // Compute SHA256
            let sha256 = compute_sha256(path)?;

            // Copy to library
            let dest_path = copy_to_library(path, library_path, &id)?;

            // Extract dimensions
            let (width, height) = match image::image_dimensions(path) {
                Ok((w, h)) => (Some(w as i64), Some(h as i64)),
                Err(_) => (None, None),
            };

            // Generate 256px thumbnail
            let thumb_path = generate_thumbnail(&dest_path, &thumb_dir, &id, 256).ok();

            let now = chrono::Utc::now().to_rfc3339();

            Ok(ProcessedFile {
                item: Item {
                    id,
                    file_path: dest_path.to_string_lossy().to_string(),
                    file_name,
                    file_size,
                    file_type: ext,
                    width,
                    height,
                    tags: String::new(),
                    rating: 0,
                    notes: String::new(),
                    sha256,
                    status: "active".to_string(),
                    created_at: now.clone(),
                    modified_at: now,
                },
                thumb_path,
            })
        })
        .collect();

    // Phase 3: sequential DB insert (check dups)
    for pf in processed {
        match pf {
            Ok(pf) => {
                if crate::db::sha256_exists(conn, &pf.item.sha256)? {
                    // Duplicate - remove copied file
                    let _ = std::fs::remove_file(&pf.item.file_path);
                    if let Some(ref tp) = &pf.thumb_path {
                        let _ = std::fs::remove_file(tp);
                    }
                    result.duplicates += 1;
                } else {
                    crate::db::insert_item(conn, &pf.item)?;
                    if let Some(ref tp) = &pf.thumb_path {
                        let rel = tp.to_string_lossy().to_string();
                        crate::db::insert_thumbnail(conn, &pf.item.id, Some(&rel), None)?;
                    }
                    result.imported += 1;
                }
            }
            Err(e) => {
                eprintln!("Import error: {e}");
                result.skipped += 1;
            }
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_supported_image() {
        assert!(is_supported_image(Path::new("test.jpg")));
        assert!(is_supported_image(Path::new("test.PNG")));
        assert!(is_supported_image(Path::new("test.webp")));
        assert!(!is_supported_image(Path::new("test.pdf")));
        assert!(!is_supported_image(Path::new("test.mp4")));
    }

    #[test]
    fn test_compute_sha256() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.txt");
        std::fs::write(&file, b"hello").unwrap();
        let hash = compute_sha256(&file).unwrap();
        assert_eq!(hash.len(), 64);
    }
}
