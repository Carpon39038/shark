# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Shark — an open-source asset manager (Eagle alternative) focused on speed and fluidity. Desktop app using Tauri v2 (Rust backend) + React 18 (TypeScript frontend) with SQLite storage.

## Tech Stack

- **Frontend:** React 18, TypeScript, Zustand (state), Tailwind CSS, @tanstack/react-virtual (virtual scroll)
- **Backend:** Tauri v2, Rust, rusqlite (SQLite WAL mode), `image` crate (thumbnails), `notify` crate (file watching)
- **Database:** SQLite with FTS5 full-text search

## Build & Development Commands

*(To be filled once project is scaffolded — expected: `npm run tauri dev`, `npm run build`, `cargo test`, `npm test`)*

## Architecture

```
src-tauri/          Rust backend
  src/
    main.rs         Tauri entry, setup hooks (DB migration runs here)
    db.rs           SQLite schema, migrations, connection management
    indexer.rs      File walking (rayon parallel), EXIF extraction, filesystem monitoring
    thumbnail.rs    Two-tier thumbnail generation (256px + 1024px, JPEG)
    search.rs       FTS5 full-text search queries
    commands.rs     Tauri IPC command handlers (all return Result<T, AppError>)

src/                React frontend
  components/
    Grid/           Virtual grid — the core UI, must maintain 60fps at 100k+ items
    Sidebar/        Folder tree + tag panel
    Viewer/         Full-screen image viewer with zoom/pan
    Toolbar/
    Import/         Drag-drop, clipboard, folder import
  stores/           Zustand stores (libraryStore, itemStore, filterStore, viewStore, uiStore)
  hooks/
  styles/
```

### IPC Pattern

All Rust commands are `#[tauri::command]` functions returning `Result<T, AppError>`. Frontend calls them via Tauri's `invoke()`. See design doc for full command list.

### State Management

Five Zustand stores split by scope. Persisted stores use localStorage. Component-local state (hover, focus, animation) stays in `useState` — only shared or navigation-surviving state goes to Zustand.

| Store | Scope | Persisted |
|-------|-------|-----------|
| libraryStore | Global | Yes |
| itemStore | Gallery page | No |
| filterStore | Gallery page | Yes |
| viewStore | Global | Yes |
| uiStore | Transient | No |

### Key Design Decisions

- **Schema versioning via `PRAGMA user_version`** — no separate schema_version table. Built-in SQLite mechanism, simpler and battle-tested.
- **No `library_id` in per-library tables** — each metadata.db is self-contained, so items/folders/smart_folders don't need a library_id column. IPC commands still accept `library_id` as a routing parameter to select which DB connection to use.
- **Tags stored as comma-separated TEXT** in items table (not normalized) — avoids JOINs for grid display, FTS5 indexes directly. Migration path to `tags` + `item_tags` tables exists for when tag analytics is needed.
- **Smart folder rules** stored as JSON, parsed to parameterized SQL in Rust. Field names validated against an allowlist — never interpolate user input into SQL.
- **Thumbnail two-tier system**: 256px generated at import time for grid, 1024px generated on-demand for viewer. JPEG format (image crate does not support lossy WebP encoding). LRU eviction at 2GB per tier.
- **FTS5 content=items constraint**: items table must NOT use WITHOUT ROWID or be rebuilt (DROP+CREATE), as this corrupts the FTS index.
- **FTS5 search semantics**: Phase 1 uses OR for multi-token queries (broad matching suitable for image search). AND toggle deferred to Phase 2.
- **Batch thumbnail RPC**: `get_thumbnails_batch` takes a Vec of item IDs and returns HashMap<String, String> — one IPC call for the grid instead of N individual calls.
- **Dedup via SHA256** content hash computed in rayon thread pool during import.
- **DbState dual-connection architecture** — `registry: Mutex<Connection>` (always connected to `~/.shark/registry.db`) + `library: Mutex<Option<Connection>>` (connected to active library's `metadata.db`). Registry operations never block during library switches.

## Testing

- **Rust:** `#[test]` unit tests per module, integration tests in `tests/` against temp SQLite databases (`:memory:` for unit, temp file for integration). Critical paths (import, search, dedup, migration) target 80%+ coverage.
- **Frontend:** Vitest for store logic, React Testing Library for components (mock IPC), Playwright E2E post-MVP.

## Performance Targets

- 100k images: < 200ms search, 60fps grid scroll, < 1s startup, > 500 images/sec import (SSD), < 500MB memory

## Design Document

Full design spec at `docs/plans/2026-04-02-shark-asset-manager-design.md` — includes complete SQLite schema, IPC interface, state management details, thumbnail strategy, color extraction algorithm, and MVP milestones.
