# Phase 1 Implementation Plan — Core Viewer

## Overview

Phase 1 delivers the minimal functional loop: create a library → import a folder → browse thumbnails in a virtual grid → view a single image. Backend-first approach: complete Rust backend with tests, then React frontend.

## Pre-requisites

- Node.js 18+, Rust toolchain (stable), pnpm
- Target: macOS primary (Windows/Linux secondary)

---

## Step 1: Project Scaffolding

### What
Initialize Tauri v2 + React + TypeScript project with all dependencies.

### Files
- `package.json` — pnpm, dependencies
- `Cargo.toml` — Rust dependencies
- `vite.config.ts` — Tauri mode + Tailwind v4 plugin + path aliases
- `tsconfig.json` — strict, ES2021, path aliases
- `tauri.conf.json` — window config, asset protocol
- `src/main.css` — Tailwind v4 entry (`@import "tailwindcss"`)
- `src/main.tsx` — React entry
- Directory skeleton: `src-tauri/src/`, `src/components/`, `src/stores/`, `src/hooks/`, `src/lib/`

### Dependencies

**Frontend (pnpm):**
- `@tauri-apps/api` — IPC
- `@tauri-apps/plugin-dialog` — file dialog
- `@tanstack/react-virtual` — virtual scroll
- `zustand` — state management
- `tailwindcss @tailwindcss/vite` — styling

**Rust (Cargo.toml):**
- `rusqlite` 0.31 — features: bundled, fts5, hooks, functions, vtab, serde_json
- `image` 0.25 — thumbnail generation
- `rayon` 1.11 — parallel processing
- `walkdir` — directory traversal
- `sha2` — SHA256 hashing
- `uuid` — ID generation (v4)
- `notify` 8 + `notify-debouncer-full` 0.7 — file watching (infrastructure only in Phase 1)
- `thiserror` — error types
- `serde` + `serde_json` — serialization
- `tokio` 1 — async runtime (Tauri v2 already provides tokio; only add if needed for specific features, no full features)

### Commands
```bash
pnpm create tauri-app shark --template react-ts
cd shark && pnpm install
pnpm add @tauri-apps/api @tauri-apps/plugin-dialog @tanstack/react-virtual zustand
pnpm add -D tailwindcss @tailwindcss/vite
# Rust deps added via cargo add in src-tauri/
```

### Verification
`pnpm tauri dev` launches a window with React app rendering "Shark".

---

## Step 2: Rust Error Types + Models

### What
Define all shared data types and error handling.

### Files
- `src-tauri/src/error.rs`
- `src-tauri/src/models.rs`

### Details

**error.rs:**
```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),
    #[error("File not found: {0}")]
    NotFound(String),
    #[error("Import error: {0}")]
    Import(String),
    #[error("IO error: {0}")]
    Io(String),
}
// impl Serialize for Tauri IPC
```

**models.rs:**
- `Library` { id, name, path, created_at }
- `Item` { id, library_id, file_path, file_name, file_size, file_type, width, height, tags, rating, notes, sha256, status, created_at, modified_at }
- `ItemFilter` { folder_id, file_types, rating_min, search_query }
- `SortSpec` { field, direction }
- `Pagination` { page, page_size }
- `ItemPage` { items: Vec<Item>, total, page, page_size }
- `ImportResult` { imported, skipped, duplicates }
- `ThumbnailSize` enum { S256, S1024 }
- `LibraryStats` { total_items, total_size, by_type breakdown }
- `SearchResult` { item: Item, rank: f64 }

All types derive `Serialize`, `Deserialize`, `Clone`, `Debug`.

### Verification
`cargo check` passes.

---

## Step 3: Database Layer (db.rs)

### What
SQLite schema, migrations, connection management.

### Files
- `src-tauri/src/db.rs`

### Details

**Connection management:**
- `init_db(path: &Path) -> Result<Connection>` — open, WAL, foreign_keys, synchronous=NORMAL
- Connection wrapped in `Mutex<Connection>` managed via Tauri state

**Migrations (V1):**
Full schema from design doc:
- `libraries` table
- `items` table + indexes (library_id, file_type, rating, created_at, sha256)
- `folders`, `item_folders` tables
- `smart_folders` table
- `thumbnails` table
- `items_fts` FTS5 virtual table + sync triggers (items_ai, items_ad, items_au)

Migration uses `user_version` pragma for version tracking.

**Helper functions:**
- `create_library(conn, name, path)` — INSERT into libraries + create directory structure
- `get_library(conn, id)` — SELECT library
- `insert_item(conn, item)` — INSERT + FTS trigger fires
- `query_items(conn, library_id, filter, sort, pagination)` — parameterized query with dynamic ORDER BY
- `get_item(conn, id)` — SELECT single item
- `delete_item(conn, id, permanent)` — DELETE or UPDATE status
- `get_all_tags(conn, library_id)` — parse comma-separated tags from items

