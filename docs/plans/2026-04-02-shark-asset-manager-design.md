# Shark - Open Source Asset Manager Design

## Overview

Shark is an open-source alternative to Eagle, focused on speed and fluidity. Built with Tauri + React, using SQLite for metadata and filesystem for assets. All commercial features removed - pure local asset management.

## Tech Stack

- **Frontend:** React 18 + TypeScript + Zustand + Tailwind CSS
- **Backend:** Tauri v2 (Rust)
- **Database:** SQLite (WAL mode) via rusqlite
- **Virtual Scroll:** @tanstack/react-virtual
- **Image Processing:** Rust `image` crate
- **File Monitoring:** Rust `notify` crate

## Architecture

```
shark/
├── src-tauri/          # Rust backend
│   ├── src/
│   │   ├── main.rs     # Tauri entry
│   │   ├── db.rs       # SQLite management
│   │   ├── indexer.rs   # File indexing + monitoring
│   │   ├── thumbnail.rs # Thumbnail generation
│   │   ├── search.rs    # FTS5 full-text search
│   │   └── commands.rs  # Tauri IPC commands
│   └── Cargo.toml
├── src/                # React frontend
│   ├── App.tsx
│   ├── components/
│   │   ├── Grid/       # Virtual grid (core)
│   │   ├── Sidebar/    # Folder tree + tag panel
│   │   ├── Viewer/     # Image viewer
│   │   ├── Toolbar/    # Toolbar
│   │   └── Import/     # Import flow
│   ├── hooks/
│   ├── stores/         # Zustand stores
│   └── styles/         # Tailwind CSS
├── package.json
└── tauri.conf.json
```

## Data Model

### Database Architecture

Shark uses a **global registry database** + **per-library databases** approach:

- **Global registry DB** (`~/.shark/registry.db`): Stores the `libraries` table — a catalog of all registered libraries (name, path). Managed by the app-level `DbState`.
- **Per-library DB** (`<library_path>/.shark/metadata.db`): Stores all library-specific data — `items`, `folders`, `smart_folders`, `thumbnails`, `items_fts`, etc. When a library is opened, the app switches the active DB connection to that library's `metadata.db`.

### DbState Connection Management

```rust
struct DbState {
    registry: Mutex<Connection>,    // Always connected to ~/.shark/registry.db
    library: Mutex<Option<Connection>>,  // Connected to active library's metadata.db, or None
}
```

- **Registry connection** is established at startup and never replaced. Commands like `list_libraries`, `create_library` use this connection.
- **Library connection** is `None` until `open_library` is called, then set to the library's `metadata.db`. Switching libraries replaces this connection.
- **Thread safety:** Each connection is behind its own `Mutex`. The registry Mutex is never contended during a library switch — commands targeting the registry (e.g., `list_libraries`) can run concurrently with library operations. A library switch (replacing `library`) only blocks other library-scoped commands, not registry commands.
- **IPC `library_id` parameter:** Commands that operate on library data (e.g., `query_items`, `search_items`) take `library_id` to identify which library DB to use. This parameter is used for routing only — it is NOT stored in per-library tables.

Each library's DB is self-contained. Since every record in a per-library DB inherently belongs to that library, per-library tables (`items`, `folders`, `smart_folders`) do NOT include a `library_id` column. The IPC layer still takes `library_id` as a parameter to identify which DB connection to use, but the value is not stored in each row.

> **Schema note:** The `libraries` table exists in the global registry DB only. Per-library DBs contain `items`, `folders`, `smart_folders`, `thumbnails`, and `items_fts` — all without `library_id` columns.

### SQLite Schema

