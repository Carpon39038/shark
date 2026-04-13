use std::collections::HashMap;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::Connection;
use tauri::{Emitter, State};

use crate::db::{self, DbState};
use crate::error::AppError;
use crate::models::*;
use crate::search;
use crate::models::RuleGroup;
use rayon::prelude::*;

fn with_library_conn<F, T>(state: &State<'_, DbState>, f: F) -> Result<T, AppError>
where
    F: FnOnce(&Connection) -> Result<T, AppError>,
{
    let guard = state
        .library
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::NoActiveLibrary)?;
    f(conn)
}

fn with_registry_conn<F, T>(state: &State<'_, DbState>, f: F) -> Result<T, AppError>
where
    F: FnOnce(&Connection) -> Result<T, AppError>,
{
    let guard = state
        .registry
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    f(&guard)
}

#[tauri::command]
pub fn create_library(
    name: String,
    path: String,
    state: State<'_, DbState>,
) -> Result<Library, AppError> {
    let lib = with_registry_conn(&state, |conn| db::create_library(conn, &name, &path))?;

    let lib_db_path = Path::new(&path).join(".shark").join("metadata.db");
    let lib_conn = db::init_library_db(&lib_db_path)?;

    let mut library = state
        .library
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    *library = Some(lib_conn);

    Ok(lib)
}

#[tauri::command]
pub fn open_library(path: String, state: State<'_, DbState>) -> Result<Library, AppError> {
    let lib = with_registry_conn(&state, |conn| db::get_library_by_path(conn, &path))?;

    let lib_db_path = Path::new(&path).join(".shark").join("metadata.db");
    let lib_conn = db::init_library_db(&lib_db_path)?;

    let mut library = state
        .library
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    *library = Some(lib_conn);

    Ok(lib)
}

#[tauri::command]
pub fn list_libraries(state: State<'_, DbState>) -> Result<Vec<Library>, AppError> {
    with_registry_conn(&state, |conn| db::list_libraries(conn))
}

#[tauri::command]
pub async fn import_files(
    library_id: String,
    source_path: String,
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<ImportResult, AppError> {
    let lib = with_registry_conn(&state, |conn| db::get_library(conn, &library_id))?;
    let lib_path = lib.path.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<ImportResult, AppError> {
        let prepared = crate::indexer::prepare_import(Path::new(&source_path))?;
        let lib_db_path = Path::new(&lib_path).join(".shark").join("metadata.db");
        let conn = db::init_library_db(&lib_db_path)?;

        crate::indexer::commit_import(
            &conn,
            Path::new(&lib_path),
            prepared,
            |current, total, item, thumb_path| {
                let payload = serde_json::json!({
                    "current": current,
                    "total": total,
                    "item": item,
                    "thumbnailPath": thumb_path,
                });
                let _ = app.emit("import-progress", payload);
            },
        )
    })
    .await
    .map_err(|e| AppError::Import(format!("Import task failed: {e}")))?
}

#[tauri::command]
pub async fn import_prepare(
    library_id: String,
    source_path: String,
    state: State<'_, DbState>,
) -> Result<ImportPrepResult, AppError> {
    let lib = with_registry_conn(&state, |conn| db::get_library(conn, &library_id))?;
    let lib_path = lib.path.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<ImportPrepResult, AppError> {
        let prepared = crate::indexer::prepare_import(Path::new(&source_path))?;
        let lib_db_path = Path::new(&lib_path).join(".shark").join("metadata.db");
        let conn = db::init_library_db(&lib_db_path)?;

        let total_prepared = prepared.iter().filter(|p| p.is_ok()).count();
        let (duplicates, _non_dup_files) = crate::indexer::find_duplicates(&conn, &prepared)?;

        Ok(ImportPrepResult {
            duplicates,
            total_prepared,
        })
    })
    .await
    .map_err(|e| AppError::Import(format!("Import prepare failed: {e}")))?
}

