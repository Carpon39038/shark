# Dedup Dialog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add import-time deduplication dialog that pauses import when SHA256 duplicates are detected, letting users skip or keep both files.

**Architecture:** Split the current single `import_files` command into two-phase flow: `import_files` returns duplicate info for frontend to display, then `resolve_duplicates` applies user decisions and continues import. Frontend gets a new `DedupDialog` modal + dedup state in `uiStore`.

**Tech Stack:** Rust/Tauri (backend), React/TypeScript/Zustand (frontend), Tailwind CSS (styling)

---

### Task 1: Add Rust types for dedup info

**Files:**
- Modify: `src-tauri/src/models.rs`

**Step 1: Add DuplicateInfo and DedupAction types to models.rs**

Add after the `ImportResult` struct (after line 120):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExistingItemInfo {
    pub id: String,
    pub filename: String,
    pub path: String,
    pub file_size: i64,
    pub thumbnail_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewFileInfo {
    pub source_path: String,
    pub filename: String,
    pub file_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateInfo {
    pub existing: ExistingItemInfo,
    pub new_file: NewFileInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPrepResult {
    pub duplicates: Vec<DuplicateInfo>,
    pub total_prepared: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DedupAction {
    Skip,
    KeepBoth,
}
```

**Step 2: Verify Rust compiles**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors

**Step 3: Commit**

```bash
git add src-tauri/src/models.rs
git commit -m "feat: add DuplicateInfo and DedupAction types for dedup dialog"
```

---

### Task 2: Add db helper to get items by sha256 hashes

**Files:**
- Modify: `src-tauri/src/db.rs`

**Step 1: Add get_items_by_sha256 function**

Add after the existing `batch_sha256_exists` function (after line 614):

```rust
pub fn get_items_by_sha256(
    conn: &Connection,
    hashes: &[&str],
) -> Result<Vec<Item>, AppError> {
    if hashes.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders: Vec<String> = (1..=hashes.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "SELECT id, file_path, file_name, file_size, file_type, width, height, tags, rating, notes, sha256, status, created_at, modified_at \
         FROM items WHERE sha256 IN ({})",
        placeholders.join(", ")
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = hashes
        .iter()
        .map(|h| h as &dyn rusqlite::types::ToSql)
        .collect();
    let mut stmt = conn.prepare(&sql)?;
    let items = stmt
        .query_map(params.as_slice(), row_to_item)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}
```

**Step 2: Verify Rust compiles**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors

**Step 3: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: add get_items_by_sha256 for dedup duplicate lookup"
```

---

### Task 3: Split indexer into prepare + commit with dedup awareness

**Files:**
- Modify: `src-tauri/src/indexer.rs`

**Step 1: Add a new `find_duplicates` function**

Add after `prepare_import` (after line 104). This function takes prepared files, checks against DB, and returns duplicate info plus the non-duplicate prepared files:

```rust
/// Identifies duplicates among prepared files against existing DB items.
/// Returns (duplicates_info, non_duplicate_files).
pub fn find_duplicates(
    conn: &Connection,
    prepared: &[Result<PreparedFile, AppError>],
) -> Result<(Vec<crate::models::DuplicateInfo>, Vec<PreparedFile>), AppError> {
    // Separate successes from failures
    let mut ok_files: Vec<PreparedFile> = Vec::new();
    for pf in prepared {
        if let Ok(pf) = pf {
            ok_files.push(pf.clone());
        }
    }

    if ok_files.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }

    // Batch dedup check
    let sha256s: Vec<&str> = ok_files.iter().map(|pf| pf.sha256.as_str()).collect();
    let existing_items = crate::db::get_items_by_sha256(conn, &sha256s)?;

    // Build lookup: sha256 -> existing item
    let mut existing_by_hash: std::collections::HashMap<String, &Item> = std::collections::HashMap::new();
    for item in &existing_items {
        existing_by_hash.insert(item.sha256.clone(), item);
    }

    // Separate duplicates from non-duplicates
    let mut duplicates = Vec::new();
    let mut non_dup_files = Vec::new();

    for pf in ok_files {
        if let Some(existing) = existing_by_hash.get(&pf.sha256) {
            // Get thumbnail path if available
            let thumb_path = crate::db::get_thumbnail_path(conn, &existing.id, "720").ok().flatten();

            duplicates.push(crate::models::DuplicateInfo {
                existing: crate::models::ExistingItemInfo {
                    id: existing.id.clone(),
                    filename: existing.file_name.clone(),
                    path: existing.file_path.clone(),
                    file_size: existing.file_size,
                    thumbnail_path: thumb_path,
                },
                new_file: crate::models::NewFileInfo {
                    source_path: pf.source_path.to_string_lossy().to_string(),
                    filename: pf.file_name.clone(),
                    file_size: pf.file_size,
                },
            });
        } else {
            non_dup_files.push(pf);
        }
    }

    Ok((duplicates, non_dup_files))
}
```

**Step 2: Add Clone derive to PreparedFile**

Change line 44 from:
```rust
pub struct PreparedFile {
```
to:
```rust
#[derive(Clone)]
pub struct PreparedFile {
```

**Step 3: Verify Rust compiles**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors

**Step 4: Commit**

```bash
git add src-tauri/src/indexer.rs
git commit -m "feat: add find_duplicates to separate dup detection from import"
```

---

### Task 4: Add new IPC commands for two-phase import

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add import_prepare command to commands.rs**

Add after the existing `import_files` command (after line 110):

```rust
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
        let dup_map: std::collections::HashMap<String, &DuplicateInfo> = duplicates
            .iter()
            .map(|d| (d.new_file.source_path.clone(), d))
            .collect();

        // Collect keep files from prepared list
        let prepared_lookup: std::collections::HashMap<String, PreparedFile> = prepared
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
```

**Step 2: Make copy_to_library and PreparedFile pub accessible**

In `src-tauri/src/indexer.rs`, the function `copy_to_library` is already `fn` (not `pub fn`). We need to either make it pub or restructure. The simplest approach: make `copy_to_library` pub:

Change line 31 from:
```rust
fn copy_to_library(src: &Path, library_path: &Path, id: &str) -> Result<std::path::PathBuf, AppError> {
```
to:
```rust
pub fn copy_to_library(src: &Path, library_path: &Path, id: &str) -> Result<std::path::PathBuf, AppError> {
```

**Step 3: Register new commands in lib.rs**

Add to the `invoke_handler` list in `src-tauri/src/lib.rs` (after `commands::import_files,`):

```rust
commands::import_prepare,
commands::import_commit,
```

**Step 4: Verify Rust compiles**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors

**Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/indexer.rs
git commit -m "feat: add import_prepare and import_commit two-phase import commands"
```

---

### Task 5: Add TypeScript types for dedup

**Files:**
- Modify: `src/lib/types.ts`

**Step 1: Add dedup types after ImportResult (after line 60)**

```typescript
export interface ExistingItemInfo {
  id: string;
  filename: string;
  path: string;
  fileSize: number;
  thumbnailPath: string | null;
}

export interface NewFileInfo {
  sourcePath: string;
  filename: string;
  fileSize: number;
}

export interface DuplicateInfo {
  existing: ExistingItemInfo;
  newFile: NewFileInfo;
}

export interface ImportPrepResult {
  duplicates: DuplicateInfo[];
  totalPrepared: number;
}

export type DedupAction = 'skip' | 'keepBoth';
```

**Step 2: Verify frontend compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors

**Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add TypeScript types for dedup dialog"
```

---

### Task 6: Add dedup state to uiStore

**Files:**
- Modify: `src/stores/uiStore.ts`

**Step 1: Add dedup state fields and actions**

Add a `DuplicateInfo` import and new state/actions:

After the `ImportProgress` interface (line 12), add:

```typescript
import type { DuplicateInfo, DedupAction } from '@/lib/types';
```

Add to `UiState` interface (after `error` field):

```typescript
dedupActive: boolean;
dedupItems: DuplicateInfo[];
dedupCurrentIndex: number;
dedupApplyAll: boolean;
dedupApplyAllAction: DedupAction | null;
dedupDecisions: Record<string, DedupAction>;
```

Add to `UiActions` interface:

```typescript
showDedupDialog: (items: DuplicateInfo[]) => void;
dismissDedupDialog: () => void;
nextDedupItem: () => void;
setDedupApplyAll: (action: DedupAction) => void;
setDedupDecision: (sourcePath: string, action: DedupAction) => void;
```

Add initial values and implementations in the store:

```typescript
dedupActive: false,
dedupItems: [],
dedupCurrentIndex: 0,
dedupApplyAll: false,
dedupApplyAllAction: null,
dedupDecisions: {},

showDedupDialog: (items) =>
  set({
    dedupActive: true,
    dedupItems: items,
    dedupCurrentIndex: 0,
    dedupApplyAll: false,
    dedupApplyAllAction: null,
    dedupDecisions: {},
  }),

dismissDedupDialog: () =>
  set({
    dedupActive: false,
    dedupItems: [],
    dedupCurrentIndex: 0,
    dedupApplyAll: false,
    dedupApplyAllAction: null,
    dedupDecisions: {},
  }),

nextDedupItem: () =>
  set((state) => ({
    dedupCurrentIndex: state.dedupCurrentIndex + 1,
  })),

setDedupApplyAll: (action) =>
  set({ dedupApplyAll: true, dedupApplyAllAction: action }),

setDedupDecision: (sourcePath, action) =>
  set((state) => ({
    dedupDecisions: { ...state.dedupDecisions, [sourcePath]: action },
  })),
```

**Step 2: Verify frontend compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors

**Step 3: Commit**

```bash
git add src/stores/uiStore.ts
git commit -m "feat: add dedup state management to uiStore"
```

---

### Task 7: Build DedupDialog component

**Files:**
- Create: `src/components/Import/DedupDialog.tsx`

**Step 1: Create the DedupDialog component**

```tsx
import { invoke } from '@tauri-apps/api/core';
import { useUiStore } from '@/stores/uiStore';
import { useItemStore } from '@/stores/itemStore';
import { useLibraryStore } from '@/stores/libraryStore';
import type { DedupAction, ImportResult } from '@/lib/types';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncatePath(path: string, maxLen = 40): string {
  if (path.length <= maxLen) return path;
  return '…' + path.slice(path.length - maxLen + 1);
}

export function DedupDialog() {
  const {
    dedupActive,
    dedupItems,
    dedupCurrentIndex,
    dedupApplyAll,
    dedupDecisions,
    dismissDedupDialog,
    setImporting,
    setImportProgress,
  } = useUiStore();

  const { libraries, activeLibraryId } = useLibraryStore();
  const loadItems = useItemStore((s) => s.loadItems);

  if (!dedupActive || dedupItems.length === 0) return null;

  const current = dedupItems[dedupCurrentIndex] ?? dedupItems[dedupItems.length - 1];
  const isLast = dedupCurrentIndex >= dedupItems.length - 1;
  const remaining = dedupItems.length - dedupCurrentIndex;
  const applyAllChecked = useUiStore.getState().dedupApplyAll;

  const handleDecision = async (action: DedupAction) => {
    const { setDedupDecision, setDedupApplyAll, nextDedupItem } = useUiStore.getState();

    setDedupDecision(current.newFile.sourcePath, action);

    if (applyAllChecked) {
      // Apply this action to all remaining
      const state = useUiStore.getState();
      for (const item of state.dedupItems.slice(state.dedupCurrentIndex + 1)) {
        setDedupDecision(item.newFile.sourcePath, action);
      }
      // Resolve immediately
      await resolveAndImport();
      return;
    }

    if (isLast) {
      await resolveAndImport();
    } else {
      nextDedupItem();
    }
  };

  const resolveAndImport = async () => {
    const state = useUiStore.getState();
    const lib = libraries.find((l) => l.id === activeLibraryId);
    if (!lib) return;

    dismissDedupDialog();
    setImporting(true);

    try {
      await invoke<ImportResult>('import_commit', {
        libraryId: lib.id,
        sourcePath: state.dedupItems[0].newFile.sourcePath.split('/').slice(0, -1).join('/') || state.dedupItems[0].newFile.sourcePath,
        actions: state.dedupDecisions,
      });

      if (activeLibraryId) {
        loadItems(activeLibraryId, {}, { field: 'created_at', direction: 'desc' }, { page: 0, page_size: 100 });
      }
    } catch (err) {
      console.error('Import commit failed:', err);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const handleSkipAll = () => {
    const state = useUiStore.getState();
    const { setDedupDecision } = useUiStore.getState();
    for (const item of state.dedupItems.slice(state.dedupCurrentIndex)) {
      setDedupDecision(item.newFile.sourcePath, 'skip');
    }
    resolveAndImport();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div className="bg-neutral-800 rounded-lg p-5 w-[520px] shadow-xl border border-neutral-700">
        <h2 className="text-lg font-semibold text-neutral-100 mb-4">
          发现重复文件 ({dedupCurrentIndex + 1}/{dedupItems.length})
        </h2>

        <div className="flex gap-4 mb-4">
          {/* Existing file */}
          <div className="flex-1 bg-neutral-700/50 rounded-lg p-3">
            <div className="text-xs text-neutral-400 mb-2">已有文件</div>
            {current.existing.thumbnailPath && (
              <img
                src={current.existing.thumbnailPath}
                alt="existing"
                className="w-full aspect-square object-cover rounded mb-2"
              />
            )}
            <div className="text-sm text-neutral-200 font-medium truncate">
              {current.existing.filename}
            </div>
            <div className="text-xs text-neutral-400 truncate">
              {truncatePath(current.existing.path)}
            </div>
            <div className="text-xs text-neutral-500 mt-1">
              {formatFileSize(current.existing.fileSize)}
            </div>
          </div>

          {/* New file */}
          <div className="flex-1 bg-neutral-700/50 rounded-lg p-3">
            <div className="text-xs text-neutral-400 mb-2">新文件</div>
            <div className="w-full aspect-square bg-neutral-600 rounded mb-2 flex items-center justify-center text-neutral-500 text-xs">
              No preview
            </div>
            <div className="text-sm text-neutral-200 font-medium truncate">
              {current.newFile.filename}
            </div>
            <div className="text-xs text-neutral-400 truncate">
              {truncatePath(current.newFile.sourcePath)}
            </div>
            <div className="text-xs text-neutral-500 mt-1">
              {formatFileSize(current.newFile.fileSize)}
            </div>
          </div>
        </div>

        {/* Apply to all checkbox */}
        {remaining > 1 && (
          <label className="flex items-center gap-2 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={applyAllChecked}
              onChange={(e) => {
                useUiStore.setState({ dedupApplyAll: e.target.checked });
              }}
              className="rounded border-neutral-500 bg-neutral-700"
            />
            <span className="text-sm text-neutral-300">
              应用于所有剩余重复 ({remaining - 1})
            </span>
          </label>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleSkipAll}
            className="px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            全部跳过
          </button>
          <button
            onClick={() => handleDecision('skip')}
            className="px-4 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-sm font-medium transition-colors"
          >
            跳过
          </button>
          <button
            onClick={() => handleDecision('keepBoth')}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
          >
            保留两者
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify frontend compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors

**Step 3: Commit**

```bash
git add src/components/Import/DedupDialog.tsx
git commit -m "feat: add DedupDialog component with skip/keep UI"
```

---

### Task 8: Wire up ImportButton to two-phase import flow

**Files:**
- Modify: `src/components/Import/ImportButton.tsx`

**Step 1: Replace handleImport to use import_prepare + dedup dialog**

The new flow:
1. Call `import_prepare` to detect duplicates
2. If duplicates found → show DedupDialog (state managed by uiStore)
3. If no duplicates → call original `import_files` directly

Replace the entire `ImportButton.tsx`:

```tsx
import { open, message } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useLibraryStore } from '@/stores/libraryStore';
import { useUiStore } from '@/stores/uiStore';
import { useItemStore } from '@/stores/itemStore';
import type { ImportPrepResult, ImportResult, Item } from '@/lib/types';

interface ImportProgressPayload {
  current: number;
  total: number;
  item: Item | null;
  thumbnailPath: string | null;
}

export function ImportButton() {
  const { libraries, activeLibraryId } = useLibraryStore();
  const { setImporting, setImportProgress, showDedupDialog } = useUiStore();
  const loadItems = useItemStore((s) => s.loadItems);

  const handleImport = async () => {
    const lib = libraries.find((l) => l.id === activeLibraryId);
    if (!lib) return;

    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;

    setImporting(true);
    try {
      // Phase 1: prepare and check duplicates
      const prep = await invoke<ImportPrepResult>('import_prepare', {
        libraryId: lib.id,
        sourcePath: selected,
      });

      if (prep.duplicates.length > 0) {
        // Show dedup dialog — import continues from DedupDialog
        setImporting(false);
        showDedupDialog(prep.duplicates);
        return;
      }

      // No duplicates — proceed with direct import
      const unlisten = await listen<ImportProgressPayload>('import-progress', (event) => {
        const { current, total, item } = event.payload;
        setImportProgress({ current, total });
        if (item) {
          useItemStore.getState().addItem(item);
        }
      });

      try {
        await invoke<ImportResult>('import_files', {
          libraryId: lib.id,
          sourcePath: selected,
        });
        if (activeLibraryId) {
          loadItems(activeLibraryId, {}, { field: 'created_at', direction: 'desc' }, { page: 0, page_size: 100 });
        }
      } finally {
        unlisten();
      }
    } catch (err) {
      message(`Import failed: ${err}`, { title: 'Import Error', kind: 'error' });
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <button
      onClick={handleImport}
      disabled={!activeLibraryId}
      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors"
    >
      Import
    </button>
  );
}
```

**Step 2: Verify frontend compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors

**Step 3: Commit**

```bash
git add src/components/Import/ImportButton.tsx
git commit -m "feat: wire ImportButton to two-phase import with dedup check"
```

---

### Task 9: Mount DedupDialog in the app

**Files:**
- Modify: `src/App.tsx` (or main layout component)

**Step 1: Find the root layout component and add DedupDialog**

Search for where `ImportProgress` is rendered. Add `DedupDialog` alongside it:

```tsx
import { DedupDialog } from '@/components/Import/DedupDialog';
```

Then in the JSX, next to `<ImportProgress />`:

```tsx
<DedupDialog />
```

**Step 2: Verify frontend compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: mount DedupDialog in app root"
```

---

### Task 10: Fix import_commit source path and test end-to-end

**Files:**
- Modify: `src/components/Import/DedupDialog.tsx`

**Step 1: Fix source path extraction in resolveAndImport**

The `resolveAndImport` function needs the original source folder path, not derived from one file's path. Store the source path in uiStore when showing the dialog.

Update the `showDedupDialog` action to also accept and store the source path:

In `uiStore.ts`, add to state:
```typescript
dedupSourcePath: string | null;
```

Update `showDedupDialog`:
```typescript
showDedupDialog: (items: DuplicateInfo[], sourcePath: string) => void;
```

Implementation:
```typescript
showDedupDialog: (items, sourcePath) =>
  set({
    dedupActive: true,
    dedupItems: items,
    dedupCurrentIndex: 0,
    dedupApplyAll: false,
    dedupApplyAllAction: null,
    dedupDecisions: {},
    dedupSourcePath: sourcePath,
  }),
```

Initial value: `dedupSourcePath: null`

Reset in `dismissDedupDialog`:
```typescript
dedupSourcePath: null,
```

**Step 2: Update ImportButton to pass sourcePath**

In ImportButton.tsx, change:
```typescript
showDedupDialog(prep.duplicates);
```
to:
```typescript
showDedupDialog(prep.duplicates, selected);
```

**Step 3: Update DedupDialog to use stored sourcePath**

In DedupDialog.tsx, update `resolveAndImport`:
```typescript
const resolveAndImport = async () => {
  const state = useUiStore.getState();
  const lib = libraries.find((l) => l.id === activeLibraryId);
  if (!lib || !state.dedupSourcePath) return;
  // ...
  await invoke<ImportResult>('import_commit', {
    libraryId: lib.id,
    sourcePath: state.dedupSourcePath,
    actions: state.dedupDecisions,
  });
```

**Step 4: Verify both Rust and frontend compile**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Run: `pnpm exec tsc --noEmit`
Expected: both pass

**Step 5: Commit**

```bash
git add src/stores/uiStore.ts src/components/Import/DedupDialog.tsx src/components/Import/ImportButton.tsx
git commit -m "fix: store source path in uiStore for correct import_commit flow"
```
