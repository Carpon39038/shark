mod commands;
mod db;
mod error;
mod indexer;
mod models;
mod search;
mod smart_folder;
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
            commands::import_prepare,
            commands::import_commit,
            commands::import_from_paths,
            commands::import_commit_paths,
            commands::query_items,
            commands::get_item_detail,
            commands::delete_items,
            commands::get_thumbnail,
            commands::get_thumbnails_batch,
            commands::search_items_cmd,
            commands::get_folders,
            commands::get_all_tags,
            commands::update_item,
            commands::get_tag_counts,
            commands::list_smart_folders,
            commands::get_smart_folder,
            commands::create_smart_folder,
            commands::update_smart_folder,
            commands::delete_smart_folder,
            commands::query_smart_folder_items,
            commands::preview_smart_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shark");
}