#[tauri::command]
pub async fn import_commit(
    library_id: String,
    source_path: String,
    actions: std::collections::HashMap<String, DedupAction>,
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<ImportResult, AppError> {
    let lib = with_registry_conn(&state, |conn| db::get_library(conn, &library_id))?;
    let lib_path = lib.path.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<ImportResult, AppError> {
        let prepared = crate::indexer::prepare_import(Path::new(&source_path))?;
        let lib_db_path = Path::new(&lib_path).join(".shark").join("metadata.db");
        let conn = db::init_library_db(&lib_db_path)?;

        let (duplicates, mut non_dup_files) = crate::indexer::find_duplicates(&conn, &prepared)?;

        // Apply user decisions: add "keep" files back to import list
        let mut kept_count = 0i64;

        // Collect keep files from prepared list
        let prepared_lookup: std::collections::HashMap<String, crate::indexer::PreparedFile> = prepared
            .into_iter()
            .filter_map(|p| p.ok())
            .map(|p| (p.source_path.to_string_lossy().to_string(), p))
            .collect();

        for (source_path, action) in &actions {
            if matches!(action, DedupAction::KeepBoth) {
                if let Some(pf) = prepared_lookup.get(source_path) {
                    non_dup_files.push(pf.clone());
                    kept_count += 1;
                }
            }
        }

        let skipped_count = duplicates.len() as i64 - kept_count;
        let dup_count = duplicates.len() as i64;

        // Import non-dup + kept files
        let thumb_dir = Path::new(&lib_path).join(".shark").join("thumbnails");
        std::fs::create_dir_all(Path::new(&lib_path).join("images"))?;
        std::fs::create_dir_all(&thumb_dir)?;

        let counter = std::sync::atomic::AtomicUsize::new(0);
        let total = non_dup_files.len();
        let processed: Vec<(Item, Option<String>)> = non_dup_files
            .into_par_iter()
            .map(|pf| {
                let dest_path = crate::indexer::copy_to_library(&pf.source_path, Path::new(&lib_path), &pf.id)?;
                let thumb_path = crate::thumbnail::generate_thumbnail(&dest_path, &thumb_dir, &pf.id, 720).ok();

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

                let current = counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                let payload = serde_json::json!({
                    "current": current,
                    "total": total,
                    "item": item,
                    "thumbnailPath": thumb_str.as_deref(),
                });
                let _ = app.emit("import-progress", payload);

                Ok((item, thumb_str))
            })
            .collect::<Result<Vec<_>, AppError>>()?;

        // Batch DB insert
        conn.execute_batch("BEGIN")?;
        let insert_result: Result<(), AppError> = (|| {
            for (item, thumb_str) in &processed {
                crate::db::insert_item(&conn, item)?;
                if let Some(ref tp) = thumb_str {
                    crate::db::insert_thumbnail(&conn, &item.id, Some(tp), None)?;
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
            skipped: skipped_count,
            duplicates: dup_count,
        })
    })
    .await
    .map_err(|e| AppError::Import(format!("Import commit failed: {e}")))?
}

#[tauri::command]
pub async fn import_from_paths(
    library_id: String,
    paths: Vec<String>,
    state: State<'_, DbState>,
) -> Result<ImportPrepResult, AppError> {
    let lib = with_registry_conn(&state, |conn| db::get_library(conn, &library_id))?;
    let lib_path = lib.path.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<ImportPrepResult, AppError> {
        let prepared = crate::indexer::prepare_from_paths(&paths)?;
        let lib_db_path = Path::new(&lib_path).join(".shark").join("metadata.db");
        let conn = db::init_library_db(&lib_db_path)?;

        let total_prepared = prepared.iter().filter(|p| p.is_ok()).count();
        let (duplicates, _non_dup_files) = crate::indexer::find_duplicates(&conn, &prepared)?;

        Ok(ImportPrepResult {
            duplicates,
            total_prepared,
        })
    })
    .await
    .map_err(|e| AppError::Import(format!("Import from paths failed: {e}")))?
}

#[tauri::command]
pub async fn import_commit_paths(
    library_id: String,
    paths: Vec<String>,
    actions: std::collections::HashMap<String, DedupAction>,
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<ImportResult, AppError> {
    let lib = with_registry_conn(&state, |conn| db::get_library(conn, &library_id))?;
    let lib_path = lib.path.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<ImportResult, AppError> {
        let prepared = crate::indexer::prepare_from_paths(&paths)?;
        let lib_db_path = Path::new(&lib_path).join(".shark").join("metadata.db");
        let conn = db::init_library_db(&lib_db_path)?;

        let (duplicates, mut non_dup_files) = crate::indexer::find_duplicates(&conn, &prepared)?;

        let mut kept_count = 0i64;
        let prepared_lookup: std::collections::HashMap<String, crate::indexer::PreparedFile> = prepared
            .into_iter()
            .filter_map(|p| p.ok())
            .map(|p| (p.source_path.to_string_lossy().to_string(), p))
            .collect();

        for (source_path, action) in &actions {
            if matches!(action, DedupAction::KeepBoth) {
                if let Some(pf) = prepared_lookup.get(source_path) {
                    non_dup_files.push(pf.clone());
                    kept_count += 1;
                }
            }
        }

        let skipped_count = duplicates.len() as i64 - kept_count;
        let dup_count = duplicates.len() as i64;

        let thumb_dir = Path::new(&lib_path).join(".shark").join("thumbnails");
        std::fs::create_dir_all(Path::new(&lib_path).join("images"))?;
        std::fs::create_dir_all(&thumb_dir)?;

        let counter = std::sync::atomic::AtomicUsize::new(0);
        let total = non_dup_files.len();
        let processed: Vec<(Item, Option<String>)> = non_dup_files
            .into_par_iter()
            .map(|pf| {
                let dest_path = crate::indexer::copy_to_library(&pf.source_path, Path::new(&lib_path), &pf.id)?;
                let thumb_path = crate::thumbnail::generate_thumbnail(&dest_path, &thumb_dir, &pf.id, 720).ok();

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

                let current = counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                let payload = serde_json::json!({
                    "current": current,
                    "total": total,
                    "item": item,
                    "thumbnailPath": thumb_str.as_deref(),
                });
                let _ = app.emit("import-progress", payload);

                Ok((item, thumb_str))
            })
            .collect::<Result<Vec<_>, AppError>>()?;

        conn.execute_batch("BEGIN")?;
        let insert_result: Result<(), AppError> = (|| {
            for (item, thumb_str) in &processed {
                crate::db::insert_item(&conn, item)?;
                if let Some(ref tp) = thumb_str {
                    crate::db::insert_thumbnail(&conn, &item.id, Some(tp), None)?;
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
            skipped: skipped_count,
            duplicates: dup_count,
        })
    })
    .await
    .map_err(|e| AppError::Import(format!("Import commit paths failed: {e}")))?
}

#[tauri::command]
pub fn query_items(
    library_id: String,
    filter: ItemFilter,
    sort: SortSpec,
    page: Pagination,
    state: State<'_, DbState>,
) -> Result<ItemPage, AppError> {
    let _ = library_id;
    with_library_conn(&state, |conn| db::query_items(conn, &filter, &sort, &page))
}

#[tauri::command]
pub fn get_item_detail(item_id: String, state: State<'_, DbState>) -> Result<Item, AppError> {
    with_library_conn(&state, |conn| db::get_item(conn, &item_id))
}

#[tauri::command]
pub fn delete_items(
    item_ids: Vec<String>,
    permanent: bool,
    state: State<'_, DbState>,
) -> Result<(), AppError> {
    with_library_conn(&state, |conn| db::delete_items(conn, &item_ids, permanent))
}

#[tauri::command]
pub fn get_thumbnail(
    item_id: String,
    size: ThumbnailSize,
    state: State<'_, DbState>,
) -> Result<String, AppError> {
    let size_str = match size {
        ThumbnailSize::S256 => "256",
        ThumbnailSize::S1024 => "1024",
    };
    let path = with_library_conn(&state, |conn| {
        db::get_thumbnail_path(conn, &item_id, size_str)?
            .ok_or_else(|| AppError::NotFound(format!("Thumbnail for {item_id}")))
    })?;
    let data = std::fs::read(&path)
        .map_err(|e| AppError::Io(format!("Failed to read thumbnail: {e}")))?;
    let b64 = STANDARD.encode(&data);
    Ok(format!("data:image/jpeg;base64,{b64}"))
}

#[tauri::command]
pub fn get_thumbnails_batch(
    item_ids: Vec<String>,
    size: ThumbnailSize,
    state: State<'_, DbState>,
) -> Result<HashMap<String, String>, AppError> {
    let size_str = match size {
        ThumbnailSize::S256 => "256",
        ThumbnailSize::S1024 => "1024",
    };
    // Step 1: Get paths from DB (under lock)
    let paths: HashMap<String, String> = with_library_conn(&state, |conn| {
        let mut map = HashMap::new();
        for id in &item_ids {
            if let Some(path) = db::get_thumbnail_path(conn, id, size_str)? {
                map.insert(id.clone(), path);
            }
        }
        Ok(map)
    })?;

    // Step 2: Read files and return as data URLs (no lock needed)
    let mut result = HashMap::new();
    for (id, path) in paths {
        if let Ok(data) = std::fs::read(&path) {
            let b64 = STANDARD.encode(&data);
            result.insert(id, format!("data:image/jpeg;base64,{b64}"));
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn search_items_cmd(
    library_id: String,
    query: String,
    limit: i32,
    state: State<'_, DbState>,
) -> Result<Vec<SearchResult>, AppError> {
    let _ = library_id;
    with_library_conn(&state, |conn| search::search_items(conn, &query, limit as i64))
}

#[tauri::command]
pub fn get_folders(library_id: String, state: State<'_, DbState>) -> Result<Vec<Folder>, AppError> {
    let _ = library_id;
    with_library_conn(&state, |conn| db::get_folders(conn))
}

#[tauri::command]
pub fn get_all_tags(
    library_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<String>, AppError> {
    let _ = library_id;
    with_library_conn(&state, |conn| db::get_all_tags(conn))
}

#[tauri::command]
pub fn update_item(
    item_id: String,
    tags: Option<String>,
    rating: Option<i64>,
    notes: Option<String>,
    state: State<'_, DbState>,
) -> Result<Item, AppError> {
    with_library_conn(&state, |conn| {
        db::update_item(
            conn,
            &item_id,
            tags.as_deref(),
            rating,
            notes.as_deref(),
        )
    })
}

#[tauri::command]
pub fn get_tag_counts(
    library_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<TagCount>, AppError> {
    let _ = library_id;
    with_library_conn(&state, |conn| db::get_tag_counts(conn))
}

#[tauri::command]
pub fn list_smart_folders(state: State<'_, DbState>) -> Result<Vec<SmartFolder>, AppError> {
    with_library_conn(&state, |conn| db::list_smart_folders(conn))
}

#[tauri::command]
pub fn get_smart_folder(id: String, state: State<'_, DbState>) -> Result<SmartFolder, AppError> {
    with_library_conn(&state, |conn| db::get_smart_folder(conn, &id))
}

#[tauri::command]
pub fn create_smart_folder(
    name: String,
    rules: String,
    parent_id: Option<String>,
    state: State<'_, DbState>,
) -> Result<SmartFolder, AppError> {
    with_library_conn(&state, |conn| {
        // Validate rules parse correctly
        let _: RuleGroup = serde_json::from_str(&rules)
            .map_err(|e| AppError::Database(format!("Invalid rules JSON: {e}")))?;
        db::create_smart_folder(conn, &name, &rules, parent_id.as_deref())
    })
}

#[tauri::command]
pub fn update_smart_folder(
    id: String,
    name: Option<String>,
    rules: Option<String>,
    parent_id: Option<Option<String>>,
    state: State<'_, DbState>,
) -> Result<SmartFolder, AppError> {
    with_library_conn(&state, |conn| {
        if let Some(ref r) = rules {
            let _: RuleGroup = serde_json::from_str(r)
                .map_err(|e| AppError::Database(format!("Invalid rules JSON: {e}")))?;
        }
        db::update_smart_folder(
            conn,
            &id,
            name.as_deref(),
            rules.as_deref(),
            parent_id.as_ref().map(|opt| opt.as_deref()),
        )
    })
}

#[tauri::command]
pub fn delete_smart_folder(id: String, state: State<'_, DbState>) -> Result<(), AppError> {
    with_library_conn(&state, |conn| db::delete_smart_folder(conn, &id))
}

#[tauri::command]
pub fn query_smart_folder_items(
    id: String,
    sort: SortSpec,
    page: Pagination,
    state: State<'_, DbState>,
) -> Result<ItemPage, AppError> {
    with_library_conn(&state, |conn| {
        let sf = db::get_smart_folder(conn, &id)?;
        db::query_smart_folder_items(conn, &sf.rules, &sort, &page)
    })
}

#[tauri::command]
pub fn preview_smart_folder(
    rules: String,
    state: State<'_, DbState>,
) -> Result<u64, AppError> {
    with_library_conn(&state, |conn| db::count_matching_items(conn, &rules))
}
