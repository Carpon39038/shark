# E2E Integration Design

## Goal

Get Shark's core workflows running end-to-end: frontend UI ↔ Zustand stores ↔ Tauri IPC ↔ Rust backend. Verify through structured test paths, fixing issues as they arise.

## Approach

1. **Code-level interface audit** — fix type/parameter mismatches between frontend and backend before running
2. **Run `npm run tauri dev`** and validate each path sequentially
3. **Fix bugs in-place** — no backlog, resolve each issue before moving on

## Phase 1: Core Flow

| # | Path | Modules | Validation |
|---|------|---------|------------|
| 1 | Create library | libraryStore → `create_library` | Directory structure, registry entry, metadata.db init |
| 2 | Open library | libraryStore → `open_library` | Connection switch, library list refresh |
| 3 | Import files | ImportButton → `import_files` | File copy, SHA256 dedup, thumbnail gen, DB insert |
| 4 | Browse grid | VirtualGrid ← itemStore ← `query_items` | Pagination, virtual scroll, thumbnail display |
| 5 | Search | Toolbar → `search_items_cmd` | FTS5 query, grid refresh with results |
| 6 | View image | ImageViewer | Zoom, keyboard nav, file info |

## Phase 2: Organization

| # | Path | Validation |
|---|------|------------|
| 7 | Folder tree | `get_folders` returns hierarchy, click filters grid |
| 8 | Tags | `get_all_tags` returns list, filter by tag |
| 9 | Sort & filter | filterStore params passed to `query_items`, correct sort fields |
| 10 | Multi-select | Ctrl+click, Shift+click, batch delete |

## Phase 3: Performance Benchmarks

| # | Test | Target |
|---|------|--------|
| 11 | Import speed | 100 test images, >500 images/sec |
| 12 | Grid scroll | 1000+ items at 60fps |
| 13 | Search speed | 10k+ items FTS5 search < 200ms |
| 14 | Memory | Normal browsing < 500MB |
