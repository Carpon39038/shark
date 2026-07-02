//! Auto-import: watch a single external folder and import image files that
//! appear in it into the active library.
//!
//! Model: a *drop-zone → import* flow, not a two-way mirror. Only file
//! additions/modifications trigger imports; deletions in the watched folder are
//! ignored. Imports copy into the library's `images/` dir (which is not watched),
//! so imports can't retrigger the watcher, and sha256 dedup makes re-observing an
//! already-imported file a no-op.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use notify::RecommendedWatcher;
use tauri::{AppHandle, Emitter};

use crate::db;
use crate::error::AppError;
use crate::indexer;

/// How long to wait for filesystem events to settle before importing a batch.
/// Copying many files (or an editor's atomic-save temp churn) collapses into one
/// settled batch rather than firing per-file.
const DEBOUNCE: Duration = Duration::from_millis(500);

/// Holds the single live folder watcher. Dropping the `Debouncer` stops the OS
/// watch and joins its thread, so "stop" is just replacing `inner` with `None`.
#[derive(Default)]
pub struct WatcherState {
    inner: Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>,
    /// The path currently being watched (for idempotence and status).
    watched: Mutex<Option<PathBuf>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Stop watching, if anything is active. Idempotent.
    pub fn stop(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            // Dropping the debouncer tears down the watch.
            *guard = None;
        }
        if let Ok(mut w) = self.watched.lock() {
            *w = None;
        }
    }

    /// Start watching `path`, importing into `library_id` on changes.
    /// Replaces any existing watcher. `library_id` is captured so the debounce
    /// callback can resolve the library's DB independently of the active one.
    pub fn start(
        &self,
        app: AppHandle,
        path: &Path,
        library_id: String,
    ) -> Result<(), AppError> {
        // Tear down any existing watcher first.
        self.stop();

        let watch_path = path.to_path_buf();
        let cb_app = app.clone();
        let cb_lib = library_id.clone();
        let cb_path = watch_path.clone();

        let mut debouncer = new_debouncer(
            DEBOUNCE,
            None,
            move |result: DebounceEventResult| match result {
                Ok(events) => {
                    // Collect create/modify paths from this settled batch.
                    let mut paths: Vec<String> = Vec::new();
                    for ev in events {
                        if ev.kind.is_create() || ev.kind.is_modify() {
                            for p in &ev.paths {
                                paths.push(p.to_string_lossy().to_string());
                            }
                        }
                    }
                    if paths.is_empty() {
                        return;
                    }
                    paths.sort();
                    paths.dedup();
                    run_auto_import(&cb_app, &cb_lib, &cb_path, paths);
                }
                Err(errors) => {
                    for e in errors {
                        eprintln!("Auto-import watch error: {e}");
                    }
                }
            },
        )
        .map_err(|e| AppError::Io(format!("Failed to create watcher: {e}")))?;

        debouncer
            .watch(&watch_path, RecursiveMode::NonRecursive)
            .map_err(|e| AppError::Io(format!("Failed to watch folder: {e}")))?;

        if let Ok(mut guard) = self.inner.lock() {
            *guard = Some(debouncer);
        }
        if let Ok(mut w) = self.watched.lock() {
            *w = Some(watch_path);
        }
        Ok(())
    }
}

/// Import the given source paths into `library_id`, skipping duplicates, and emit
/// an `auto-import` event with the result. Runs synchronously on the debouncer's
/// callback thread (already off the main thread); the debouncer serializes
/// callbacks so batches never overlap.
fn run_auto_import(app: &AppHandle, library_id: &str, watched: &Path, paths: Vec<String>) {
    match import_paths(app, library_id, paths) {
        Ok(result) => {
            if result.imported > 0 || result.duplicates > 0 {
                let _ = app.emit(
                    "auto-import",
                    serde_json::json!({
                        "imported": result.imported,
                        "skipped": result.skipped,
                        "duplicates": result.duplicates,
                        "watchedPath": watched.to_string_lossy(),
                    }),
                );
            }
        }
        Err(e) => {
            eprintln!("Auto-import failed for {}: {e}", watched.display());
        }
    }
}

