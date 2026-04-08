# Import Drag & Drop Enhancement Design

**Date:** 2026-04-08
**Status:** Approved

## Goal

Add drag-and-drop import support so users can drag files and folders directly into the app window or a sidebar drop zone, instead of only using the button-based directory picker.

## Architecture

**Approach:** Tauri v2 native drag-drop events (`tauri://drag-enter`, `tauri://drag-drop`, `tauri://drag-leave`). Backend receives file/folder paths, reuses existing two-phase import flow (prepare → dedup → commit).

### Event Flow

1. `tauri://drag-enter` — files dragged into window → show drop overlay
2. `tauri://drag-drop` — user drops → receive path list → trigger import
3. `tauri://drag-leave` — dragged out of window → hide overlay

### Path Handling

- Backend receives a mixed list of file paths and folder paths
- Files: collected directly into import list
- Folders: recursively scanned (reuse `prepare_import` file traversal logic)
- Unsupported file types: silently skipped

## Frontend Components

### DropOverlay (new)

- Full-screen semi-transparent overlay shown when files are dragged over the window
- Centered icon + "松手导入" text
- Rendered at App.tsx root level
- Disappears on drag-leave or after drop

### SidebarDropZone (new)

- Bottom of sidebar, dashed border area
- Text: "拖入文件或文件夹"
- Subtle when idle (semi-transparent dashed border), highlighted when active
- Also triggers import on drop

### State Management (uiStore additions)

- `isDragOver: boolean` — whether files are currently being dragged over the window
- Drop triggers existing import flow: `import_from_paths` → dedup check → `import_commit`

## Backend Changes

### New command: `import_from_paths`

- Input: `libraryId`, `paths: Vec<String>` (mixed files + folders)
- Logic:
  1. Walk paths — files collected directly, folders recursively scanned
  2. Compute SHA256, metadata for all files
  3. Run `find_duplicates` against DB
  4. Return `ImportPrepResult` (same format as `import_prepare`)
- Reuses existing indexer functions (`prepare_import`, `find_duplicates`)

### Existing `import_commit` — unchanged

The commit phase is identical regardless of how import was triggered. Dedup decisions → copy files → generate thumbnails → DB insert.

## Error Handling & Edge Cases

- **Unsupported file types:** silently skipped, counted in `skipped`
- **Empty drop (no supported files):** show toast "没有可导入的文件"
- **Mixed drop (folders + loose files):** all collected, processed together
- **Drop during active import:** ignored (check `isImporting`)
- **No active library:** show toast "请先选择或创建一个库"
- **Permission/path errors:** individual file failures don't block, aggregated at end

## Scope

- Files supported: JPG, JPEG, PNG, GIF, WebP, BMP (same as current)
- Drop targets: full window + sidebar drop zone
- Supports: individual files, folders, mixed
