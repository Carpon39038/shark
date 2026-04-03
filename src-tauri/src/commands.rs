use std::collections::HashMap;
use std::path::Path;

use rusqlite::Connection;
use tauri::State;

use crate::db::{self, DbState};
use crate::error::AppError;
use crate::models::*;
use crate::search;

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
pub fn import_files(
    library_id: String,
    source_path: String,
    state: State<'_, DbState>,
) -> Result<ImportResult, AppError> {
    let lib = with_registry_conn(&state, |conn| db::get_library(conn, &library_id))?;

    let guard = state
        .library
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::NoActiveLibrary)?;

    crate::indexer::import_directory(conn, Path::new(&lib.path), Path::new(&source_path))
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
    with_library_conn(&state, |conn| {
        db::get_thumbnail_path(conn, &item_id, size_str)?
            .ok_or_else(|| AppError::NotFound(format!("Thumbnail for {item_id}")))
    })
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
    with_library_conn(&state, |conn| {
        let mut map = HashMap::new();
        for id in &item_ids {
            if let Some(path) = db::get_thumbnail_path(conn, id, size_str)? {
                map.insert(id.clone(), path);
            }
        }
        Ok(map)
    })
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