/// Resolve the library path from the registry, then import the paths. Split from
/// the pure import logic so the latter is testable without an `AppHandle`.
fn import_paths(
    app: &AppHandle,
    library_id: &str,
    paths: Vec<String>,
) -> Result<crate::models::ImportResult, AppError> {
    use tauri::Manager;

    let state = app.state::<db::DbState>();
    let lib_path = {
        let registry = state
            .registry
            .lock()
            .map_err(|e| AppError::Database(e.to_string()))?;
        db::get_library(&registry, library_id)?.path
    };
    import_paths_into_library(&lib_path, paths)
}

/// Prepare + import the paths into the library at `lib_path`, skipping sha256
/// duplicates, reusing the standard import pipeline so auto-import inherits
/// dedup, thumbnails, color extraction and FTS indexing. No progress emission —
/// auto-import is a quiet background action.
fn import_paths_into_library(
    lib_path: &str,
    paths: Vec<String>,
) -> Result<crate::models::ImportResult, AppError> {
    let prepared = indexer::prepare_from_paths(&paths)?;
    let lib_db_path = Path::new(lib_path).join(".shark").join("metadata.db");
    let conn = db::init_library_db(&lib_db_path)?;
    indexer::commit_import(&conn, Path::new(lib_path), prepared, |_, _, _, _| {})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    /// Prove the notify + debouncer wiring actually fires a create event when a
    /// file lands in the watched folder. This is the half of auto-import that is
    /// environment-dependent (real OS filesystem events); the import half is
    /// covered by the indexer tests.
    #[test]
    fn test_debouncer_fires_on_file_create() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel::<Vec<String>>();

        let mut debouncer = new_debouncer(
            Duration::from_millis(200),
            None,
            move |result: DebounceEventResult| {
                if let Ok(events) = result {
                    let mut paths = Vec::new();
                    for ev in events {
                        if ev.kind.is_create() || ev.kind.is_modify() {
                            for p in &ev.paths {
                                paths.push(p.to_string_lossy().to_string());
                            }
                        }
                    }
                    if !paths.is_empty() {
                        let _ = tx.send(paths);
                    }
                }
            },
        )
        .unwrap();

        debouncer
            .watch(dir.path(), RecursiveMode::NonRecursive)
            .unwrap();

        // Drop a file into the watched folder.
        let file = dir.path().join("dropped.png");
        std::fs::write(&file, b"not-a-real-image-but-triggers-an-event").unwrap();

        // Wait for the debounced batch. Generous timeout for slow CI.
        let received = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("debouncer should have fired a create/modify event");

        assert!(
            received.iter().any(|p| p.ends_with("dropped.png")),
            "expected event for dropped.png, got {received:?}"
        );

        debouncer.stop();
    }

    /// Exercise the full auto-import glue (minus the AppHandle): a real image in
    /// an external folder is imported into a library, and re-importing the same
    /// file is deduped to a no-op.
    #[test]
    fn test_import_paths_into_library_imports_and_dedups() {
        // Set up a library.
        let lib_dir = tempfile::tempdir().unwrap();
        let lib_path = lib_dir.path().to_string_lossy().to_string();
        std::fs::create_dir_all(lib_dir.path().join(".shark")).unwrap();
        let lib_db = lib_dir.path().join(".shark").join("metadata.db");
        db::init_library_db(&lib_db).unwrap();

        // A real image in a separate "watched" folder.
        let watched = tempfile::tempdir().unwrap();
        let src = watched.path().join("photo.png");
        image::RgbImage::from_pixel(64, 48, image::Rgb([10, 20, 30]))
            .save(&src)
            .unwrap();
        let src_path = src.to_string_lossy().to_string();

        // First import: one file lands in the library.
        let r1 = import_paths_into_library(&lib_path, vec![src_path.clone()]).unwrap();
        assert_eq!(r1.imported, 1, "first import should add the file");

        let conn = db::init_library_db(&lib_db).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);

        // The file was copied into the library's images/ dir.
        let images = std::fs::read_dir(lib_dir.path().join("images")).unwrap().count();
        assert_eq!(images, 1, "file should be copied into images/");

        // Second import of the same source is deduped (no new item).
        let r2 = import_paths_into_library(&lib_path, vec![src_path]).unwrap();
        assert_eq!(r2.imported, 0, "re-import should import nothing");
        assert_eq!(r2.duplicates, 1, "re-import should count one duplicate");

        let count_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_after, 1, "no duplicate row should be added");
    }
}