```sql
-- Global registry DB (registry.db)
CREATE TABLE libraries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Per-library DB (metadata.db)
CREATE TABLE items (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    file_type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    duration REAL,        -- reserved for video support (Post-MVP)
    color TEXT,
    tags TEXT,            -- comma-separated for MVP; migrate to tags table later
    rating INTEGER DEFAULT 0,
    notes TEXT,
    sha256 TEXT,           -- content hash for deduplication
    status TEXT DEFAULT 'active',  -- 'active' | 'missing' | 'corrupted'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- High-frequency query indexes
CREATE INDEX idx_items_file_type ON items(file_type);
CREATE INDEX idx_items_rating ON items(rating);
CREATE INDEX idx_items_created_at ON items(created_at);
CREATE INDEX idx_items_sha256 ON items(sha256);
CREATE UNIQUE INDEX idx_items_file_path ON items(file_path);

CREATE TABLE smart_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    rules TEXT NOT NULL,   -- JSON-serialized filter rules (see Smart Folder Rules)
    parent_id TEXT REFERENCES smart_folders(id)
);

CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES folders(id),
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE item_folders (
    item_id TEXT REFERENCES items(id),
    folder_id TEXT REFERENCES folders(id),
    PRIMARY KEY (item_id, folder_id)
);

-- Full-text search with content sync triggers
-- IMPORTANT: items table must NOT use WITHOUT ROWID and must NOT be rebuilt (DROP + CREATE).
-- Doing so would corrupt the FTS5 content=items index since FTS relies on items.rowid.
-- To rebuild items, first drop items_fts, rebuild items, then recreate items_fts and run 'rebuild'.
CREATE VIRTUAL TABLE items_fts USING fts5(
    file_name, tags, notes,
    content=items, content_rowid=rowid
);

-- Keep FTS index in sync with items table
CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
    INSERT INTO items_fts(rowid, file_name, tags, notes)
    VALUES (new.rowid, new.file_name, new.tags, new.notes);
END;
CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
    INSERT INTO items_fts(items_fts, rowid, file_name, tags, notes)
    VALUES ('delete', old.rowid, old.file_name, old.tags, old.notes);
END;
CREATE TRIGGER items_au AFTER UPDATE ON items BEGIN
    INSERT INTO items_fts(items_fts, rowid, file_name, tags, notes)
    VALUES ('delete', old.rowid, old.file_name, old.tags, old.notes);
    INSERT INTO items_fts(rowid, file_name, tags, notes)
    VALUES (new.rowid, new.file_name, new.tags, new.notes);
END;

CREATE TABLE thumbnails (
    item_id TEXT PRIMARY KEY REFERENCES items(id),
    thumb_256_path TEXT,      -- path to 256px thumbnail
    thumb_1024_path TEXT,     -- path to 1024px thumbnail
    width INTEGER,
    height INTEGER,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tags Storage Decision

Tags are stored as comma-separated TEXT in the `items` table for MVP simplicity. This avoids JOIN overhead for the most common query pattern (display tags per item in the grid). Trade-offs:

- **Pros:** Simple reads, no JOIN needed for grid display, FTS5 indexes it directly
- **Cons:** No efficient tag aggregation queries (e.g., "count items per tag")
- **Migration path:** A future `tags` + `item_tags` normalization can be added when tag-based analytics becomes a priority

### Smart Folder Rules Format

The `rules` field in `smart_folders` stores a JSON object:

```json
{
  "operator": "AND",
  "conditions": [
    { "field": "file_type", "op": "in", "value": ["jpg", "png"] },
    { "field": "rating", "op": ">=", "value": 3 },
    { "field": "tags", "op": "contains", "value": "landscape" },
    { "field": "width", "op": ">=", "value": 1920 },
    { "field": "created_at", "op": "between", "value": ["2025-01-01", "2025-12-31"] }
  ]
}
```

The Rust backend parses this JSON and translates it into parameterized SQL WHERE clauses. Supported operators: `eq`, `neq`, `in`, `not_in`, `contains`, `gt`, `gte`, `lt`, `lte`, `between`.

> **Security:** All rule values MUST be bound via parameterized queries (`?` placeholders). Never interpolate user-provided values into SQL strings. The `field` name must be validated against an explicit allowlist of column names before use — do not trust the JSON input directly.

### Filesystem Structure (Library)

```
~/SharkLibrary/
├── .shark/
│   ├── metadata.db
│   ├── thumbs/
│   │   ├── 256/
│   │   └── 1024/
│   └── trash/
├── images/
│   ├── abc123.png
│   └── def456.jpg
└── ...
```

## State Management

### Zustand Store Structure

```
stores/
├── libraryStore.ts      # Current library, library list
├── itemStore.ts         # Current items query result, selection state
├── filterStore.ts       # Active filters, sort, search query
├── viewStore.ts         # Grid/List mode, thumbnail size, sidebar visibility
└── uiStore.ts           # Modal state, context menu, drag state
```

| Store | Scope | Persisted? |
|-------|-------|------------|
| libraryStore | Global | Yes (localStorage) |
| itemStore | Gallery page | No |
| filterStore | Gallery page | Yes (localStorage) |
| viewStore | Global | Yes (localStorage) |
| uiStore | Transient | No |

Rule of thumb: component-local state (hover, input focus, animation) stays in `useState`. Only state that is shared across components or survives navigation goes into Zustand.

## IPC Interface (Tauri Commands)

> **Note:** All command signatures below show the logical interface (what the frontend calls). In implementation, every command also takes a `state: State<'_, DbState>` parameter for Tauri state management, which is omitted here for clarity.

