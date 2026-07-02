# Auto-Import (Watched Folder) Design

## Overview

Add an **Auto-Import** feature: Shark watches a single external folder the user
designates, and whenever image files appear in it, imports copies into the
current library automatically — no manual drag/drop needed. The user drops files
into the watched folder from anywhere, and they show up in the library.

This follows a well-established asset-manager pattern, with these deliberate
constraints:

- **One** watched folder (not multi-folder). Keeps config and UI trivial.
- **Local drives only** — reject network paths.
- Validate the path exists before enabling.
- Additions only. This is a *drop-zone → import* model, **not** a two-way mirror:
  deleting a file from the watched folder does **not** delete the library item.

Explicitly **out of scope** here (tracked separately in the roadmap):

- Watching the library's own `images/` directory to mark externally-deleted files
  as `missing`. That is a different concern (`ItemStatus::Missing`, integrity
  scan) and is not part of "auto-import".
- Move/reference import modes. Auto-import uses **copy** (matches Shark's existing
  import — source files stay put).

## Why per-library config

A watched folder is a property of *a library* ("drop here to fill this library"),
and Shark only has one active library at a time. So the config lives in the
per-library `metadata.db`, and the watcher's lifecycle is bound to the active
library: opening/creating a library starts its watcher (if enabled); switching
away stops it.

Rejected alternative: global config in `registry.db`. That would force a single
watched folder shared across all libraries, which is wrong — dropping a file
should import into a *specific* library, and "which library is active" already
determines the target everywhere else in the app.

## Data model

New per-library key-value table (generic, so future per-library settings reuse
it) in `metadata.db`, added via a `user_version < 3` migration:

```sql
CREATE TABLE app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

Two keys back the feature:

| key                    | value                          |
|------------------------|--------------------------------|
| `auto_import.path`     | absolute folder path (or unset)|
| `auto_import.enabled`  | `"true"` / `"false"`           |

`db.rs` helpers:

```rust
pub fn get_config(conn: &Connection, key: &str) -> Result<Option<String>, AppError>;
pub fn set_config(conn: &Connection, key: &str, value: &str) -> Result<(), AppError>;
pub fn delete_config(conn: &Connection, key: &str) -> Result<(), AppError>;

// Convenience wrapper returning both keys as a typed struct.
pub fn get_auto_import(conn: &Connection) -> Result<AutoImportConfig, AppError>;
```

New model:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutoImportConfig {
    pub path: Option<String>,
    pub enabled: bool,
}
```

## Backend: the watcher

### Crate

