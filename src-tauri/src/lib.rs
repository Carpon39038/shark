mod commands;
mod db;
mod error;
mod indexer;
mod models;
mod search;
mod thumbnail;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).ok();

            let registry_path = app_dir.join("registry.db");
            let db_state =
                db::DbState::new(&registry_path).expect("Failed to initialize database");

            app.manage(db_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_library,
            commands::open_library,
            commands::list_libraries,
            commands::import_files,
            commands::query_items,
            commands::get_item_detail,
            commands::delete_items,
            commands::get_thumbnail,
            commands::get_thumbnails_batch,
            commands::search_items_cmd,
            commands::get_folders,
            commands::get_all_tags,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shark");
}