### Tests
- `test_schema_creation` — in-memory DB, verify all tables exist
- `test_migration_idempotent` — run migrations twice, no error
- `test_insert_and_query_item` — insert item, query back, verify fields
- `test_fts_search` — insert items, search, verify FTS results

### Verification
`cargo test` passes all db tests.

---

## Step 4: Thumbnail Generation (thumbnail.rs)

### What
Generate 256px WebP thumbnails from source images.

### Files
- `src-tauri/src/thumbnail.rs`

### Details

**Core function:**
```rust
pub fn generate_thumbnail(
    src_path: &Path,
    thumb_dir: &Path,
    size: u32,  // 256 for Phase 1
) -> Result<PathBuf>
```

- Opens image with `image::open()`
- Uses `imageops::thumbnail()` for fast downscaling
- Outputs JPEG via `DynamicImage::write_to(..., ImageFormat::Jpeg)` with quality 85
- Saves to `thumb_dir/{item_id}.jpg`
- Creates `thumb_dir` if not exists

**Supported formats (MVP):** JPG, PNG, GIF, WebP, BMP
- BMP: supported by `image` crate

**Error handling:** corrupted/unreadable files return `AppError::Io`, caller marks item as `status = 'corrupted'`

### Tests
- `test_generate_thumbnail_jpg` — create temp image, generate thumb, verify exists
- `test_generate_thumbnail_png` — same for PNG
- `test_corrupted_file` — feed invalid data, verify error

### Verification
`cargo test` passes thumbnail tests.

---

## Step 5: Import Engine (indexer.rs)

### What
Walk directories, hash files, copy to library, generate thumbnails, write metadata to DB.

### Files
- `src-tauri/src/indexer.rs`

### Details

**Main function:**
```rust
pub fn import_directory(
    conn: &Mutex<Connection>,
    library_path: &Path,
    source_path: &Path,
) -> Result<ImportResult>
```

**Pipeline (per file, parallelized via rayon):**
1. `walkdir::WalkDir` collects all image files recursively
2. `rayon::par_iter` processes files in parallel:
   - Compute SHA256 hash (`sha2` crate)
   - Check for duplicates (query sha256 index)
   - Copy file to `library/images/{uuid}.{ext}`
   - Extract dimensions via `image` crate
   - Generate 256px thumbnail
3. Batch insert items into DB (single-threaded, inside Mutex lock)

**Phase 1 constraints:**
- Copy mode only (no move/reference)
- No progress reporting yet (add Channel in Phase 2)
- Skip duplicates silently (dialog comes in Phase 3)

### Tests
- `test_import_directory` — create temp dir with 3 images, import, verify DB has 3 items + thumbnails
- `test_import_dedup` — import same file twice, verify second is skipped
- `test_import_mixed_formats` — JPG + PNG + GIF, verify all imported

### Verification
`cargo test` passes indexer tests with real temp files.

---

## Step 6: Tauri IPC Commands (commands.rs)

### What
Expose Rust functions as Tauri commands callable from frontend.

### Files
- `src-tauri/src/commands.rs`

### Commands (Phase 1 scope)
```rust
#[tauri::command] fn create_library(name: String, path: String, state: State<'_, DbState>) -> Result<Library, AppError>
#[tauri::command] fn open_library(path: String, state: State<'_, DbState>) -> Result<Library, AppError>
#[tauri::command] fn list_libraries(state: State<'_, DbState>) -> Result<Vec<Library>, AppError>
#[tauri::command] fn import_files(library_id: String, source_path: String, state: State<'_, DbState>) -> Result<ImportResult, AppError>
#[tauri::command] fn query_items(library_id: String, filter: ItemFilter, sort: SortSpec, page: Pagination, state: State<'_, DbState>) -> Result<ItemPage, AppError>
#[tauri::command] fn get_item_detail(item_id: String, state: State<'_, DbState>) -> Result<Item, AppError>
#[tauri::command] fn delete_items(item_ids: Vec<String>, permanent: bool, state: State<'_, DbState>) -> Result<(), AppError>
#[tauri::command] fn get_thumbnail_path(item_id: String, size: ThumbnailSize, state: State<'_, DbState>) -> Result<String, AppError>
#[tauri::command] fn search_items(library_id: String, query: String, limit: i32, state: State<'_, DbState>) -> Result<Vec<SearchResult>, AppError>
```

Each command:
- Takes `State<'_, DbState>` parameter
- Delegates to db.rs / indexer.rs / thumbnail.rs
- Returns `Result<T, AppError>` (AppError auto-serialized)