```rust
// Library management
#[tauri::command] fn create_library(name: String, path: String) -> Result<Library, AppError>
#[tauri::command] fn open_library(path: String) -> Result<Library, AppError>
#[tauri::command] fn list_libraries() -> Result<Vec<Library>, AppError>

// Item queries
#[tauri::command] fn query_items(library_id: String, filter: ItemFilter, sort: SortSpec, page: Pagination) -> Result<ItemPage, AppError>  // library_id selects which DB connection to use; not stored in items
#[tauri::command] fn get_item_detail(item_id: String) -> Result<Item, AppError>  // Phase 1 returns Item; future phases may add EXIF/metadata for an extended ItemDetail type
#[tauri::command] fn update_item(item_id: String, updates: ItemUpdates) -> Result<(), AppError>
#[tauri::command] fn delete_items(item_ids: Vec<String>, permanent: bool) -> Result<(), AppError>

// Import
#[tauri::command] fn import_files(library_id: String, sources: Vec<String>, mode: ImportMode, options: ImportOptions) -> Result<ImportResult, AppError>  // Phase 1 simplifies to: import_files(library_id: String, source_path: String) — single source, copy mode only. Full signature deferred to Phase 3.

// Thumbnails
#[tauri::command] fn get_thumbnail(item_id: String, size: ThumbnailSize) -> Result<String, AppError>  // returns local file path; frontend converts via convertFileSrc()

// Search
#[tauri::command] fn search_items(library_id: String, query: String, limit: i32) -> Result<Vec<SearchResult>, AppError>

// Tags & Folders
#[tauri::command] fn get_all_tags(library_id: String) -> Result<Vec<TagCount>, AppError>
#[tauri::command] fn get_folder_tree(library_id: String) -> Result<Vec<FolderNode>, AppError>
#[tauri::command] fn save_smart_folder(library_id: String, name: String, rules: String) -> Result<SmartFolder, AppError>

// System
#[tauri::command] fn get_system_stats(library_id: String) -> Result<LibraryStats, AppError>
```

All commands return `Result<T, AppError>` where `AppError` is a serializable error struct with `code`, `message`, and optional `details`.

## Thumbnail Strategy

### Two-tier thumbnails

| Size | Generated on | Used by | Format |
|------|-------------|---------|--------|
| 256px | Import time | Grid view (default) | JPEG, quality 85 |
| 1024px | On-demand, background | Grid view (zoomed in), Viewer preview | JPEG, quality 90 | **(Deferred post-1.0)**

### Loading flow

1. Grid renders → request 256px thumbnails for visible items + 1 page lookahead
2. User zooms grid or opens Viewer → request 1024px thumbnail
3. Viewer full-res → stream original file via Tauri asset protocol

### Cache eviction

- Thumbnails are stored as files in `.shark/thumbs/{256,1024}/`
- Max disk usage per size tier: 2GB (configurable)
- LRU eviction when threshold exceeded, tracked via `generated_at` timestamp
- Missing thumbnail on load → generate synchronously for visible items, queue for off-screen

### Tauri v2 Asset Protocol

Thumbnails and original images are served via Tauri's asset protocol (`convertFileSrc()`). In Tauri v2, the asset protocol requires explicit scope configuration in `tauri.conf.json`:

```json
{
  "security": {
    "assetProtocol": {
      "enable": true,
      "scope": {
        "allow": ["**"],
        "deny": []
      }
    }
  }
}
```

For production, scope should be restricted to library paths only. The frontend uses `convertFileSrc()` from `@tauri-apps/api/core` (Tauri v2 path, not `@tauri-apps/api`) to generate accessible URLs for local file paths.

## Error Handling & Data Integrity

### Database migration

- Schema version tracked via `PRAGMA user_version` (built-in SQLite mechanism, no extra table needed)
- Migrations run in `main.rs` Tauri `setup` hook, sequentially, within a transaction
- Each migration increments `user_version` and is a numbered SQL file embedded at compile time
- On failure: rollback transaction, log error, show user dialog with option to retry or open library in safe mode

### File corruption / missing files

- On startup: quick integrity check (spot-check 100 random items) to detect missing files
- Missing file: mark item as `status = 'missing'` (add to items table), show placeholder in grid
- User can re-link or delete missing items
- Corrupted thumbnail: regenerate from original; if original also corrupted, mark as missing

### Backup

- Database WAL checkpoint on app quit
- Optional: export library metadata as JSON (for manual backup)

## Core Modules

### 1. Virtual Grid

- @tanstack/react-virtual for rendering
- Dynamic columns based on window width
- Lazy thumbnail loading (preload 200ms before viewport entry)
- Drag selection for multi-select
- Right-click context menu
- 60fps scrolling with 100k+ items, < 500MB memory