`notify` (v8) + `notify-debouncer-full` (v0.7) are already in `Cargo.toml` but
unused. We use the debouncer so a burst of events from copying many files (or an
editor's atomic-save temp-file churn) collapses into a settled batch.

### State

The watcher handle is app-managed alongside the DB, so commands and the library
lifecycle can start/stop it. It is **separate** from `DbState` to avoid widening
that struct's lock scope, but managed on the same `AppHandle`:

```rust
pub struct WatcherState {
    // Some(..) while a folder is actively watched. Dropping it stops the thread.
    inner: Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>,
    // The path currently watched, for idempotence / status.
    watched: Mutex<Option<PathBuf>>,
}
```

`inner` holds the live debouncer; **dropping it stops watching** (notify tears
down the OS watch on drop). So "stop" = set `inner` to `None`.

### Lifecycle

```
open_library / create_library
        │  read auto_import config from that library's db
        ▼
  enabled && path valid ?  ──no──▶  ensure watcher stopped
        │yes
        ▼
  start_watch(path, library_id)

switch library  ──▶  stop current watcher, then run the open flow above
disable / clear ──▶  stop_watch()
enable / set    ──▶  stop_watch(); start_watch(new_path)
```

Only one watcher runs at a time (matches the single-active-library model).

### The debounce → import handler

`start_watch(app, path, library_id)`:

1. Create a `notify-debouncer-full` debouncer (~500 ms) watching `path`
   **non-recursively** — watch the folder itself. Recursive is a possible later
   toggle but adds surprise: dropping a deep tree would import everything.
2. On each debounced batch, collect the paths of events that create/modify files
   (`EventKind::Create(_)` / `Modify(_)`), filter to ones that still exist and are
   supported image types, dedupe the path list.
3. Hand that path list to a **shared** import routine (extracted from the existing
   `import_commit_paths` command body) that:
   - runs on `spawn_blocking`,
   - opens the library db by path (same pattern the import commands already use),
   - calls `indexer::prepare_from_paths` + `indexer::find_duplicates`,
   - **auto-skips duplicates** (no dialog — background op; dedup is by sha256 so
     re-observing an already-imported file is a no-op),
   - copies + thumbnails + color-extracts + batch-inserts (reusing
     `indexer::commit_import` semantics),
   - emits an `auto-import` event with `{ imported, skipped, duplicates }`.

Reusing the import pipeline means auto-import inherits dedup, thumbnails, color
extraction, and FTS indexing for free — no parallel code path to keep in sync.

> **Refactor note:** today the copy/thumbnail/insert loop is duplicated between
> `import_commit` and `import_commit_paths` in `commands.rs`. Auto-import needs
> the same loop from a non-command context. Extract it once into
> `indexer::import_paths(conn, lib_path, paths, on_progress) -> ImportResult`
> (skip-duplicates variant) and have the watcher call it. Rewiring the existing
> commands onto it is optional and can be a follow-up to keep this change small;
> the watcher does not depend on that rewiring.

### Concurrency / correctness

- **Self-trigger loop:** the watched folder is *external*; imports copy into the
  library's `images/` dir, which is not watched — so imports can't retrigger the
  watcher. (If a user ever points the watched folder *at* `images/`, dedup makes
  it a no-op anyway since the files are already imported.)
- **Overlapping batches:** the debouncer serializes callback invocations; each
  batch's import runs to completion before the next callback fires. Long imports
  can queue events, which is fine — they'll be handled in the next batch.
- **Partial writes:** debounce + "file still exists and decodes" filtering avoids
  importing a half-copied file. `image::image_dimensions` failing just yields
  `None` dims (existing behavior), not a crash.
- **Poisoned lock:** map to `AppError::Database` like the existing `*_conn` helpers.

## IPC commands

```rust
// Read current config for the active library.
#[tauri::command] fn get_auto_import(state: State<DbState>) -> Result<AutoImportConfig, AppError>;

// Set folder + enable in one call. Validates: path exists, is a dir, is local
// (reject UNC/network). Persists config, then (re)starts the watcher.
#[tauri::command] fn set_auto_import(
    path: String,
    library_id: String,
    state: State<DbState>,
    watcher: State<WatcherState>,
    app: AppHandle,
) -> Result<AutoImportConfig, AppError>;

// Enable/disable without changing the path. Starts/stops the watcher.
#[tauri::command] fn toggle_auto_import(
    enabled: bool,
    library_id: String,
    state, watcher, app,
) -> Result<AutoImportConfig, AppError>;

// Clear the path + disable + stop the watcher.
#[tauri::command] fn clear_auto_import(state, watcher) -> Result<(), AppError>;
```

Network-path rejection (macOS/Windows): reject paths under `/Volumes/` that are
network mounts and Windows `\\server\share` UNC paths. Pragmatic first cut:
reject UNC (`\\`) prefixes and surface a clear error; a perfect local-vs-network
check per OS can come later.

## Events

Mirror the existing `import-progress` pattern. New event `auto-import`:

```json
{ "imported": 3, "skipped": 0, "duplicates": 1 }
```

Frontend listens, and on `imported > 0` refreshes the current grid view
(`reloadCurrentView`) and shows a brief toast ("已自动导入 3 个文件"). No progress
bar — auto-import is a quiet background action, unlike the user-initiated import
which already has `ImportProgress`.

## Frontend

### Store

`src/stores/watchedFolderStore.ts` (small, mirrors other stores):

```ts
interface WatchedFolderState { path: string | null; enabled: boolean; }
interface WatchedFolderActions {
  fetch(): Promise<void>;
  setFolder(path: string): Promise<void>;   // set_auto_import
  toggle(enabled: boolean): Promise<void>;   // toggle_auto_import
  clear(): Promise<void>;                     // clear_auto_import
}
```

Fetch on library open/switch (hook into wherever `open_library` is invoked +
where the active library id changes).

### UI

A **Settings / Preferences** surface. Shark has no preferences panel yet, so add
a lightweight modal (`SettingsModal.tsx`) reachable from the toolbar (gear icon),
containing an "Auto-Import" section:

- Enable toggle (disabled until a folder is chosen).
- Folder path display + "选择文件夹…" button using `@tauri-apps/plugin-dialog`'s
  `open({ directory: true })` (dialog plugin is already wired in `lib.rs`).
- "打开文件夹" button (opener plugin, already present) + a "清除" button.
- Helper text explaining the feature ("拖文件到该文件夹即自动导入到当前素材库").

Follows `DESIGN.md`: macOS light theme, existing Select/TextInput idioms, Lucide
icons, no emoji in UI.

### Event wiring

In `App.tsx`, alongside the existing `import-progress`/drag-drop listeners, add a
`listen('auto-import', …)` that refreshes the grid and toasts.

## Testing

- **Rust unit:** `app_config` get/set/delete round-trip; `get_auto_import`
  defaults (unset → `{path: None, enabled: false}`); network-path rejection
  helper. Watcher itself is integration-level (real FS events) — cover the import
  routine via the existing indexer tests plus one temp-dir test that drops a file
  and asserts an item lands in the db.
- **Manual E2E:** designate a folder, drop images, confirm auto-import + grid
  refresh; drop a duplicate → skipped; switch library → watcher retargets;
  disable → drops no longer import.

## Files touched

**Backend**
- `src-tauri/src/models.rs` — `AutoImportConfig`.
- `src-tauri/src/db.rs` — migration v3 (`app_config`), config helpers.
- `src-tauri/src/indexer.rs` — extract `import_paths` (skip-dup import routine).
- `src-tauri/src/watcher.rs` — **new**: `WatcherState`, start/stop, debounce handler.
- `src-tauri/src/commands.rs` — 4 auto-import commands; library open/create start-watch hook.
- `src-tauri/src/lib.rs` — `mod watcher`, `app.manage(WatcherState)`, register commands, start watcher on startup if a library auto-opens.

**Frontend**
- `src/lib/types.ts` — `AutoImportConfig`.
- `src/stores/watchedFolderStore.ts` — **new**.
- `src/components/Settings/SettingsModal.tsx` — **new**.
- `src/components/Toolbar/Toolbar.tsx` — gear button to open settings.
- `src/App.tsx` — `auto-import` event listener; fetch config on library change.
