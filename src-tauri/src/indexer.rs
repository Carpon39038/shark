use std::ffi::OsStr;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use rayon::prelude::*;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::error::AppError;
use crate::models::{ImportResult, Item, ItemStatus};
use crate::thumbnail::generate_thumbnail;

const SUPPORTED_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp"];

fn is_supported_image(path: &Path) -> bool {
    path
        .extension()
        .and_then(OsStr::to_str)
        .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
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

/// Data extracted from source file during parallel processing (no copy yet).
pub struct PreparedFile {
    pub source_path: std::path::PathBuf,
    pub id: String,
    pub file_name: String,
    pub file_size: i64,
    pub file_type: String,
    pub sha256: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
}

/// Phase 1+2: Walk files and extract metadata in parallel — no DB lock needed.
pub fn prepare_import(source_path: &Path) -> Result<Vec<Result<PreparedFile, AppError>>, AppError> {
    let files: Vec<std::path::PathBuf> = WalkDir::new(source_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| is_supported_image(e.path()))
        .map(|e| e.into_path())
        .collect();

    if files.is_empty() {
        return Ok(Vec::new());
    }

    let prepared: Vec<Result<PreparedFile, AppError>> = files
        .into_par_iter()
        .map(|path| {
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

            let sha256 = compute_sha256(&path)?;

            let (width, height) = match image::image_dimensions(&path) {
                Ok((w, h)) => (Some(w as i64), Some(h as i64)),
                Err(_) => (None, None),
            };

            Ok(PreparedFile {
                source_path: path,
                id: uuid::Uuid::new_v4().to_string(),
                file_name,
                file_size,
                file_type: ext,
                sha256,
                width,
                height,
            })
        })
        .collect();

    Ok(prepared)
}

/// Phase 3: Batch dedup, parallel copy+thumbnail, transaction-wrapped batch insert.
/// Calls `on_progress(current, total, item, thumb_path)` as each file is processed.
pub fn commit_import<F>(
    conn: &Connection,
    library_path: &Path,
    prepared: Vec<Result<PreparedFile, AppError>>,
    on_progress: F,
) -> Result<ImportResult, AppError>
where
    F: Fn(usize, usize, Option<&Item>, Option<&str>) + Send + Sync,
{
    let total = prepared.len();
    if total == 0 {
        return Ok(ImportResult::default());
    }

    // Pre-create directories once (avoids repeated syscalls in parallel phase)
    let thumb_dir = library_path.join(".shark").join("thumbnails");
    std::fs::create_dir_all(library_path.join("images"))?;
    std::fs::create_dir_all(&thumb_dir)?;

    // Separate successes from failures
    let mut ok_files: Vec<PreparedFile> = Vec::new();
    let mut skipped = 0usize;
    for pf in prepared {
        match pf {
            Ok(pf) => ok_files.push(pf),
            Err(e) => {
                eprintln!("Import error: {e}");
                skipped += 1;
            }
        }
    }

    // Batch dedup — one query instead of N
    let existing = {
        let sha256s: Vec<&str> = ok_files.iter().map(|pf| pf.sha256.as_str()).collect();
        crate::db::batch_sha256_exists(conn, &sha256s)?
    };

    let to_process: Vec<PreparedFile> = ok_files
        .into_iter()
        .filter(|pf| !existing.contains(&pf.sha256))
        .collect();

    let duplicates = total - to_process.len() - skipped;

    // Parallel: copy + thumbnail — emit progress as each file completes
    let counter = AtomicUsize::new(0);
    let processed: Vec<(Item, Option<String>)> = to_process
        .into_par_iter()
        .map(|pf| {
            let dest_path = copy_to_library(&pf.source_path, library_path, &pf.id)?;
            let thumb_path = generate_thumbnail(&dest_path, &thumb_dir, &pf.id, 256).ok();

            let now = chrono::Utc::now().to_rfc3339();
            let item = Item {
                id: pf.id,
                file_path: dest_path.to_string_lossy().to_string(),
                file_name: pf.file_name,
                file_size: pf.file_size,
                file_type: pf.file_type,
                width: pf.width,
                height: pf.height,
                tags: String::new(),
                rating: 0,
                notes: String::new(),
                sha256: pf.sha256,
                status: ItemStatus::Active,
                created_at: now.clone(),
                modified_at: now,
            };
            let thumb_str = thumb_path.map(|p| p.to_string_lossy().into_owned());

            let current = counter.fetch_add(1, Ordering::Relaxed) + 1;
            on_progress(current, total, Some(&item), thumb_str.as_deref());

            Ok((item, thumb_str))
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    // Batch DB insert in a single transaction
    conn.execute_batch("BEGIN")?;
    let insert_result: Result<(), AppError> = (|| {
        for (item, thumb_str) in &processed {
            crate::db::insert_item(conn, item)?;
            if let Some(ref tp) = thumb_str {
                crate::db::insert_thumbnail(conn, &item.id, Some(tp), None)?;
            }
        }
        Ok(())
    })();
    match insert_result {
        Ok(()) => conn.execute_batch("COMMIT")?,
        Err(e) => {
            conn.execute_batch("ROLLBACK").ok();
            return Err(e);
        }
    }

    Ok(ImportResult {
        imported: processed.len() as i64,
        skipped: skipped as i64,
        duplicates: duplicates as i64,
    })
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