### Verification
`pnpm tauri dev` — can invoke commands from browser console.

---

## Step 6b: Search Module (search.rs)

### What
FTS5 full-text search backend. Phase 1 already creates the FTS5 virtual table and sync triggers in db.rs — this module provides the query interface so that infrastructure isn't wasted.

### Files
- `src-tauri/src/search.rs`

### Details

```rust
pub fn search_items(
    conn: &Connection,
    library_id: &str,
    query: &str,
    limit: i32,
) -> Result<Vec<SearchResult>>
```

- Joins `items_fts` with `items` table to return full Item data
- Uses FTS5 `MATCH` with prefix support (`query*`)
- Returns items ranked by FTS5 relevance
- Validates/sanitizes query to prevent FTS5 syntax errors
- Basic search by file_name, tags, notes (as defined by FTS5 columns)

**SearchResult** model: `{ item: Item, rank: f64 }`

### Tests
- `test_basic_search` — insert items, search by filename, verify results
- `test_tag_search` — search by tag content
- `test_empty_query` — verify empty results for empty/whitespace query
- `test_no_results` — verify empty results for non-matching query

### Add to commands.rs
```rust
#[tauri::command] fn search_items(library_id: String, query: String, limit: i32, state: State<'_, DbState>) -> Result<Vec<SearchResult>, AppError>
```

### Verification
`cargo test` passes search tests. Search command callable from frontend.

---

## Step 7: Main Assembly (main.rs)

### What
Wire everything together in Tauri setup.

### Files
- `src-tauri/src/main.rs`

### Details
```rust
fn main() {
    Builder::default()
        .setup(|app| {
            // 1. Resolve app data dir
            // 2. Open global DB (library registry)
            // 3. Run migrations
            // 4. Manage DbState
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_library, open_library, list_libraries,
            import_files, query_items, get_item_detail,
            delete_items, get_thumbnail_path, search_items,
        ])
        .run(tauri::generate_context!())
        .expect("error running Shark");
}
```

Window config in `tauri.conf.json`:
- Title: "Shark"
- Size: 1200x800
- Resizable: true
- Asset protocol: enabled for thumbnail serving
- Tauri v2 requires explicit scope in `tauri.conf.json`:
  ```json
  "security": {
    "assetProtocol": {
      "enable": true,
      "scope": { "allow": ["**"], "deny": [] }
    }
  }
  ```

### Verification
`pnpm tauri dev` launches window without errors. Rust backend functional.

---

## Step 8: Frontend Foundation (types + hooks + stores)

### What
TypeScript types, IPC hook, and all 5 Zustand stores.

### Files
- `src/lib/types.ts`
- `src/hooks/useInvoke.ts`
- `src/stores/libraryStore.ts`
- `src/stores/itemStore.ts`
- `src/stores/filterStore.ts`
- `src/stores/viewStore.ts`
- `src/stores/uiStore.ts`

### Details

**types.ts** — mirrors Rust models: Library, Item, ItemFilter, SortSpec, Pagination, ItemPage, ImportResult, ThumbnailSize

**useInvoke.ts** — generic hook with loading/error/data states

**Stores:**
| Store | Key fields | Persisted |
|-------|-----------|-----------|
| libraryStore | libraries[], activeLibraryId | Yes |
| itemStore | items[], selectedIds, loading | No |
| filterStore | sortBy, sortOrder, searchQuery | Yes |
| viewStore | gridSize, sidebarOpen | Yes |
| uiStore | viewerOpen, viewerItemId, contextMenu | No |

### Verification
App compiles and renders. Stores initialize correctly.

---

## Step 9: App Layout + Toolbar

### What
Main layout structure and top toolbar.

### Files
- `src/App.tsx`
- `src/components/Toolbar/Toolbar.tsx`
- `src/components/Import/ImportButton.tsx`

### Details
- Layout: horizontal flex — [Sidebar?] | [Grid | Viewer overlay]
- Toolbar: library name, import button, view controls, search placeholder
- Sidebar toggle button
- Import button (from `Import/ImportButton.tsx`, rendered in toolbar) calls `@tauri-apps/plugin-dialog` to pick folder, then invokes `import_files`

### Verification
App renders with toolbar. Import button opens native file dialog.

---

## Step 10: Sidebar

### What
Library selector + basic folder list.

### Files
- `src/components/Sidebar/Sidebar.tsx`
- `src/components/Sidebar/LibrarySelector.tsx`
- `src/components/Sidebar/FolderList.tsx`

### Details
- Library selector: dropdown of registered libraries
- Folder list: flat list of folders in current library
- Click folder → filter grid items
- Phase 1: no drag-drop, no tree nesting