### 2. Indexing Engine (Rust)

- First import: walkdir + rayon parallel traversal, EXIF extraction
- Incremental: notify crate for filesystem events
- Supported formats (MVP): JPG, PNG, GIF, WebP, BMP
- Future: SVG (requires resvg), PSD, AI, Sketch, TIFF, video, font
- Thumbnail generation: image crate async, concurrency-limited
- Color extraction: pixel sampling + clustering (see Color Extraction)

### 3. Search & Filter

- FTS5 instant search, < 200ms
- Multi-tag AND/OR combination
- Attribute filters: type, color, dimensions, date range, rating
- Sort: name/date/size/dimensions/color, asc/desc
- Smart folders: saved filter queries

### 4. Import System

- Drag & drop from file manager / browser
- Clipboard paste
- Folder import with optional directory structure preservation
- Import modes: copy / move / reference
- SHA256 deduplication (content-based; see Dedup Strategy)

### 5. Viewer

- Full-screen with zoom/pan
- Arrow key navigation
- EXIF info panel
- Quick tag/rate

## Performance Targets

- 100k images library: < 200ms search
- Grid scroll: 60fps
- App startup: < 1s
- Import speed: > 500 images/sec (SSD)
- Memory: < 500MB for 100k library

## Color Extraction

- **Algorithm:** K-means clustering (k=5) in Lab color space
- **Pipeline:** Resize to 100px max dimension → sample every pixel → K-means → pick top 3 dominant colors → store as hex string (comma-separated)
- **Why Lab:** Perceptually uniform — clusters group colors that *look* similar, unlike RGB
- **Why K-means over median-cut:** Simpler implementation, sufficient quality for 3-color extraction, runs in <5ms per image at 100px

## Import Dedup Strategy

1. On import, compute SHA256 hash of each file
2. Check `items.sha256` index for existing match (content-based dedup, not filename)
3. **Duplicate found → show dialog:**
   - Skip (keep existing)
   - Replace (delete existing, import new)
   - Keep both (import as new item with same hash)
   - Apply to all (checkbox for batch decision)
4. Hash is computed during import in a rayon thread pool (one per file, parallelized)

## Testing Strategy

### Rust backend

- **Unit tests:** `#[test]` in each module — db.rs (schema creation, migrations), search.rs (FTS queries), thumbnail.rs (resize logic)
- **Integration tests:** `tests/` directory — full import → query → delete lifecycle against a temp SQLite database
- **Test database:** Use `:memory:` SQLite for unit tests, temp file for integration tests
- **Coverage target:** Critical paths (import, search, dedup, migration) at 80%+

### React frontend

- **Unit tests:** Vitest for store logic (Zustand stores), utility functions
- **Component tests:** React Testing Library for Grid, Sidebar, Viewer — verify rendering with mock IPC
- **E2E (post-MVP):** Playwright against Tauri webview for critical flows

## Packaging & Distribution

- **Tauri bundler:** NSIS installer (Windows), DMG (macOS), AppImage (Linux)
- **Auto-update:** Tauri's built-in updater with GitHub Releases as the update source
  - Check on startup (configurable)
  - Background download, prompt to install on next launch
  - Signed updates (code signing setup per-platform)
- **Minimum runtime:** No external dependencies — Tauri bundles WebView2 (Windows), uses system WebKit (macOS/Linux)

## MVP Milestones

### Phase 1 — Core Viewer (Weeks 1-2)

- Project scaffolding (Tauri + React + SQLite setup)
- Schema + migrations framework
- Library creation/opening
- Folder import (copy mode only)
- Thumbnail generation (256px)
- Virtual grid with basic scroll
- Single image viewer

### Phase 2 — Organization (Weeks 3-4)

- Tags (add/remove/search)
- Folder tree in sidebar
- Drag & drop import
- FTS5 search
- Color extraction
- Rating + notes
- Multi-select + batch operations

### Phase 3 — Polish & Ship (Weeks 5-6)

- Smart folders
- Import modes (move/reference)
- Dedup dialog
- ~~1024px thumbnails + on-demand generation~~ **(Deferred: 不做 1.0，Viewer 直接用原图)**
- Error handling (missing files, corruption)
- Performance optimization (100k benchmark)
- Packaging (installer per platform)
- Basic auto-update setup

### Post-MVP Backlog

- Video support (thumbnails + playback)
- PSD/AI/Sketch format support
- Advanced metadata (EXIF panel, GPS map)
- Color-based search
- Batch rename / metadata editing
- Plugin system

## Out of Scope (Removed Commercial Features)

- Eagle community / resource store
- Cloud sync / team collaboration
- License validation
- Online accounts
- Paid feature gating