### Verification
Sidebar shows library list. Clicking folder filters grid.

---

## Step 11: Virtual Grid (Core UI)

### What
The main grid with virtual scrolling, thumbnail loading, selection.

### Files
- `src/components/Grid/VirtualGrid.tsx`
- `src/components/Grid/AssetCard.tsx`

### Details

**VirtualGrid.tsx:**
- `useVirtualizer` with `lanes` for multi-column grid
- `ResizeObserver` for dynamic column count (card width ~200px)
- `overscan: 5` rows
- Renders rows of `AssetCard` components

**AssetCard.tsx:**
- `React.memo` wrapped
- Shows thumbnail via `convertFileSrc(thumbPath)`
- Click → select (single, Ctrl+click multi, Shift+click range)
- Double-click → open viewer
- Shows file name below thumbnail
- Selected state: blue border highlight

**Data flow:**
- `itemStore.items` → VirtualGrid
- `filterStore` changes → re-query via `query_items` command
- Scroll position tracked by `useVirtualizer`

### Verification
Import a folder of 100+ images. Grid scrolls smoothly at 60fps.

---

## Step 12: Image Viewer

### What
Full-screen single image viewer.

### Files
- `src/components/Viewer/ImageViewer.tsx`

### Details
- Modal overlay (z-50, bg-black)
- Loads original file via `convertFileSrc(item.file_path)`
- Left/Right arrow keys navigate prev/next in current item list
- Escape closes viewer
- Shows file name + dimensions at bottom
- Phase 1: no zoom/pan, no EXIF panel

### Verification
Double-click grid item → viewer opens with full image. Arrow keys navigate. ESC closes.

---

## Step 13: Import Flow

### What
End-to-end import UX with progress feedback.

### Files
- `src/components/Import/ImportButton.tsx` (enhanced with progress feedback from Step 9's basic version)
- `src/components/Import/ImportProgress.tsx`

### Details
- ImportButton: open folder dialog → invoke `import_files`
- ImportProgress: overlay showing "Importing... X/Y files"
- On complete: refresh itemStore, show toast "Imported N items"
- Error handling: show error message if import fails

### Verification
Select folder with images → import runs → grid shows new items.

---

## Step 14: End-to-End Verification

### What
Manual smoke test + performance baseline.

### Checklist
- [ ] Launch app → clean state
- [ ] Create a new library
- [ ] Import a folder with 100+ images (mixed JPG/PNG)
- [ ] Grid renders all thumbnails, scroll is smooth
- [ ] Click item → selected state
- [ ] Double-click → viewer opens, arrows navigate
- [ ] Close viewer → back to grid
- [ ] Import another folder → grid updates
- [ ] Restart app → library persists, items reload
- [ ] Memory usage < 500MB with 100+ items
- [ ] Grid scroll maintains 60fps

---

## Step Dependency Graph

```
Step 1 (scaffold)
  └─→ Step 2 (error+models)
       └─→ Step 3 (db.rs)
            ├─→ Step 4 (thumbnail.rs)
            │    └─→ Step 5 (indexer.rs)
            │         └─→ Step 6 (commands.rs)
            │              └─→ Step 6b (search.rs)
            │                   └─→ Step 7 (main.rs)
            └─→ Step 6 (commands.rs)
  └─→ Step 8 (frontend foundation)
       └─→ Step 9 (layout+toolbar)
            ├─→ Step 11 (virtual grid)
            │    ├─→ Step 10 (sidebar) ← needs grid for folder-filter verification
            │    └─→ Step 12 (viewer)
            └─→ Step 13 (import flow)
                 └─→ Step 14 (E2E verification)
```

## Estimated Complexity

| Step | Files | Complexity | Key Risk |
|------|-------|-----------|----------|
| 1. Scaffold | 6 | Low | Tauri v2 CLI compatibility |
| 2. Error+Models | 2 | Low | None |
| 3. DB Layer | 1 | Medium | FTS5 trigger correctness |
| 4. Thumbnails | 1 | Medium | JPEG quality vs file size tradeoff |
| 5. Importer | 1 | High | Rayon + Mutex contention |
| 6. Commands | 1 | Low | Boilerplate |
| 6b. Search | 1 | Medium | FTS5 query correctness |
| 7. Main | 1 | Low | Setup hook ordering |
| 8. Frontend Base | 7 | Medium | Store type safety |
| 9. Layout | 3 | Low | None |
| 10. Sidebar | 3 | Low | None |
| 11. Virtual Grid | 2 | High | 60fps at scale |
| 12. Viewer | 1 | Medium | Key event handling |
| 13. Import UX | 2 | Low | Progress feedback |
| 14. E2E Test | 0 | Low | Manual verification |
