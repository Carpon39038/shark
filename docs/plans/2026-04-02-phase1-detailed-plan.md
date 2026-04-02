# Phase 1 Core Viewer — Detailed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the minimal functional loop for Shark: create library → import folder → browse thumbnails in virtual grid → view single image.

**Architecture:** Backend-first approach — complete Rust backend (Tauri v2) with SQLite (rusqlite), then React frontend. Dual-database architecture: global registry DB (`~/.shark/registry.db`) for library catalog, per-library DB (`<library_path>/.shark/metadata.db`) for items/FTS5. Rayon for parallel import, FTS5 for full-text search.

**Tech Stack:** Tauri v2 (Rust) + React 18 + TypeScript + Zustand 5 + Tailwind CSS v4 + @tanstack/react-virtual v3 + rusqlite (SQLite WAL) + image crate + rayon + walkdir + sha2

---



## Task 1: Project Scaffolding

**Files to create:** `package.json`, `Cargo.toml`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tauri.conf.json`, `src/main.css`, `src/main.tsx`, `src/App.tsx`, `src-tauri/src/main.rs`, `src-tauri/build.rs`, `src-tauri/capabilities/default.json`

---

### Step 1: Create project directory structure

```bash
mkdir -p shark && cd shark
mkdir -p src src-tauri/src src-tauri/capabilities
```

Expected: directories created silently, no output.

---

### Step 2: Create `package.json`

Create `package.json`:

```json
{
  "name": "shark",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-dialog": "^2.0.0",
    "@tanstack/react-virtual": "^3.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@tauri-apps/cli": "^2.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0"
  }
}
```

---

### Step 3: Install frontend dependencies

```bash
cd /Users/carpon/web/shark
pnpm install
```

Expected output (abbreviated):

```
Progress: resolved 150, reused 140, downloaded 10, added 150
```

---

### Step 4: Create `Cargo.toml` (in `src-tauri/`)

Create `src-tauri/Cargo.toml`:

```toml
[package]
name = "shark"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rusqlite = { version = "0.31", features = ["bundled", "fts5"] }
chrono = { version = "0.4", features = ["serde"] }
image = "0.25"
rayon = "1.10"
walkdir = "2"
sha2 = "0.10"
uuid = { version = "1", features = ["v4"] }
thiserror = "1"
```

---

### Step 5: Create `src-tauri/build.rs`

Create `src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

---

### Step 6: Create `src-tauri/tauri.conf.json`

Create `src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/core/tauri-config-schema/schema.json",
  "productName": "Shark",
  "version": "0.1.0",
  "identifier": "com.shark.assetmanager",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Shark",
        "width": 1280,
        "height": 800,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' asset: https://asset.localhost",
      "assetProtocol": {
        "enable": true,
        "scope": {
          "allow": ["**"],
          "deny": []
        }
      }
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "dialog": {}
  }
}
```

---

### Step 7: Create `src-tauri/capabilities/default.json`

Create `src-tauri/capabilities/default.json`:

```json
{
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:default",
    "dialog:default",
    "dialog:allow-open",
    {
      "identifier": "core:window:allow-create",
      "allow": []
    }
  ]
}
```

---

### Step 8: Create `vite.config.ts`

Create `vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
```

---

### Step 9: Create `tsconfig.json`

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "useDefineForClassFields": true,
    "lib": ["ES2021", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

---

### Step 10: Create `tsconfig.node.json`

Create `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts"]
}
```

---

### Step 11: Create `src/main.css`

Create `src/main.css`:

```css
@import "tailwindcss";

:root {
  font-family:
    Inter,
    system-ui,
    Avenir,
    Helvetica,
    Arial,
    sans-serif;
  line-height: 1.5;
  font-weight: 400;

  color-scheme: dark;
  color: #ffffff;
  background-color: #1a1a2e;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}
```

---

### Step 12: Create `src/main.tsx`

Create `src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./main.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

---

### Step 13: Create `src/App.tsx`

Create `src/App.tsx`:

```tsx
function App() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#1a1a2e]">
      <h1 className="text-4xl font-bold text-white">Shark</h1>
    </div>
  );
}

export default App;
```

---

### Step 14: Create `index.html`

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Shark</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

---

### Step 15: Create `src-tauri/src/main.rs`

Create `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

### Step 16: Verify the application builds and launches

```bash
cd /Users/carpon/web/shark
pnpm tauri dev
```

Expected: A Tauri window opens titled "Shark" displaying the text "Shark" centered on a dark background. First run will compile all Rust dependencies (2-5 minutes). Subsequent runs compile in seconds.

Press `Ctrl+C` to stop the dev server.

---

## Task 2: Rust Error Types + Models

**Files to create:** `src-tauri/src/error.rs`, `src-tauri/src/models.rs`
**File to modify:** `src-tauri/src/main.rs`

---

### Step 1: Write tests for `error.rs` serialization

Create `src-tauri/src/error.rs` with tests first:

```rust
use serde::Serialize;
use std::fmt;
use std::io;
use rusqlite::ErrorCode;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Thumbnail error: {0}")]
    Thumbnail(String),

    #[error("Duplicate: {0}")]
    Duplicate(String),

    #[error("No active library")]
    NoActiveLibrary,

    #[error("{0}")]
    Internal(String),
}

// Manual Serialize impl — serializes as a simple string message for Tauri IPC.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<io::Error> for AppError {
    fn from(err: io::Error) -> Self {
        AppError::Io(err.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        match err {
            rusqlite::Error::SqliteFailure(ref err, _) => {
                match err.code {
                    ErrorCode::ConstraintViolation => {
                        AppError::Duplicate(err.to_string())
                    }
                    _ => AppError::Database(err.to_string()),
                }
            }
            _ => AppError::Database(err.to_string()),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Internal(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apperror_database_serializes_to_string() {
        let err = AppError::Database("table not found".into());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"Database error: table not found\"");
    }

    #[test]
    fn test_apperror_io_serializes_to_string() {
        let err = AppError::Io("permission denied".into());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"IO error: permission denied\"");
    }

    #[test]
    fn test_apperror_not_found_serializes_to_string() {
        let err = AppError::NotFound("item xyz".into());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"Not found: item xyz\"");
    }

    #[test]
    fn test_apperror_no_active_library_serializes() {
        let err = AppError::NoActiveLibrary;
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"No active library\"");
    }

    #[test]
    fn test_from_io_error() {
        let io_err = io::Error::new(io::ErrorKind::NotFound, "file gone");
        let app_err: AppError = io_err.into();
        match app_err {
            AppError::Io(msg) => assert!(msg.contains("file gone")),
            other => panic!("Expected Io variant, got {:?}", other),
        }
    }

    #[test]
    fn test_from_rusqlite_error() {
        let sqlite_err = rusqlite::Error::InvalidParameterName("bad param".into());
        let app_err: AppError = sqlite_err.into();
        match app_err {
            AppError::Database(msg) => assert!(msg.contains("bad param")),
            other => panic!("Expected Database variant, got {:?}", other),
        }
    }

    #[test]
    fn test_from_rusqlite_constraint_is_duplicate() {
        let sqlite_err = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error {
                code: rusqlite::ErrorCode::ConstraintViolation,
                extended_code: 787,
            },
            Some("UNIQUE constraint failed".into()),
        );
        let app_err: AppError = sqlite_err.into();
        match app_err {
            AppError::Duplicate(msg) => assert!(msg.contains("UNIQUE constraint")),
            other => panic!("Expected Duplicate variant, got {:?}", other),
        }
    }
}
```

Run the tests — they should fail because the file does not exist in the module tree yet:

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test --lib error 2>&1 | tail -5
```

Expected: compilation error — `error.rs` is not declared as a module.

---

### Step 2: Add `mod error;` to `main.rs` and run tests

Update `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod error;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test --lib error
```

Expected:

```
running 7 tests
test error::tests::test_apperror_database_serializes_to_string ... ok
test error::tests::test_apperror_io_serializes_to_string ... ok
test error::tests::test_apperror_not_found_serializes_to_string ... ok
test error::tests::test_apperror_no_active_library_serializes ... ok
test error::tests::test_from_io_error ... ok
test error::tests::test_from_rusqlite_error ... ok
test error::tests::test_from_rusqlite_constraint_is_duplicate ... ok

test result: ok. 7 passed; 0 failed; 0 ignored
```

---

### Step 3: Write tests for `models.rs` serialization

Create `src-tauri/src/models.rs`:

```rust
use serde::{Deserialize, Serialize};

// ── Library ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
}

// ── Item ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub file_path: String,
    pub file_name: String,
    pub file_size: i64,
    pub file_type: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub color: Option<String>,
    pub tags: String,
    pub rating: i64,
    pub notes: String,
    pub sha256: String,
    pub status: String,
    pub created_at: String,
    pub modified_at: String,
}

// ── Folder ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
}

// ── Smart Folder ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFolder {
    pub id: String,
    pub name: String,
    pub rules: String,
    pub parent_id: Option<String>,
}

// ── Query / Filter Types ─────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemFilter {
    pub folder_id: Option<String>,
    pub file_types: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub rating_min: Option<i64>,
    pub search_query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortSpec {
    pub field: String,
    pub direction: String, // "asc" or "desc"
}

impl Default for SortSpec {
    fn default() -> Self {
        Self {
            field: "created_at".into(),
            direction: "desc".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pagination {
    pub offset: i64,
    pub limit: i64,
}

impl Default for Pagination {
    fn default() -> Self {
        Self { offset: 0, limit: 200 }
    }
}

// ── Result Wrappers ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemPage {
    pub items: Vec<Item>,
    pub total: i64,
    pub offset: i64,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub duplicates: usize,
}

// ── Thumbnail ────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum ThumbnailSize {
    S256,   // 256px — grid view
    S1024,  // 1024px — viewer / zoomed grid
}

impl ThumbnailSize {
    pub fn pixel_size(&self) -> u32 {
        match self {
            ThumbnailSize::S256 => 256,
            ThumbnailSize::S1024 => 1024,
        }
    }

    pub fn subdir(&self) -> &str {
        match self {
            ThumbnailSize::S256 => "256",
            ThumbnailSize::S1024 => "1024",
        }
    }
}

// ── Stats ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryStats {
    pub total_items: i64,
    pub total_size: i64,
    pub by_type: std::collections::HashMap<String, i64>,
}

// ── Search ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub item: Item,
    pub rank: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_library_roundtrip() {
        let lib = Library {
            id: "abc-123".into(),
            name: "My Library".into(),
            path: "/home/user/SharkLibrary".into(),
            created_at: "2026-04-02T00:00:00".into(),
        };
        let json = serde_json::to_string(&lib).unwrap();
        let back: Library = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, lib.id);
        assert_eq!(back.name, lib.name);
        assert_eq!(back.path, lib.path);
    }

    #[test]
    fn test_item_roundtrip() {
        let item = Item {
            id: "item-1".into(),
            file_path: "/lib/images/photo.png".into(),
            file_name: "photo.png".into(),
            file_size: 1024,
            file_type: "PNG".into(),
            width: Some(1920),
            height: Some(1080),
            color: Some("#ff0000".into()),
            tags: "landscape,nature".into(),
            rating: 3,
            notes: "".into(),
            sha256: "deadbeef".into(),
            status: "active".into(),
            created_at: "2026-04-02T12:00:00".into(),
            modified_at: "2026-04-02T12:00:00".into(),
        };
        let json = serde_json::to_string(&item).unwrap();
        let back: Item = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, item.id);
        assert_eq!(back.width, Some(1920));
        assert_eq!(back.tags, "landscape,nature");
    }

    #[test]
    fn test_sort_spec_default() {
        let sort = SortSpec::default();
        assert_eq!(sort.field, "created_at");
        assert_eq!(sort.direction, "desc");
    }

    #[test]
    fn test_pagination_default() {
        let page = Pagination::default();
        assert_eq!(page.offset, 0);
        assert_eq!(page.limit, 200);
    }

    #[test]
    fn test_thumbnail_size_pixels() {
        assert_eq!(ThumbnailSize::S256.pixel_size(), 256);
        assert_eq!(ThumbnailSize::S1024.pixel_size(), 1024);
    }

    #[test]
    fn test_thumbnail_size_subdir() {
        assert_eq!(ThumbnailSize::S256.subdir(), "256");
        assert_eq!(ThumbnailSize::S1024.subdir(), "1024");
    }

    #[test]
    fn test_item_filter_with_optional_fields() {
        let filter = ItemFilter {
            folder_id: Some("folder-1".into()),
            file_types: Some(vec!["JPG".into(), "PNG".into()]),
            tags: Some(vec!["nature".into()]),
            rating_min: None,
            search_query: None,
        };
        let json = serde_json::to_string(&filter).unwrap();
        let back: ItemFilter = serde_json::from_str(&json).unwrap();
        assert_eq!(back.folder_id, Some("folder-1".into()));
        assert!(back.rating_min.is_none());
    }

    #[test]
    fn test_import_result_serialization() {
        let result = ImportResult {
            imported: 42,
            skipped: 3,
            duplicates: 1,
        };
        let json = serde_json::to_string(&result).unwrap();
        let back: ImportResult = serde_json::from_str(&json).unwrap();
        assert_eq!(back.imported, 42);
        assert_eq!(back.duplicates, 1);
    }

    #[test]
    fn test_library_stats_serialization() {
        let mut by_type = std::collections::HashMap::new();
        by_type.insert("JPG".into(), 3500);
        by_type.insert("PNG".into(), 1500);
        let stats = LibraryStats {
            total_items: 5000,
            total_size: 3_000_000_000,
            by_type,
        };
        let json = serde_json::to_string(&stats).unwrap();
        let back: LibraryStats = serde_json::from_str(&json).unwrap();
        assert_eq!(back.total_items, 5000);
        assert_eq!(back.by_type.get("JPG"), Some(&3500));
    }
}
```

---

### Step 4: Add `mod models;` to `main.rs` and run tests

Update `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod error;
mod models;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test --lib models
```

Expected:

```
running 8 tests
test models::tests::test_library_roundtrip ... ok
test models::tests::test_item_roundtrip ... ok
test models::tests::test_sort_spec_default ... ok
test models::tests::test_pagination_default ... ok
test models::tests::test_thumbnail_size_pixels ... ok
test models::tests::test_thumbnail_size_subdir ... ok
test models::tests::test_item_filter_with_optional_fields ... ok
test models::tests::test_import_result_serialization ... ok

test result: ok. 8 passed; 0 failed; 0 ignored
```

---

### Step 5: Verify full `cargo check` passes

```bash
cd /Users/carpon/web/shark/src-tauri && cargo check
```

Expected:

```
Checking shark v0.1.0 (...) Finished `dev` profile [unoptimized + debuginfo] target(s) in X.XXs
```

No warnings, no errors.

---

### Step 6: Run all tests together

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test --lib
```

Expected:

```
running 15 tests
... all 15 pass ...
test result: ok. 15 passed; 0 failed; 0 ignored
```

---

### Step 7: Commit

```bash
cd /Users/carpon/web/shark
git add src-tauri/src/error.rs src-tauri/src/models.rs src-tauri/src/main.rs
git commit -m "Add error types and data models with serialization tests"
```

---

## Task 3: Database Layer (db.rs)

**Files to create:** `src-tauri/src/db.rs`
**File to modify:** `src-tauri/src/main.rs` (add `mod db;`)

---

### Step 1: Write test for registry schema creation

Create `src-tauri/src/db.rs` with the first test:

```rust
use rusqlite::{params, Connection, Result as SqlResult};
use std::path::Path;

use crate::error::AppError;
use crate::models::*;

use std::sync::Mutex;

// ── DbState (dual-connection) ────────────────────────────────

pub struct DbState {
    pub registry: Mutex<Connection>,
    pub library: Mutex<Option<Connection>>,
}

impl DbState {
    pub fn new(registry_path: &Path) -> Result<Self, AppError> {
        let conn = init_registry_db(registry_path)?;
        Ok(Self {
            registry: Mutex::new(conn),
            library: Mutex::new(None),
        })
    }
}

// ── Pragma helper ────────────────────────────────────────────

fn apply_pragmas(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         PRAGMA synchronous=NORMAL;",
    )?;
    Ok(())
}

// ── Registry DB ──────────────────────────────────────────────

pub fn init_registry_db(path: &Path) -> Result<Connection, AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    apply_pragmas(&conn)?;
    run_registry_migrations(&conn)?;
    Ok(conn)
}

fn run_registry_migrations(conn: &Connection) -> Result<(), AppError> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 1 {
        conn.execute_batch(
            "CREATE TABLE libraries (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );",
        )?;
        conn.pragma_update(None, "user_version", 1)?;
    }
    Ok(())
}

// ── Library DB ───────────────────────────────────────────────

pub fn init_library_db(path: &Path) -> Result<Connection, AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    apply_pragmas(&conn)?;
    run_library_migrations(&conn)?;
    Ok(conn)
}

fn run_library_migrations(conn: &Connection) -> Result<(), AppError> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 1 {
        conn.execute_batch(
            "
            CREATE TABLE items (
                id TEXT PRIMARY KEY,
                file_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                file_type TEXT NOT NULL,
                width INTEGER,
                height INTEGER,
                color TEXT,
                tags TEXT NOT NULL DEFAULT '',
                rating INTEGER NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                sha256 TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX idx_items_file_type ON items(file_type);
            CREATE INDEX idx_items_rating ON items(rating);
            CREATE INDEX idx_items_created_at ON items(created_at);
            CREATE INDEX idx_items_sha256 ON items(sha256);
            CREATE UNIQUE INDEX idx_items_file_path ON items(file_path);

            CREATE TABLE folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT,
                sort_order INTEGER DEFAULT 0,
                FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
            );

            CREATE TABLE item_folders (
                item_id TEXT NOT NULL,
                folder_id TEXT NOT NULL,
                PRIMARY KEY (item_id, folder_id),
                FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
                FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
            );

            CREATE TABLE smart_folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                rules TEXT NOT NULL,
                parent_id TEXT,
                FOREIGN KEY (parent_id) REFERENCES smart_folders(id)
            );

            CREATE TABLE thumbnails (
                item_id TEXT PRIMARY KEY,
                thumb_256_path TEXT,
                thumb_1024_path TEXT,
                width INTEGER,
                height INTEGER,
                generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
            );

            CREATE VIRTUAL TABLE items_fts USING fts5(
                file_name,
                tags,
                notes,
                content=items,
                content_rowid=rowid
            );

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
            ",
        )?;
        conn.pragma_update(None, "user_version", 1)?;
    }
    Ok(())
}

// ── Library CRUD ─────────────────────────────────────────────

pub fn create_library(
    conn: &Connection,
    name: &str,
    path: &str,
) -> Result<Library, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO libraries (id, name, path) VALUES (?1, ?2, ?3)",
        params![id, name, path],
    )?;

    // Initialize library directory structure + metadata.db immediately
    let lib_path = Path::new(path);
    std::fs::create_dir_all(lib_path.join("images"))?;
    std::fs::create_dir_all(lib_path.join(".shark").join("thumbs").join("256"))?;
    std::fs::create_dir_all(lib_path.join(".shark").join("thumbs").join("1024"))?;

    // Initialize the per-library metadata.db
    let db_path = lib_path.join(".shark").join("metadata.db");
    {
        let lib_conn = init_library_db(&db_path)?;
        drop(lib_conn); // Run migrations and release — will be reopened on open_library
    }

    Ok(Library {
        id,
        name: name.to_string(),
        path: path.to_string(),
        created_at: String::new(),
    })
}

pub fn get_library(conn: &Connection, id: &str) -> Result<Library, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, created_at FROM libraries WHERE id = ?1",
    )?;
    let lib = stmt.query_row(params![id], |row| {
        Ok(Library {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    Ok(lib)
}

pub fn list_libraries(conn: &Connection) -> Result<Vec<Library>, AppError> {
    let mut stmt =
        conn.prepare("SELECT id, name, path, created_at FROM libraries ORDER BY created_at")?;
    let libs = stmt
        .query_map([], |row| {
            Ok(Library {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(libs)
}

pub fn delete_library(conn: &Connection, id: &str) -> Result<(), AppError> {
    let rows = conn.execute("DELETE FROM libraries WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("library {}", id)));
    }
    Ok(())
}

// ── Item CRUD ────────────────────────────────────────────────

pub fn insert_item(conn: &Connection, item: &Item) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO items (id, file_path, file_name, file_size, file_type, width, height, color, tags, rating, notes, sha256, status, created_at, modified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            item.id,
            item.file_path,
            item.file_name,
            item.file_size,
            item.file_type,
            item.width,
            item.height,
            item.color,
            item.tags,
            item.rating,
            item.notes,
            item.sha256,
            item.status,
            item.created_at,
            item.modified_at,
        ],
    )?;
    Ok(())
}

pub fn get_item(conn: &Connection, id: &str) -> Result<Item, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, file_path, file_name, file_size, file_type, width, height, color, tags, rating, notes, sha256, status, created_at, modified_at
         FROM items WHERE id = ?1",
    )?;
    let item = stmt.query_row(params![id], |row| {
        Ok(Item {
            id: row.get(0)?,
            file_path: row.get(1)?,
            file_name: row.get(2)?,
            file_size: row.get(3)?,
            file_type: row.get(4)?,
            width: row.get(5)?,
            height: row.get(6)?,
            color: row.get(7)?,
            tags: row.get(8)?,
            rating: row.get(9)?,
            notes: row.get(10)?,
            sha256: row.get(11)?,
            status: row.get(12)?,
            created_at: row.get(13)?,
            modified_at: row.get(14)?,
        })
    })?;
    Ok(item)
}

pub fn delete_item(conn: &Connection, id: &str, permanent: bool) -> Result<(), AppError> {
    if permanent {
        let rows = conn.execute("DELETE FROM items WHERE id = ?1", params![id])?;
        if rows == 0 {
            return Err(AppError::NotFound(format!("item {}", id)));
        }
    } else {
        // Soft delete: mark as deleted in status
        let rows = conn.execute(
            "UPDATE items SET status = 'deleted' WHERE id = ?1",
            params![id],
        )?;
        if rows == 0 {
            return Err(AppError::NotFound(format!("item {}", id)));
        }
    }
    Ok(())
}

pub fn query_items(
    conn: &Connection,
    filter: &ItemFilter,
    sort: &SortSpec,
    pagination: &Pagination,
) -> Result<ItemPage, AppError> {
    let mut where_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    // Only show active items by default
    where_clauses.push("items.status = 'active'".into());

    if let Some(ref folder_id) = filter.folder_id {
        where_clauses.push("items.id IN (SELECT item_id FROM item_folders WHERE folder_id = ?)".into());
        param_values.push(Box::new(folder_id.clone()));
    }

    if let Some(ref tags) = filter.tags {
        for tag in tags.iter() {
            where_clauses.push("items.tags LIKE ?".into());
            param_values.push(Box::new(format!("%{}%", tag)));
        }
    }

    if let Some(ref file_types) = filter.file_types {
        let placeholders: Vec<String> = file_types.iter().enumerate().map(|(i, _)| format!("?{}", param_values.len() + i + 1)).collect();
        // Re-do with proper parameterized approach
        where_clauses.push(format!("items.file_type IN ({})", file_types.iter().map(|_| "?").collect::<Vec<_>>().join(",")));
        for ft in file_types {
            param_values.push(Box::new(ft.clone()));
        }
    }

    if let Some(min_rating) = filter.rating_min {
        where_clauses.push("items.rating >= ?".into());
        param_values.push(Box::new(min_rating));
    }

    let allowed_sort_fields = [
        "created_at", "modified_at", "file_name", "file_size", "rating",
    ];
    let sort_field = if allowed_sort_fields.contains(&sort.field.as_str()) {
        &sort.field
    } else {
        "created_at"
    };
    let sort_dir = if sort.direction == "asc" { "ASC" } else { "DESC" };

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    // Count total
    let count_sql = format!("SELECT COUNT(*) FROM items {}", where_sql);
    let count_params: Vec<&dyn rusqlite::types::ToSql> = param_values
        .iter()
        .map(|p| p.as_ref())
        .collect();
    let total: i64 = conn.query_row(&count_sql, count_params.as_slice(), |row| row.get(0))?;

    // Query page
    let query_sql = format!(
        "SELECT id, file_path, file_name, file_size, file_type, width, height, color, tags, rating, notes, sha256, status, created_at, modified_at
         FROM items {} ORDER BY {} {} LIMIT ? OFFSET ?",
        where_sql, sort_field, sort_dir,
    );

    param_values.push(Box::new(pagination.limit));
    param_values.push(Box::new(pagination.offset));
    let query_params: Vec<&dyn rusqlite::types::ToSql> = param_values
        .iter()
        .map(|p| p.as_ref())
        .collect();

    let mut stmt = conn.prepare(&query_sql)?;
    let items = stmt
        .query_map(query_params.as_slice(), |row| {
            Ok(Item {
                id: row.get(0)?,
                file_path: row.get(1)?,
                file_name: row.get(2)?,
                file_size: row.get(3)?,
                file_type: row.get(4)?,
                width: row.get(5)?,
                height: row.get(6)?,
                color: row.get(7)?,
                tags: row.get(8)?,
                rating: row.get(9)?,
                notes: row.get(10)?,
                sha256: row.get(11)?,
                status: row.get(12)?,
                created_at: row.get(13)?,
                modified_at: row.get(14)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ItemPage {
        items,
        total,
        offset: pagination.offset,
        limit: pagination.limit,
    })
}

// ── Tags ─────────────────────────────────────────────────────
// NOTE: FTS5 search is handled by search.rs module — db.rs does NOT define
// search_items(). This avoids duplication and ensures all search logic lives
// in one place. The db.rs module only handles schema, migrations, and CRUD.

pub fn get_all_tags(conn: &Connection) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare("SELECT DISTINCT tags FROM items WHERE tags != ''")?;
    let tag_rows = stmt.query_map([], |row| {
        let tags_str: String = row.get(0)?;
        Ok(tags_str)
    })?;

    let mut tag_set = std::collections::HashSet::new();
    for tag_str in tag_rows {
        let ts = tag_str?;
        for tag in ts.split(',') {
            let trimmed = tag.trim();
            if !trimmed.is_empty() {
                tag_set.insert(trimmed.to_string());
            }
        }
    }

    let mut tags: Vec<String> = tag_set.into_iter().collect();
    tags.sort();
    Ok(tags)
}

// ── Folder queries ───────────────────────────────────────────

pub fn get_folders(conn: &Connection) -> Result<Vec<Folder>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, parent_id, sort_order FROM folders ORDER BY sort_order, name",
    )?;
    let folders = stmt
        .query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                sort_order: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(folders)
}

// ── Library lookup by path ───────────────────────────────────

pub fn get_library_by_path(conn: &Connection, path: &str) -> Result<Library, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, created_at FROM libraries WHERE path = ?1",
    )?;
    let lib = stmt.query_row(params![path], |row| {
        Ok(Library {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    Ok(lib)
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::TempDir::new().unwrap()
    }

    // ── Registry schema ──────────────────────────────────────

    #[test]
    fn test_registry_schema_creation() {
        let dir = temp_dir();
        let db_path = dir.path().join("registry.db");
        let conn = init_registry_db(&db_path).unwrap();

        // Verify libraries table exists
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='libraries'")
            .unwrap();
        let tables: Vec<String> = stmt.query_map([], |row| row.get(0)).unwrap().filter_map(|r| r.ok()).collect();
        assert!(tables.contains(&"libraries".to_string()));

        // Verify user_version is 1
        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn test_registry_wal_mode() {
        let dir = temp_dir();
        let db_path = dir.path().join("registry.db");
        let _conn = init_registry_db(&db_path).unwrap();

        // Reopen and check WAL
        let conn = Connection::open(&db_path).unwrap();
        let journal_mode: String = conn
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(journal_mode, "wal");
    }

    // ── Library schema ───────────────────────────────────────

    #[test]
    fn test_library_schema_all_tables() {
        let dir = temp_dir();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let expected = vec![
            "items", "folders", "item_folders", "smart_folders", "thumbnails", "items_fts",
        ];
        // Note: SQLite master lists both tables and indexes; FTS tables appear as virtual tables

        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','virtual') ORDER BY name")
            .unwrap();
        let tables: Vec<String> = stmt.query_map([], |row| row.get(0)).unwrap().filter_map(|r| r.ok()).collect();

        for expected_table in &expected {
            assert!(
                tables.contains(&expected_table.to_string()),
                "Missing table: {} (found: {:?})",
                expected_table,
                tables
            );
        }
    }

    #[test]
    fn test_library_fts_triggers_exist() {
        let dir = temp_dir();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")
            .unwrap();
        let triggers: Vec<String> = stmt.query_map([], |row| row.get(0)).unwrap().filter_map(|r| r.ok()).collect();

        assert!(triggers.contains(&"items_ai".to_string()), "Missing trigger items_ai");
        assert!(triggers.contains(&"items_ad".to_string()), "Missing trigger items_ad");
        assert!(triggers.contains(&"items_au".to_string()), "Missing trigger items_au");
    }

    // Note: FTS triggers now sync file_name, tags, AND notes to items_fts

    // ── Migration idempotency ────────────────────────────────

    #[test]
    fn test_registry_migration_idempotent() {
        let dir = temp_dir();
        let db_path = dir.path().join("registry.db");

        let conn1 = init_registry_db(&db_path).unwrap();
        drop(conn1);

        // Running migration again should not fail or duplicate
        let conn2 = init_registry_db(&db_path).unwrap();
        let version: i32 = conn2
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn test_library_migration_idempotent() {
        let dir = temp_dir();
        let db_path = dir.path().join("metadata.db");

        let conn1 = init_library_db(&db_path).unwrap();
        drop(conn1);

        let conn2 = init_library_db(&db_path).unwrap();
        let version: i32 = conn2
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
    }

    // ── Item CRUD ────────────────────────────────────────────

    fn make_test_item(id: &str, suffix: &str) -> Item {
        Item {
            id: id.to_string(),
            file_path: format!("/lib/images/test{}.png", suffix),
            file_name: format!("test{}.png", suffix),
            file_size: 1024,
            file_type: "PNG".to_string(),
            width: Some(100),
            height: Some(100),
            color: None,
            tags: "".to_string(),
            rating: 0,
            notes: "".to_string(),
            sha256: format!("hash{}", suffix),
            status: "active".to_string(),
            created_at: "2026-04-02T12:00:00".to_string(),
            modified_at: "2026-04-02T12:00:00".to_string(),
        }
    }

    #[test]
    fn test_insert_and_query_item() {
        let dir = temp_dir();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let item = make_test_item("item-1", "1");
        insert_item(&conn, &item).unwrap();

        let fetched = get_item(&conn, "item-1").unwrap();
        assert_eq!(fetched.id, "item-1");
        assert_eq!(fetched.file_name, "test1.png");
        assert_eq!(fetched.file_path, "/lib/images/test1.png");
        assert_eq!(fetched.width, Some(100));
    }

    #[test]
    fn test_query_items_with_pagination() {
        let dir = temp_dir();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        for i in 0..15 {
            let item = make_test_item(&format!("item-{}", i), &i.to_string());
            insert_item(&conn, &item).unwrap();
        }

        let filter = ItemFilter {
            folder_id: None,
            file_types: None,
            tags: None,
            rating_min: None,
            search_query: None,
        };
        let sort = SortSpec {
            field: "created_at".into(),
            direction: "asc".into(),
        };
        let pagination = Pagination { offset: 5, limit: 5 };

        let page = query_items(&conn, &filter, &sort, &pagination).unwrap();
        assert_eq!(page.items.len(), 5);
        assert_eq!(page.total, 15);
        assert_eq!(page.offset, 5);
    }

    #[test]
    fn test_delete_item() {
        let dir = temp_dir();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let item = make_test_item("item-del", "del");
        insert_item(&conn, &item).unwrap();
        delete_item(&conn, "item-del", true).unwrap();

        let result = get_item(&conn, "item-del");
        assert!(result.is_err());
    }

    // ── FTS search (via search module) ────────────────────────

    #[test]
    fn test_fts_search_by_filename() {
        let dir = temp_dir();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let mut item1 = make_test_item("item-1", "1");
        item1.file_name = "sunset_beach.jpg".into();
        item1.file_path = "/lib/images/sunset_beach.jpg".into();

        let mut item2 = make_test_item("item-2", "2");
        item2.file_name = "mountain_snow.png".into();
        item2.file_path = "/lib/images/mountain_snow.png".into();

        insert_item(&conn, &item1).unwrap();
        insert_item(&conn, &item2).unwrap();

        let results = crate::search::search_items(&conn, "sunset", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.file_name, "sunset_beach.jpg");
    }

    #[test]
    fn test_fts_search_by_tag() {
        let dir = temp_dir();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let mut item1 = make_test_item("item-1", "1");
        item1.tags = "landscape,nature".into();

        let mut item2 = make_test_item("item-2", "2");
        item2.tags = "portrait,studio".into();

        insert_item(&conn, &item1).unwrap();
        insert_item(&conn, &item2).unwrap();

        let results = crate::search::search_items(&conn, "nature", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "item-1");
    }

    #[test]
    fn test_fts_update_trigger() {
        let dir = temp_dir();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let mut item = make_test_item("item-1", "1");
        item.file_name = "old_name.jpg".into();
        insert_item(&conn, &item).unwrap();

        // Update the item's file_name
        conn.execute(
            "UPDATE items SET file_name = 'new_name.jpg' WHERE id = 'item-1'",
            [],
        )
        .unwrap();

        // FTS should reflect the new name
        let results = crate::search::search_items(&conn, "new_name", 10).unwrap();
        assert_eq!(results.len(), 1);

        // Old name should not match
        let old_results = crate::search::search_items(&conn, "old_name", 10).unwrap();
        assert_eq!(old_results.len(), 0);
    }

    // ── Dedup (file_path UNIQUE) ─────────────────────────────

    #[test]
    fn test_duplicate_file_path_rejected() {
        let dir = temp_dir();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let item1 = make_test_item("item-1", "dup");
        let mut item2 = make_test_item("item-2", "dup");
        item2.file_path = item1.file_path.clone();

        insert_item(&conn, &item1).unwrap();
        let result = insert_item(&conn, &item2);
        assert!(result.is_err());

        match result.unwrap_err() {
            AppError::Duplicate(msg) => assert!(msg.contains("UNIQUE")),
            other => panic!("Expected Duplicate, got {:?}", other),
        }
    }

    // ── Library CRUD ─────────────────────────────────────────

    #[test]
    fn test_library_crud() {
        let dir = temp_dir();
        let db_path = dir.path().join("registry.db");
        let conn = init_registry_db(&db_path).unwrap();

        let lib = create_library(&conn, "Test Library", "/tmp/test-lib").unwrap();
        assert!(!lib.id.is_empty());
        assert_eq!(lib.name, "Test Library");

        let fetched = get_library(&conn, &lib.id).unwrap();
        assert_eq!(fetched.name, "Test Library");
        assert_eq!(fetched.path, "/tmp/test-lib");

        let libs = list_libraries(&conn).unwrap();
        assert_eq!(libs.len(), 1);

        delete_library(&conn, &lib.id).unwrap();
        let libs = list_libraries(&conn).unwrap();
        assert_eq!(libs.len(), 0);
    }

    // ── Tags ─────────────────────────────────────────────────

    #[test]
    fn test_get_all_tags() {
        let dir = temp_dir();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let mut item1 = make_test_item("item-1", "1");
        item1.tags = "landscape,nature".into();
        let mut item2 = make_test_item("item-2", "2");
        item2.tags = "portrait,nature".into();
        let mut item3 = make_test_item("item-3", "3");
        item3.tags = "".into();

        insert_item(&conn, &item1).unwrap();
        insert_item(&conn, &item2).unwrap();
        insert_item(&conn, &item3).unwrap();

        let tags = get_all_tags(&conn).unwrap();
        assert_eq!(tags, vec!["landscape", "nature", "portrait"]);
    }

    // ── Foreign keys ─────────────────────────────────────────

    #[test]
    fn test_foreign_keys_enforced() {
        let dir = temp_dir();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        // Inserting item_folders with non-existent IDs should fail
        let result = conn.execute(
            "INSERT INTO item_folders (item_id, folder_id) VALUES ('no-item', 'no-folder')",
            [],
        );
        assert!(result.is_err());
    }
}
```

---

### Step 2: Add `tempfile` dev-dependency and `mod db;` to main.rs

Add to `src-tauri/Cargo.toml` at the end:

```toml
[dev-dependencies]
tempfile = "3"
```

Update `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod error;
mod models;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

### Step 3: Run all db tests

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test --lib db
```

Expected:

```
running 15 tests
test db::tests::test_registry_schema_creation ... ok
test db::tests::test_registry_wal_mode ... ok
test db::tests::test_library_schema_all_tables ... ok
test db::tests::test_library_fts_triggers_exist ... ok
test db::tests::test_registry_migration_idempotent ... ok
test db::tests::test_library_migration_idempotent ... ok
test db::tests::test_insert_and_query_item ... ok
test db::tests::test_query_items_with_pagination ... ok
test db::tests::test_delete_item ... ok
test db::tests::test_fts_search_by_filename ... ok
test db::tests::test_fts_search_by_tag ... ok
test db::tests::test_fts_update_trigger ... ok
test db::tests::test_duplicate_file_path_rejected ... ok
test db::tests::test_library_crud ... ok
test db::tests::test_get_all_tags ... ok
test db::tests::test_foreign_keys_enforced ... ok

test result: ok. 16 passed; 0 failed; 0 ignored
```

---

### Step 4: Run full test suite

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test --lib
```

Expected: all 31 tests pass (7 error + 8 models + 16 db).

---

### Step 5: Commit

```bash
cd /Users/carpon/web/shark
git add src-tauri/src/db.rs src-tauri/src/main.rs src-tauri/Cargo.toml
git commit -m "Add database layer with registry/library schema, CRUD helpers, FTS5, and tests"
```

---

## Task 4: Thumbnail Generation (thumbnail.rs)

**Files to create:** `src-tauri/src/thumbnail.rs`
**File to modify:** `src-tauri/src/main.rs` (add `mod thumbnail;`)

---

### Step 1: Write test and implementation for `thumbnail.rs`

Create `src-tauri/src/thumbnail.rs`:

```rust
use std::fs;
use std::io::Cursor;
use std::path::Path;

use image::codecs::jpeg::JpegEncoder;
use image::DynamicImage;

use crate::error::AppError;

/// Generate a thumbnail for the given source image.
///
/// - `src_path`: path to the source image file
/// - `thumb_dir`: base thumbnail directory (e.g., `<library>/.shark/thumbs/256/`)
/// - `item_id`: unique item identifier (used as filename)
/// - `size`: maximum dimension (width or height) for the thumbnail
///
/// Returns the path to the generated JPEG thumbnail.
pub fn generate_thumbnail(
    src_path: &Path,
    thumb_dir: &Path,
    item_id: &str,
    size: u32,
) -> Result<std::path::PathBuf, AppError> {
    // Open source image
    let img = image::open(src_path)
        .map_err(|e| AppError::Thumbnail(format!("Failed to open image {}: {}", src_path.display(), e)))?;

    // Generate thumbnail preserving aspect ratio
    let thumb = img.thumbnail(size, size);

    // Create output directory if it doesn't exist
    fs::create_dir_all(thumb_dir)?;

    // Encode to JPEG in memory, then write to file
    let dest_path = thumb_dir.join(format!("{}.jpg", item_id));
    let mut buffer = Cursor::new(Vec::new());
    {
        let encoder = JpegEncoder::new_with_quality(&mut buffer, 85);
        encoder
            .encode_image(&thumb)
            .map_err(|e| AppError::Thumbnail(format!("JPEG encode failed: {}", e)))?;
    }

    fs::write(&dest_path, buffer.into_inner())?;

    Ok(dest_path)
}

/// Check if a file extension is supported for thumbnail generation.
pub fn is_supported_image(path: &Path) -> bool {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") | Some("png") | Some("gif") | Some("webp") | Some("bmp") => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::TempDir::new().unwrap()
    }

    /// Helper: create a small test PNG image at the given path
    fn create_test_image(path: &Path, width: u32, height: u32) {
        let img = DynamicImage::new_rgba8(width, height);
        img.save(path).unwrap();
    }

    // ── test_generate_thumbnail_jpg ──────────────────────────

    #[test]
    fn test_generate_thumbnail_jpg() {
        let dir = temp_dir();
        let src_path = dir.path().join("source.jpg");

        // Create a 800x600 test image saved as JPEG
        let img = DynamicImage::new_rgba8(800, 600);
        img.save(&src_path).unwrap();

        let thumb_dir = dir.path().join("thumbs").join("256");
        let result = generate_thumbnail(&src_path, &thumb_dir, "test-item-1", 256);

        let out_path = result.unwrap();
        assert!(out_path.exists());
        assert_eq!(out_path.file_name().unwrap(), "test-item-1.jpg");

        // Verify the output is a valid image with dimensions <= 256
        let thumb_img = image::open(&out_path).unwrap();
        assert!(thumb_img.width() <= 256);
        assert!(thumb_img.height() <= 256);
    }

    // ── test_generate_thumbnail_png ───────────────────────────

    #[test]
    fn test_generate_thumbnail_png() {
        let dir = temp_dir();
        let src_path = dir.path().join("source.png");
        create_test_image(&src_path, 1920, 1080);

        let thumb_dir = dir.path().join("thumbs").join("256");
        let out_path = generate_thumbnail(&src_path, &thumb_dir, "test-item-2", 256).unwrap();

        assert!(out_path.exists());

        let thumb_img = image::open(&out_path).unwrap();
        assert!(thumb_img.width() <= 256);
        assert!(thumb_img.height() <= 256);
        // Aspect ratio: 1920/1080 ≈ 1.78, thumbnail should be 256x144
        assert_eq!(thumb_img.width(), 256);
        assert_eq!(thumb_img.height(), 144);
    }

    // ── test_generate_thumbnail_small_source ──────────────────

    #[test]
    fn test_generate_thumbnail_small_source_no_upscale() {
        let dir = temp_dir();
        let src_path = dir.path().join("small.png");
        create_test_image(&src_path, 50, 50);

        let thumb_dir = dir.path().join("thumbs");
        let out_path = generate_thumbnail(&src_path, &thumb_dir, "test-small", 256).unwrap();

        let thumb_img = image::open(&out_path).unwrap();
        // image::thumbnail does not upscale — should remain 50x50
        assert_eq!(thumb_img.width(), 50);
        assert_eq!(thumb_img.height(), 50);
    }

    // ── test_corrupted_file ───────────────────────────────────

    #[test]
    fn test_corrupted_file_returns_thumbnail_error() {
        let dir = temp_dir();
        let src_path = dir.path().join("corrupted.png");

        // Write garbage data
        fs::write(&src_path, b"this is not an image").unwrap();

        let thumb_dir = dir.path().join("thumbs");
        let result = generate_thumbnail(&src_path, &thumb_dir, "bad-item", 256);

        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Thumbnail(msg) => assert!(msg.contains("Failed to open image")),
            other => panic!("Expected Thumbnail error, got {:?}", other),
        }
    }

    // ── test_nonexistent_source ───────────────────────────────

    #[test]
    fn test_nonexistent_source_returns_thumbnail_error() {
        let dir = temp_dir();
        let src_path = dir.path().join("does_not_exist.png");

        let thumb_dir = dir.path().join("thumbs");
        let result = generate_thumbnail(&src_path, &thumb_dir, "no-item", 256);

        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Thumbnail(msg) => assert!(msg.contains("Failed to open image")),
            other => panic!("Expected Thumbnail error, got {:?}", other),
        }
    }

    // ── test_creates_output_directory ─────────────────────────

    #[test]
    fn test_creates_output_directory() {
        let dir = temp_dir();
        let src_path = dir.path().join("source.png");
        create_test_image(&src_path, 100, 100);

        // thumb_dir does not exist yet
        let thumb_dir = dir.path().join("nested").join("deep").join("256");
        assert!(!thumb_dir.exists());

        let out_path = generate_thumbnail(&src_path, &thumb_dir, "test-dir", 256).unwrap();
        assert!(thumb_dir.exists());
        assert!(out_path.exists());
    }

    // ── test_is_supported_image ───────────────────────────────

    #[test]
    fn test_is_supported_image() {
        assert!(is_supported_image(Path::new("photo.jpg")));
        assert!(is_supported_image(Path::new("photo.JPEG")));
        assert!(is_supported_image(Path::new("photo.png")));
        assert!(is_supported_image(Path::new("photo.gif")));
        assert!(is_supported_image(Path::new("photo.webp")));
        assert!(is_supported_image(Path::new("photo.bmp")));
        assert!(!is_supported_image(Path::new("document.pdf")));
        assert!(!is_supported_image(Path::new("video.mp4")));
        assert!(!is_supported_image(Path::new("noext")));
    }

    // ── test_large_size_1024 ──────────────────────────────────

    #[test]
    fn test_generate_thumbnail_1024_tier() {
        let dir = temp_dir();
        let src_path = dir.path().join("large.png");
        create_test_image(&src_path, 4000, 3000);

        let thumb_dir = dir.path().join("thumbs").join("1024");
        let out_path = generate_thumbnail(&src_path, &thumb_dir, "test-1024", 1024).unwrap();

        let thumb_img = image::open(&out_path).unwrap();
        assert_eq!(thumb_img.width(), 1024);
        assert_eq!(thumb_img.height(), 768); // 4000/3000 aspect = 4/3, so 1024 x 768
    }
}
```

---

### Step 2: Add `mod thumbnail;` to main.rs

Update `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod error;
mod models;
mod thumbnail;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

### Step 3: Run all thumbnail tests

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test --lib thumbnail
```

Expected:

```
running 8 tests
test thumbnail::tests::test_generate_thumbnail_jpg ... ok
test thumbnail::tests::test_generate_thumbnail_png ... ok
test thumbnail::tests::test_generate_thumbnail_small_source_no_upscale ... ok
test thumbnail::tests::test_corrupted_file_returns_thumbnail_error ... ok
test thumbnail::tests::test_nonexistent_source_returns_thumbnail_error ... ok
test thumbnail::tests::test_creates_output_directory ... ok
test thumbnail::tests::test_is_supported_image ... ok
test thumbnail::tests::test_generate_thumbnail_1024_tier ... ok

test result: ok. 8 passed; 0 failed; 0 ignored
```

---

### Step 4: Run full test suite

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test --lib
```

Expected: all 39 tests pass (7 error + 8 models + 16 db + 8 thumbnail).

```
running 39 tests
... all 39 pass ...
test result: ok. 39 passed; 0 failed; 0 ignored
```

---

### Step 5: Verify `cargo check` passes

```bash
cd /Users/carpon/web/shark/src-tauri && cargo check
```

Expected:

```
Checking shark v0.1.0 (...) Finished `dev` profile [unoptimized + debuginfo] target(s) in X.XXs
```

No warnings, no errors.

---

### Step 6: Commit

```bash
cd /Users/carpon/web/shark
git add src-tauri/src/thumbnail.rs src-tauri/src/main.rs
git commit -m "Add thumbnail generation with JPEG encoding, size tiers, and tests"
```

---

## Summary of All Commits After Tasks 1-4

| Commit | Content |
|--------|---------|
| (scaffold) | Project scaffolding: Tauri v2 + React + TypeScript + Tailwind v4 |
| `Add error types and data models with serialization tests` | `error.rs` (AppError + From impls + 7 tests), `models.rs` (all types + 8 tests) |
| `Add database layer with registry/library schema, CRUD helpers, FTS5, and tests` | `db.rs` (DbState, init functions, migrations, CRUD, FTS search, tags + 16 tests) |
| `Add thumbnail generation with JPEG encoding, size tiers, and tests` | `thumbnail.rs` (generate_thumbnail, is_supported_image + 8 tests) |

**Total tests: 39** — all passing, covering serialization, schema creation, migration idempotency, CRUD operations, FTS5 search with triggers, duplicate rejection, foreign key enforcement, thumbnail generation across formats and sizes, error handling for corrupted/missing files.

## Task 5: Import Engine (indexer.rs)

**Files:**
- Create: `src-tauri/src/indexer.rs`
- Test: inline `#[cfg(test)]` module in same file

**Depends on:** Task 4 (thumbnail.rs), Task 3 (db.rs), Task 2 (models.rs, error.rs)

---

### Step 1: Write the failing test — `test_import_directory`

Add to `src-tauri/src/indexer.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::models::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_test_db() -> rusqlite::Connection {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("metadata.db");
        db::init_library_db(&db_path).unwrap()
    }

    fn create_test_image(dir: &std::path::Path, name: &str, width: u32, height: u32) -> std::path::PathBuf {
        let path = dir.join(name);
        let img = image::RgbImage::from_pixel(width, height, image::Rgb([128, 128, 128]));
        img.save(&path).unwrap();
        path
    }

    #[test]
    fn test_import_directory() {
        let conn = setup_test_db();
        let source_dir = TempDir::new().unwrap();
        let library_dir = TempDir::new().unwrap();

        // Create 3 test images
        create_test_image(source_dir.path(), "img1.jpg", 800, 600);
        create_test_image(source_dir.path(), "img2.png", 1024, 768);
        create_test_image(source_dir.path(), "img3.bmp", 640, 480);

        let result = import_directory(&conn, library_dir.path(), source_dir.path()).unwrap();

        assert_eq!(result.imported, 3);
        assert_eq!(result.skipped, 0);
        assert_eq!(result.duplicates, 0);

        // Verify DB has 3 items
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM items").unwrap();
        let count: i64 = stmt.query_row([], |row| row.get(0)).unwrap();
        assert_eq!(count, 3);
    }
}
```

`tempfile = "3"` should already be in `[dev-dependencies]` from Task 3.

### Step 2: Run test to verify it fails

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test test_import_directory
```

Expected: FAIL — `import_directory` function not defined.

---

### Step 3: Write minimal `import_directory` + helper functions

Create `src-tauri/src/indexer.rs`:

```rust
use crate::db;
use crate::error::AppError;
use crate::models::{ImportResult, Item};
use crate::thumbnail;
use rayon::prelude::*;
use sha2::{Digest, Sha256};
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif", "svg", "ico", "avif",
];

fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .map(|ext| IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn collect_image_files(source_path: &Path) -> Result<Vec<PathBuf>, AppError> {
    let files: Vec<PathBuf> = walkdir::WalkDir::new(source_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| is_image_file(e.path()))
        .map(|e| e.into_path())
        .collect();
    Ok(files)
}

fn compute_sha256(path: &Path) -> Result<String, AppError> {
    let mut hasher = Sha256::new();
    let mut file = fs::File::open(path).map_err(|e| AppError::Io(e.to_string()))?;
    std::io::copy(&mut file, &mut hasher)
        .map_err(|e| AppError::Io(e.to_string()))?;
    let result = hasher.finalize();
    Ok(format!("{:x}", result))
}

fn get_file_type(path: &Path) -> String {
    path.extension()
        .and_then(OsStr::to_str)
        .map(|s| s.to_uppercase())
        .unwrap_or_else(|| "UNKNOWN".to_string())
}

fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339()
}

struct ProcessedFile {
    id: String,
    dest_path: PathBuf,
    file_name: String,
    file_size: u64,
    file_type: String,
    sha256: String,
    width: u32,
    height: u32,
}

fn process_single_file(
    source_path: &Path,
    images_dir: &Path,
    thumbs_dir: &Path,
) -> Result<ProcessedFile, AppError> {
    let sha256 = compute_sha256(source_path)?;
    let ext = source_path
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("jpg");

    // Generate ONE id — used for both file name and item ID
    let id = Uuid::new_v4().to_string();
    let dest_name = format!("{}.{}", id, ext);
    let dest_path = images_dir.join(&dest_name);

    // Copy file to library
    fs::copy(source_path, &dest_path).map_err(|e| AppError::Io(e.to_string()))?;

    // Extract dimensions
    let img = image::open(&dest_path).map_err(|e| AppError::Io(e.to_string()))?;
    let (width, height) = (img.width(), img.height());

    // Generate 256px thumbnail for grid view
    let thumb_256_dir = thumbs_dir.join("256");
    fs::create_dir_all(&thumb_256_dir).map_err(|e| AppError::Io(e.to_string()))?;
    thumbnail::generate_thumbnail(&dest_path, &thumb_256_dir, &id, 256)?;

    let metadata = fs::metadata(source_path).map_err(|e| AppError::Io(e.to_string()))?;

    Ok(ProcessedFile {
        id,
        dest_path,
        file_name: source_path
            .file_name()
            .and_then(OsStr::to_str)
            .unwrap_or("unknown")
            .to_string(),
        file_size: metadata.len(),
        file_type: get_file_type(source_path),
        sha256,
        width,
        height,
    })
}

pub fn import_directory(
    conn: &rusqlite::Connection,
    library_path: &Path,
    source_path: &Path,
) -> Result<ImportResult, AppError> {
    let images_dir = library_path.join("images");
    let thumbs_dir = library_path.join(".shark").join("thumbs");
    fs::create_dir_all(&images_dir).map_err(|e| AppError::Io(e.to_string()))?;

    // Phase 1: collect all image files
    let files = collect_image_files(source_path)?;
    if files.is_empty() {
        return Ok(ImportResult {
            imported: 0,
            skipped: 0,
            duplicates: 0,
        });
    }

    // Phase 2: parallel processing (no DB lock held)
    let results: Vec<Result<ProcessedFile, AppError>> = files
        .par_iter()
        .map(|path| process_single_file(path, &images_dir, &thumbs_dir))
        .collect();

    // Phase 3: sequential DB insertion with dedup
    let mut imported = 0;
    let mut skipped = 0;
    let mut duplicates = 0;

    for result in results {
        match result {
            Ok(pf) => {
                // Check for duplicate by sha256
                let is_dup: bool = conn
                    .query_row(
                        "SELECT COUNT(*) FROM items WHERE sha256 = ?1",
                        rusqlite::params![pf.sha256],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap_or(0)
                    > 0;

                if is_dup {
                    // Remove the copied file since it's a duplicate
                    let _ = fs::remove_file(&pf.dest_path);
                    duplicates += 1;
                    continue;
                }

                let now = now_iso8601();
                let item = Item {
                    id: pf.id.clone(),
                    file_path: pf.dest_path.to_string_lossy().to_string(),
                    file_name: pf.file_name,
                    file_size: pf.file_size as i64,
                    file_type: pf.file_type,
                    width: Some(pf.width as i64),
                    height: Some(pf.height as i64),
                    color: None,
                    tags: String::new(),
                    rating: 0,
                    notes: String::new(),
                    sha256: pf.sha256,
                    status: "active".to_string(),
                    created_at: now.clone(),
                    modified_at: now,
                };
                db::insert_item(conn, &item)?;
                imported += 1;
            }
            Err(_) => {
                skipped += 1;
            }
        }
    }

    Ok(ImportResult {
        imported,
        skipped,
        duplicates,
    })
}
```

**Note:** Timestamps use `chrono::Utc::now().to_rfc3339()` for reliable ISO-8601 formatting with proper timezone handling.

---

### Step 4: Run test to verify it passes

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test test_import_directory
```

Expected: PASS.

---

### Step 5: Write the failing test — `test_import_dedup`

```rust
#[test]
fn test_import_dedup() {
    let conn = setup_test_db();
    let source_dir = TempDir::new().unwrap();
    let library_dir = TempDir::new().unwrap();

    // Create identical files (same content)
    let img = image::RgbImage::from_pixel(100, 100, image::Rgb([200, 100, 50]));
    img.save(source_dir.path().join("original.jpg")).unwrap();
    // Copy to a second location
    fs::copy(
        source_dir.path().join("original.jpg"),
        source_dir.path().join("copy.jpg"),
    )
    .unwrap();

    let result = import_directory(&conn, library_dir.path(), source_dir.path()).unwrap();

    assert_eq!(result.imported, 1);
    assert_eq!(result.duplicates, 1);
}
```

---

### Step 6: Run test to verify it passes

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test test_import_dedup
```

Expected: PASS (dedup logic already in `import_directory`).

---

### Step 7: Write the failing test — `test_import_mixed_formats`

```rust
#[test]
fn test_import_mixed_formats() {
    let conn = setup_test_db();
    let source_dir = TempDir::new().unwrap();
    let library_dir = TempDir::new().unwrap();

    create_test_image(source_dir.path(), "photo.jpg", 800, 600);
    create_test_image(source_dir.path(), "graphic.png", 1024, 768);

    let result = import_directory(&conn, library_dir.path(), source_dir.path()).unwrap();

    assert_eq!(result.imported, 2);

    // Verify file types stored correctly
    let mut stmt = conn
        .prepare("SELECT file_type FROM items ORDER BY file_type")
        .unwrap();
    let types: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(|t| t.ok())
        .collect();
    assert!(types.contains(&"JPG".to_string()) || types.contains(&"JPEG".to_string()));
    assert!(types.contains(&"PNG".to_string()));
}
```

---

### Step 8: Run test to verify it passes

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test test_import_mixed_formats
```

Expected: PASS.

---

### Step 9: Commit

```bash
cd /Users/carpon/web/shark
git add src-tauri/src/indexer.rs src-tauri/Cargo.toml
git commit -m "feat: add import engine with parallel processing, SHA256 dedup, and thumbnail generation"
```

---

## Task 6: Search Module (search.rs)

**Files:**
- Create: `src-tauri/src/search.rs`
- Test: inline `#[cfg(test)]` module in same file

**Depends on:** Task 3 (db.rs — FTS5 tables and triggers already created)

---

### Step 1: Write the failing test — `test_basic_search`

Create `src-tauri/src/search.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::models::Item;
    use tempfile::TempDir;

    fn setup_test_db() -> rusqlite::Connection {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("metadata.db");
        db::init_library_db(&db_path).unwrap()
    }

    fn insert_test_item(conn: &rusqlite::Connection, id: &str, file_name: &str, tags: &str) {
        let item = Item {
            id: id.to_string(),
            file_path: format!("/test/{}", file_name),
            file_name: file_name.to_string(),
            file_size: 1024,
            file_type: "JPG".to_string(),
            width: Some(800),
            height: Some(600),
            color: None,
            tags: tags.to_string(),
            rating: 0,
            notes: String::new(),
            sha256: format!("hash_{}", id),
            status: "active".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            modified_at: "2026-01-01T00:00:00Z".to_string(),
        };
        db::insert_item(conn, &item).unwrap();
    }

    #[test]
    fn test_basic_search() {
        let conn = setup_test_db();
        insert_test_item(&conn, "1", "sunset_beach.jpg", "");
        insert_test_item(&conn, "2", "mountain_lake.png", "");
        insert_test_item(&conn, "3", "sunset_desert.jpg", "");

        let results = search_items(&conn, "sunset", 10).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| r.item.file_name.contains("sunset")));
    }
}
```

---

### Step 2: Run test to verify it fails

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test test_basic_search
```

Expected: FAIL — `search_items` function not defined.

---

### Step 3: Write `search_items` implementation

Add to `src-tauri/src/search.rs`:

```rust
use crate::error::AppError;
use crate::models::{Item, SearchResult};
use rusqlite::params;

/// FTS5 full-text search with prefix matching.
///
/// **Search semantics (Phase 1):** Multi-token queries use OR — "sunset beach"
/// matches items containing EITHER word. This provides broad matching suitable
/// for image search. AND semantics (both words required) can be added as a
/// toggle in Phase 2 if users request stricter matching.
pub fn search_items(
    conn: &rusqlite::Connection,
    query: &str,
    limit: i32,
) -> Result<Vec<SearchResult>, AppError> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    // Sanitize: remove FTS5 special characters that could cause syntax errors
    let sanitized: String = query
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '_')
        .collect::<String>()
        .split_whitespace()
        .map(|token| format!("{}*", token)) // prefix matching
        .collect::<Vec<_>>()
        .join(" OR ");

    if sanitized.is_empty() {
        return Ok(Vec::new());
    }

    let mut stmt = conn
        .prepare(
            "SELECT i.id, i.file_path, i.file_name, i.file_size, i.file_type,
                    i.width, i.height, i.color, i.tags, i.rating,
                    i.notes, i.sha256, i.status, i.created_at, i.modified_at,
                    fts.rank
             FROM items_fts fts
             JOIN items i ON i.rowid = fts.rowid
             WHERE items_fts MATCH ?
             ORDER BY fts.rank
             LIMIT ?",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

    let results = stmt
        .query_map(params![sanitized, limit], |row| {
            Ok(SearchResult {
                item: Item {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    file_name: row.get(2)?,
                    file_size: row.get(3)?,
                    file_type: row.get(4)?,
                    width: row.get(5)?,
                    height: row.get(6)?,
                    color: row.get(7)?,
                    tags: row.get(8)?,
                    rating: row.get(9)?,
                    notes: row.get(10)?,
                    sha256: row.get(11)?,
                    status: row.get(12)?,
                    created_at: row.get(13)?,
                    modified_at: row.get(14)?,
                },
                rank: row.get(15)?,
            })
        })
        .map_err(|e| AppError::Database(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(results)
}
```

---

### Step 4: Run test to verify it passes

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test test_basic_search
```

Expected: PASS.

---

### Step 5: Write remaining tests

Add to `src-tauri/src/search.rs` tests module:

```rust
#[test]
fn test_tag_search() {
    let conn = setup_test_db();
    insert_test_item(&conn, "1", "photo1.jpg", "landscape, nature");
    insert_test_item(&conn, "2", "photo2.jpg", "portrait, people");
    insert_test_item(&conn, "3", "photo3.jpg", "landscape, mountains");

    let results = search_items(&conn, "landscape", 10).unwrap();
    assert_eq!(results.len(), 2);
}

#[test]
fn test_empty_query() {
    let conn = setup_test_db();
    insert_test_item(&conn, "1", "test.jpg", "");

    let results = search_items(&conn, "", 10).unwrap();
    assert!(results.is_empty());

    let results = search_items(&conn, "   ", 10).unwrap();
    assert!(results.is_empty());
}

#[test]
fn test_no_results() {
    let conn = setup_test_db();
    insert_test_item(&conn, "1", "test.jpg", "");

    let results = search_items(&conn, "nonexistent_xyz", 10).unwrap();
    assert!(results.is_empty());
}
```

---

### Step 6: Run all search tests

```bash
cd /Users/carpon/web/shark/src-tauri && cargo test -- search
```

Expected: All 4 search tests PASS.

---

### Step 7: Commit

```bash
cd /Users/carpon/web/shark
git add src-tauri/src/search.rs
git commit -m "feat: add FTS5 search module with prefix matching and query sanitization"
```

---

## Task 7: Tauri IPC Commands (commands.rs)

**Files:**
- Create: `src-tauri/src/commands.rs`

**Depends on:** Tasks 1-6 (all backend modules)

---

### Step 1: Create commands.rs with all Phase 1 IPC handlers

Create `src-tauri/src/commands.rs`:

```rust
use crate::db::{self, DbState};
use crate::error::AppError;
use crate::indexer;
use crate::models::*;
use crate::search;
use tauri::State;

#[tauri::command]
pub fn create_library(
    name: String,
    path: String,
    state: State<'_, DbState>,
) -> Result<Library, AppError> {
    let conn = state.registry.lock().map_err(|e| AppError::Database(e.to_string()))?;
    db::create_library(&conn, &name, &path)
}

#[tauri::command]
pub fn open_library(
    path: String,
    state: State<'_, DbState>,
) -> Result<Library, AppError> {
    // 1. Look up library in registry by path
    let library = {
        let reg_conn = state.registry.lock().map_err(|e| AppError::Database(e.to_string()))?;
        db::get_library_by_path(&reg_conn, &path)?
    };

    // 2. Open per-library DB
    let lib_db_path = std::path::Path::new(&path).join(".shark").join("metadata.db");
    let lib_conn = db::init_library_db(&lib_db_path)?;

    // 3. Store in state
    let mut library_conn = state.library.lock().map_err(|e| AppError::Database(e.to_string()))?;
    *library_conn = Some(lib_conn);

    Ok(library)
}

#[tauri::command]
pub fn list_libraries(
    state: State<'_, DbState>,
) -> Result<Vec<Library>, AppError> {
    let conn = state.registry.lock().map_err(|e| AppError::Database(e.to_string()))?;
    db::list_libraries(&conn)
}

#[tauri::command]
pub fn import_files(
    library_id: String,
    source_path: String,
    state: State<'_, DbState>,
) -> Result<ImportResult, AppError> {
    // 1. Get library path from registry (lock registry first, release before library lock)
    let library = {
        let reg_conn = state.registry.lock().map_err(|e| AppError::Database(e.to_string()))?;
        db::get_library(&reg_conn, &library_id)?
    };

    // 2. Import using library DB
    let library_conn = state.library.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = library_conn.as_ref().ok_or(AppError::NoActiveLibrary)?;

    indexer::import_directory(
        conn,
        std::path::Path::new(&library.path),
        std::path::Path::new(&source_path),
    )
}

#[tauri::command]
pub fn query_items(
    library_id: String,
    filter: ItemFilter,
    sort: SortSpec,
    page: Pagination,
    state: State<'_, DbState>,
) -> Result<ItemPage, AppError> {
    let library_conn = state.library.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = library_conn.as_ref().ok_or(AppError::NoActiveLibrary)?;
    db::query_items(conn, &filter, &sort, &page)
}

#[tauri::command]
pub fn get_item_detail(
    item_id: String,
    state: State<'_, DbState>,
) -> Result<Item, AppError> {
    let library_conn = state.library.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = library_conn.as_ref().ok_or(AppError::NoActiveLibrary)?;
    db::get_item(conn, &item_id)
}

#[tauri::command]
pub fn delete_items(
    item_ids: Vec<String>,
    permanent: bool,
    state: State<'_, DbState>,
) -> Result<(), AppError> {
    let library_conn = state.library.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = library_conn.as_ref().ok_or(AppError::NoActiveLibrary)?;
    for id in &item_ids {
        db::delete_item(conn, id, permanent)?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_thumbnail(
    item_id: String,
    size: ThumbnailSize,
    state: State<'_, DbState>,
) -> Result<String, AppError> {
    let library_conn = state.library.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = library_conn.as_ref().ok_or(AppError::NoActiveLibrary)?;

    let item = db::get_item(conn, &item_id)?;

    // Derive library path from item's file_path: <library>/images/<id>.ext
    let lib_path = std::path::Path::new(&item.file_path)
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_default();

    let thumb_dir = lib_path.join(".shark").join("thumbs").join(size.subdir());
    let thumb_path = thumb_dir.join(format!("{}.jpg", item_id));

    if !thumb_path.exists() {
        // Generate on-demand for 1024px; 256px should exist from import
        if matches!(size, ThumbnailSize::S1024) {
            std::fs::create_dir_all(&thumb_dir)?;
            crate::thumbnail::generate_thumbnail(
                std::path::Path::new(&item.file_path),
                &thumb_dir,
                &item_id,
                size.pixel_size(),
            )?;
        } else {
            return Err(AppError::NotFound(format!("thumbnail for item {}", item_id)));
        }
    }

    Ok(thumb_path.to_string_lossy().to_string())
}

/// Batch thumbnail fetch — returns thumbnail paths for multiple items in a single IPC call.
/// Replaces N individual get_thumbnail calls with one batched call for grid performance.
#[tauri::command]
pub fn get_thumbnails_batch(
    item_ids: Vec<String>,
    size: ThumbnailSize,
    state: State<'_, DbState>,
) -> Result<std::collections::HashMap<String, String>, AppError> {
    let library_conn = state.library.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = library_conn.as_ref().ok_or(AppError::NoActiveLibrary)?;

    let mut result = std::collections::HashMap::new();

    for item_id in item_ids {
        // Look up thumbnail path directly from thumbnails table
        let thumb_path: Option<String> = conn
            .query_row(
                "SELECT CASE
                    WHEN ?2 = 'S256' THEN t.thumb_256_path
                    ELSE t.thumb_1024_path
                 END
                 FROM thumbnails t
                 WHERE t.item_id = ?1",
                rusqlite::params![item_id, format!("{:?}", size)],
                |row| row.get(0),
            )
            .ok()
            .flatten();

        if let Some(path) = thumb_path {
            if std::path::Path::new(&path).exists() {
                result.insert(item_id, path);
                continue;
            }
        }

        // Fallback: derive path from item file_path (thumbnails may not be in DB yet)
        if let Ok(item) = db::get_item(conn, &item_id) {
            let lib_path = std::path::Path::new(&item.file_path)
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.to_path_buf())
                .unwrap_or_default();

            let thumb_dir = lib_path.join(".shark").join("thumbs").join(size.subdir());
            let thumb_path = thumb_dir.join(format!("{}.jpg", item_id));

            if thumb_path.exists() {
                result.insert(item_id, thumb_path.to_string_lossy().to_string());
            } else if matches!(size, ThumbnailSize::S1024) {
                // Generate on-demand for 1024px
                let _ = std::fs::create_dir_all(&thumb_dir);
                if crate::thumbnail::generate_thumbnail(
                    std::path::Path::new(&item.file_path),
                    &thumb_dir,
                    &item_id,
                    size.pixel_size(),
                ).is_ok() {
                    result.insert(item_id, thumb_path.to_string_lossy().to_string());
                }
            }
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn search_items_cmd(
    library_id: String,
    query: String,
    limit: i32,
    state: State<'_, DbState>,
) -> Result<Vec<SearchResult>, AppError> {
    let library_conn = state.library.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = library_conn.as_ref().ok_or(AppError::NoActiveLibrary)?;
    search::search_items(conn, &query, limit)
}

#[tauri::command]
pub fn get_folders(
    library_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<Folder>, AppError> {
    let library_conn = state.library.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = library_conn.as_ref().ok_or(AppError::NoActiveLibrary)?;
    db::get_folders(conn)
}
```

---

### Step 2: Verify commands compile

```bash
cd /Users/carpon/web/shark/src-tauri && cargo check
```

Expected: Compiles with no errors.

---

### Step 3: Commit

```bash
cd /Users/carpon/web/shark
git add src-tauri/src/commands.rs
git commit -m "feat: add all Phase 1 Tauri IPC command handlers"
```

---

## Task 8: Main Assembly (main.rs)

**Files:**
- Modify: `src-tauri/src/main.rs` (replace scaffold from Task 1)
- Modify: `src-tauri/tauri.conf.json` (add asset protocol scope)

**Depends on:** Task 7 (commands.rs)

---

### Step 1: Update `src-tauri/src/main.rs`

Replace the scaffold `main.rs` with:

```rust
mod commands;
mod db;
mod error;
mod indexer;
mod models;
mod search;
mod thumbnail;

use db::DbState;
use std::sync::Mutex;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 1. Resolve app data dir (~/.shark/)
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");
            std::fs::create_dir_all(&app_dir).expect("Failed to create app data directory");

            // 2. Open global registry DB
            let registry_path = app_dir.join("registry.db");
            let registry_conn =
                db::init_registry_db(&registry_path).expect("Failed to open registry DB");

            // 3. Create DbState and manage as Tauri state
            let db_state = DbState {
                registry: Mutex::new(registry_conn),
                library: Mutex::new(None),
            };
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
        ])
        .run(tauri::generate_context!())
        .expect("error running Shark");
}
```

---

### Step 2: Add `init_library_db` alias for use by commands.rs

`init_library_db` already exists in db.rs from Task 3. The `open_library` command in commands.rs calls `db::init_library_db(&lib_db_path)` which is the same function. No additional changes needed.

---

### Step 3: Verify `tauri.conf.json` asset protocol

The `tauri.conf.json` was already configured with correct CSP and asset protocol in Task 1. Verify the security section looks correct:

```json
"security": {
    "csp": "default-src 'self'; img-src 'self' asset: https://asset.localhost",
    "assetProtocol": {
        "enable": true,
        "scope": {
            "allow": ["**"],
            "deny": []
        }
    }
}
```

No changes needed — this step is a verification check only.

---

### Step 4: Build and verify

```bash
cd /Users/carpon/web/shark && pnpm tauri build --debug
```

Expected: Builds successfully. Binary created at `target/debug/bundle/`.

**Quick smoke test:**

```bash
cd /Users/carpon/web/shark && pnpm tauri dev
```

Expected: Window launches titled "Shark" at 1200x800. No panics in console.

---

### Step 5: Commit

```bash
cd /Users/carpon/web/shark
git add src-tauri/src/main.rs src-tauri/src/db.rs src-tauri/tauri.conf.json
git commit -m "feat: wire up Tauri main with DbState, registry DB, and all IPC handlers"
```


## Task 9: Frontend Foundation (types + hooks + stores)

### Files:
- Create: `src/lib/types.ts`
- Create: `src/hooks/useInvoke.ts`
- Create: `src/stores/libraryStore.ts`
- Create: `src/stores/itemStore.ts`
- Create: `src/stores/filterStore.ts`
- Create: `src/stores/viewStore.ts`
- Create: `src/stores/uiStore.ts`

---

#### Step 1: Write `src/lib/types.ts` with all TypeScript interfaces

Write complete types mirroring every Rust model.

**Command:**
```bash
mkdir -p src/lib src/hooks src/stores src/components/Grid src/components/Sidebar src/components/Viewer src/components/Toolbar src/components/Import
```

**File: `src/lib/types.ts`**
```typescript
/** Mirrors Rust models from src-tauri/src/models.rs */

export interface Library {
  id: string;
  name: string;
  path: string;
  created_at: string;
}

export interface Item {
  id: string;
  file_path: string;
  file_name: string;
  file_size: number;
  file_type: string;
  width: number | null;
  height: number | null;
  color: string | null;
  tags: string;
  rating: number;
  notes: string;
  sha256: string;
  status: string;
  created_at: string;
  modified_at: string;
}

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
}

export interface ItemFilter {
  folder_id?: string | null;
  file_types?: string[] | null;
  tags?: string[] | null;
  rating_min?: number | null;
  search_query?: string | null;
}

export interface SortSpec {
  field: string;
  direction: 'asc' | 'desc';
}

export interface Pagination {
  offset: number;
  limit: number;
}

export interface ItemPage {
  items: Item[];
  total: number;
  offset: number;
  limit: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
}

export enum ThumbnailSize {
  S256 = 'S256',
  S1024 = 'S1024',
}

export interface SearchResult {
  item: Item;
  rank: number;
}

export interface LibraryStats {
  total_items: number;
  total_size: number;
  by_type: Record<string, number>;
}

export interface TagCount {
  tag: string;
  count: number;
}
```

**Verify:**
```bash
npx tsc --noEmit src/lib/types.ts
```

Expected: no errors.

**Commit:**
```bash
git add src/lib/types.ts
git commit -m "Add TypeScript type definitions mirroring Rust models"
```

---

#### Step 2: Write `src/hooks/useInvoke.ts` generic IPC hook

**File: `src/hooks/useInvoke.ts`**
```typescript
import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface UseInvokeState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Generic hook for invoking Tauri IPC commands with loading/error state.
 *
 * @param command - The Tauri command name (e.g. 'list_libraries')
 * @param args - Arguments to pass to the command. Omit if no args.
 *               If null/undefined, the command will not auto-invoke on mount.
 * @param options.skip - If true, skip auto-invocation on mount and dependency change.
 */
export function useInvoke<T>(
  command: string,
  args?: Record<string, unknown> | null,
  options?: { skip?: boolean },
): UseInvokeState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!options?.skip);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<T>(command, args ?? {});
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [command, JSON.stringify(args)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (options?.skip) return;
    refetch();
  }, [refetch, options?.skip]);

  return { data, loading, error, refetch };
}

/**
 * One-shot invoke without hook state management.
 * Use for fire-and-forget commands like import_files, delete_items.
 */
export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, args ?? {});
}
```

**Verify:**
```bash
npx tsc --noEmit src/hooks/useInvoke.ts
```

Expected: no errors.

**Commit:**
```bash
git add src/hooks/useInvoke.ts
git commit -m "Add useInvoke generic IPC hook with loading/error state"
```

---

#### Step 3: Write `src/stores/libraryStore.ts` with persist

**File: `src/stores/libraryStore.ts`**
```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import type { Library } from '../lib/types';

interface LibraryState {
  libraries: Library[];
  activeLibraryId: string | null;

  // Actions
  loadLibraries: () => Promise<void>;
  createLibrary: (name: string, path: string) => Promise<Library>;
  openLibrary: (path: string) => Promise<Library>;
  setActiveLibraryId: (id: string) => void;
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      libraries: [],
      activeLibraryId: null,

      loadLibraries: async () => {
        const libs = await invoke<Library[]>('list_libraries');
        set({ libraries: libs });
      },

      createLibrary: async (name: string, path: string) => {
        const lib = await invoke<Library>('create_library', { name, path });
        set((state) => ({
          libraries: [...state.libraries, lib],
          activeLibraryId: lib.id,
        }));
        return lib;
      },

      openLibrary: async (path: string) => {
        const lib = await invoke<Library>('open_library', { path });
        set((state) => {
          const exists = state.libraries.some((l) => l.id === lib.id);
          return {
            libraries: exists ? state.libraries : [...state.libraries, lib],
            activeLibraryId: lib.id,
          };
        });
        return lib;
      },

      setActiveLibraryId: (id: string) => {
        set({ activeLibraryId: id });
      },
    }),
    {
      name: 'shark-library',
      partialize: (state) => ({
        activeLibraryId: state.activeLibraryId,
      }),
    },
  ),
);
```

**Verify:**
```bash
npx tsc --noEmit src/stores/libraryStore.ts
```

**Commit:**
```bash
git add src/stores/libraryStore.ts
git commit -m "Add libraryStore with persist for active library selection"
```

---

#### Step 4: Write `src/stores/itemStore.ts` (no persist)

**File: `src/stores/itemStore.ts`**
```typescript
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Item, ItemFilter, SortSpec, Pagination, ItemPage } from '../lib/types';

interface ItemState {
  items: Item[];
  total: number;
  selectedIds: Set<string>;
  loading: boolean;
  error: string | null;

  // Actions
  queryItems: (
    libraryId: string,
    filter: ItemFilter,
    sort: SortSpec,
    page: Pagination,
  ) => Promise<void>;
  clearItems: () => void;
  selectItem: (id: string, multi?: boolean) => void;
  selectRange: (fromId: string, toId: string) => void;
  clearSelection: () => void;
  deleteSelected: (libraryId: string, permanent: boolean) => Promise<void>;
}

export const useItemStore = create<ItemState>()((set, get) => ({
  items: [],
  total: 0,
  selectedIds: new Set<string>(),
  loading: false,
  error: null,

  queryItems: async (libraryId, filter, sort, page) => {
    set({ loading: true, error: null });
    try {
      const result = await invoke<ItemPage>('query_items', {
        libraryId,
        filter,
        sort,
        page,
      });
      set({ items: result.items, total: result.total, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, loading: false });
    }
  },

  clearItems: () => {
    set({ items: [], total: 0, selectedIds: new Set<string>(), error: null });
  },

  selectItem: (id: string, multi = false) => {
    set((state) => {
      const next = new Set(multi ? state.selectedIds : []);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedIds: next };
    });
  },

  selectRange: (fromId: string, toId: string) => {
    const { items } = get();
    const fromIdx = items.findIndex((i) => i.id === fromId);
    const toIdx = items.findIndex((i) => i.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;

    const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
    const rangeIds = items.slice(start, end + 1).map((i) => i.id);
    set({ selectedIds: new Set(rangeIds) });
  },

  clearSelection: () => {
    set({ selectedIds: new Set<string>() });
  },

  deleteSelected: async (libraryId: string, permanent: boolean) => {
    const { selectedIds, queryItems } = get();
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    await invoke('delete_items', { itemIds: ids, permanent });
    set({ selectedIds: new Set<string>() });
    // Caller should trigger re-query after deletion
  },
}));
```

**Verify:**
```bash
npx tsc --noEmit src/stores/itemStore.ts
```

**Commit:**
```bash
git add src/stores/itemStore.ts
git commit -m "Add itemStore with query, selection, and delete actions"
```

---

#### Step 5: Write `src/stores/filterStore.ts` with persist

**File: `src/stores/filterStore.ts`**
```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ItemFilter } from '../lib/types';

interface FilterState {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  searchQuery: string;
  fileTypes: string[];
  ratingMin: number;
  folderId: string | null;
  offset: number;
  limit: number;

  // Actions
  setSortBy: (field: string) => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  setSearchQuery: (query: string) => void;
  setFileTypes: (types: string[]) => void;
  setRatingMin: (rating: number) => void;
  setFolderId: (id: string | null) => void;
  setOffset: (offset: number) => void;
  resetFilters: () => void;

  // Derived helper
  toItemFilter: () => ItemFilter;
  toSortSpec: () => { field: string; direction: 'asc' | 'desc' };
  toPagination: () => { offset: number; limit: number };
}

const defaults = {
  sortBy: 'created_at',
  sortOrder: 'desc' as const,
  searchQuery: '',
  fileTypes: [] as string[],
  ratingMin: 0,
  folderId: null as string | null,
  offset: 0,
  limit: 200,
};

export const useFilterStore = create<FilterState>()(
  persist(
    (set, get) => ({
      ...defaults,

      setSortBy: (field: string) => set({ sortBy: field, offset: 0 }),
      setSortOrder: (order: 'asc' | 'desc') => set({ sortOrder: order, offset: 0 }),
      setSearchQuery: (query: string) => set({ searchQuery: query, offset: 0 }),
      setFileTypes: (types: string[]) => set({ fileTypes: types, offset: 0 }),
      setRatingMin: (rating: number) => set({ ratingMin: rating, offset: 0 }),
      setFolderId: (id: string | null) => set({ folderId: id, offset: 0 }),
      setOffset: (offset: number) => set({ offset }),
      resetFilters: () => set({ ...defaults }),

      toItemFilter: () => {
        const state = get();
        return {
          folder_id: state.folderId,
          file_types: state.fileTypes.length > 0 ? state.fileTypes : null,
          rating_min: state.ratingMin > 0 ? state.ratingMin : null,
          search_query: state.searchQuery || null,
        };
      },

      toSortSpec: () => ({
        field: get().sortBy,
        direction: get().sortOrder,
      }),

      toPagination: () => ({
        offset: get().offset,
        limit: get().limit,
      }),
    }),
    {
      name: 'shark-filter',
      partialize: (state) => ({
        sortBy: state.sortBy,
        sortOrder: state.sortOrder,
        limit: state.limit,
      }),
    },
  ),
);
```

**Verify:**
```bash
npx tsc --noEmit src/stores/filterStore.ts
```

**Commit:**
```bash
git add src/stores/filterStore.ts
git commit -m "Add filterStore with persist for sort/filter preferences"
```

---

#### Step 6: Write `src/stores/viewStore.ts` with persist

**File: `src/stores/viewStore.ts`**
```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ViewState {
  gridSize: 'small' | 'medium' | 'large';
  sidebarOpen: boolean;

  // Actions
  setGridSize: (size: 'small' | 'medium' | 'large') => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useViewStore = create<ViewState>()(
  persist(
    (set) => ({
      gridSize: 'medium',
      sidebarOpen: true,

      setGridSize: (size) => set({ gridSize: size }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name: 'shark-view',
    },
  ),
);
```

**Verify:**
```bash
npx tsc --noEmit src/stores/viewStore.ts
```

**Commit:**
```bash
git add src/stores/viewStore.ts
git commit -m "Add viewStore with persist for grid size and sidebar state"
```

---

#### Step 7: Write `src/stores/uiStore.ts` (no persist)

**File: `src/stores/uiStore.ts`**
```typescript
import { create } from 'zustand';

interface ContextMenuState {
  x: number;
  y: number;
  itemId: string | null;
}

interface UIState {
  viewerOpen: boolean;
  viewerItemId: string | null;
  contextMenu: ContextMenuState | null;
  importing: boolean;

  // Actions
  openViewer: (itemId: string) => void;
  closeViewer: () => void;
  showContextMenu: (x: number, y: number, itemId: string | null) => void;
  hideContextMenu: () => void;
  setImporting: (importing: boolean) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  viewerOpen: false,
  viewerItemId: null,
  contextMenu: null,
  importing: false,

  openViewer: (itemId: string) => {
    set({ viewerOpen: true, viewerItemId: itemId });
  },

  closeViewer: () => {
    set({ viewerOpen: false, viewerItemId: null });
  },

  showContextMenu: (x: number, y: number, itemId: string | null) => {
    set({ contextMenu: { x, y, itemId } });
  },

  hideContextMenu: () => {
    set({ contextMenu: null });
  },

  setImporting: (importing: boolean) => {
    set({ importing });
  },
}));
```

**Verify:**
```bash
npx tsc --noEmit src/stores/uiStore.ts
```

**Commit:**
```bash
git add src/stores/uiStore.ts
git commit -m "Add uiStore for transient viewer, context menu, and import state"
```

---

#### Step 8: Verify full app compiles

**Command:**
```bash
npx tsc --noEmit
```

Expected output:
```
# No errors — clean compilation
```

If there are import path errors, verify `tsconfig.json` has the path alias:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

**Command:**
```bash
pnpm tauri dev
```

Expected: Window launches with the React app rendering (components may be missing, but no TypeScript/runtime errors from store initialization).

---

## Task 10: App Layout + Toolbar

### Files:
- Create: `src/App.tsx` (rewrite)
- Create: `src/components/Toolbar/Toolbar.tsx`
- Create: `src/components/Import/ImportButton.tsx`

---

#### Step 1: Write `src/App.tsx` with layout structure

**File: `src/App.tsx`**
```tsx
import { useEffect } from 'react';
import { useLibraryStore } from './stores/libraryStore';
import { useViewStore } from './stores/viewStore';
import { useUIStore } from './stores/uiStore';
import { Toolbar } from './components/Toolbar/Toolbar';
import { Sidebar } from './components/Sidebar/Sidebar';
import { VirtualGrid } from './components/Grid/VirtualGrid';
import { ImageViewer } from './components/Viewer/ImageViewer';

export default function App() {
  const sidebarOpen = useViewStore((s) => s.sidebarOpen);
  const viewerOpen = useUIStore((s) => s.viewerOpen);

  return (
    <div className="h-screen w-screen flex flex-col bg-neutral-900 text-neutral-100 overflow-hidden">
      {/* Toolbar */}
      <Toolbar />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="w-56 flex-shrink-0 border-r border-neutral-700 bg-neutral-800/50 overflow-y-auto">
            <Sidebar />
          </aside>
        )}

        {/* Grid area */}
        <main className="flex-1 overflow-hidden relative">
          <VirtualGrid />
        </main>
      </div>

      {/* Viewer overlay */}
      {viewerOpen && <ImageViewer />}
    </div>
  );
}
```

**Commit:**
```bash
git add src/App.tsx
git commit -m "Add App layout with toolbar, sidebar, grid, and viewer overlay"
```

---

#### Step 2: Write `src/components/Toolbar/Toolbar.tsx`

**File: `src/components/Toolbar/Toolbar.tsx`**
```tsx
import { useLibraryStore } from '../../stores/libraryStore';
import { useViewStore } from '../../stores/viewStore';
import { useFilterStore } from '../../stores/filterStore';
import { ImportButton } from '../Import/ImportButton';

export function Toolbar() {
  const libraries = useLibraryStore((s) => s.libraries);
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const toggleSidebar = useViewStore((s) => s.toggleSidebar);
  const gridSize = useViewStore((s) => s.gridSize);
  const setGridSize = useViewStore((s) => s.setGridSize);
  const searchQuery = useFilterStore((s) => s.searchQuery);
  const setSearchQuery = useFilterStore((s) => s.setSearchQuery);

  const activeLibrary = libraries.find((l) => l.id === activeLibraryId);

  return (
    <header className="h-12 flex items-center gap-3 px-3 border-b border-neutral-700 bg-neutral-800 flex-shrink-0">
      {/* Sidebar toggle */}
      <button
        onClick={toggleSidebar}
        className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200"
        title="Toggle sidebar"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Library name */}
      <span className="text-sm font-semibold text-neutral-300 truncate max-w-48">
        {activeLibrary?.name ?? 'Shark'}
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search..."
          className="w-48 h-7 pl-7 pr-2 rounded bg-neutral-700 border border-neutral-600 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
        />
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Grid size toggle */}
      <div className="flex gap-0.5">
        {(['small', 'medium', 'large'] as const).map((size) => (
          <button
            key={size}
            onClick={() => setGridSize(size)}
            className={`px-2 py-1 rounded text-xs ${
              gridSize === size
                ? 'bg-blue-600 text-white'
                : 'text-neutral-400 hover:bg-neutral-700'
            }`}
          >
            {size.charAt(0).toUpperCase() + size.slice(1)}
          </button>
        ))}
      </div>

      {/* Import button */}
      <ImportButton />
    </header>
  );
}
```

**Commit:**
```bash
git add src/components/Toolbar/Toolbar.tsx
git commit -m "Add Toolbar with sidebar toggle, search, grid size, and import button"
```

---

#### Step 3: Write `src/components/Import/ImportButton.tsx`

**File: `src/components/Import/ImportButton.tsx`**
```tsx
import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUIStore } from '../../stores/uiStore';
import { useItemStore } from '../../stores/itemStore';
import { useFilterStore } from '../../stores/filterStore';
import type { ImportResult } from '../../lib/types';

export function ImportButton() {
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const setImporting = useUIStore((s) => s.setImporting);
  const queryItems = useItemStore((s) => s.queryItems);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    if (!activeLibraryId) {
      setError('No library selected');
      return;
    }

    const selected = await open({ directory: true, multiple: false });
    if (!selected) return; // user cancelled

    const sourcePath = selected as string;

    setImporting(true);
    setError(null);

    try {
      const result = await invoke<ImportResult>('import_files', {
        libraryId: activeLibraryId,
        sourcePath,
      });

      // Refresh grid with current filters
      const filter = useFilterStore.getState();
      await queryItems(
        activeLibraryId,
        filter.toItemFilter(),
        filter.toSortSpec(),
        filter.toPagination(),
      );

      console.log(
        `Import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.duplicates} duplicates`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleImport}
        className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
      >
        Import
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
```

**Commit:**
```bash
git add src/components/Import/ImportButton.tsx
git commit -m "Add ImportButton with folder dialog and import invocation"
```

---

#### Step 4: Verify app renders with toolbar

**Command:**
```bash
pnpm tauri dev
```

Expected: Window renders with toolbar showing "Shark" title, sidebar toggle button, search input, grid size buttons, and "Import" button. No runtime errors in console. The sidebar and grid areas will be empty (components created in next tasks).

**Note:** The `Sidebar` and `VirtualGrid` imports in App.tsx reference components not yet created. Create temporary placeholder files to allow compilation:

**File: `src/components/Sidebar/Sidebar.tsx`**
```tsx
export function Sidebar() {
  return <div className="p-3 text-sm text-neutral-400">Sidebar placeholder</div>;
}
```

**File: `src/components/Grid/VirtualGrid.tsx`**
```tsx
export function VirtualGrid() {
  return (
    <div className="flex items-center justify-center h-full text-neutral-500">
      No items — import a folder to get started
    </div>
  );
}
```

**File: `src/components/Viewer/ImageViewer.tsx`**
```tsx
export function ImageViewer() {
  return null;
}
```

```bash
mkdir -p src/components/Sidebar src/components/Grid src/components/Viewer
git add src/components/Sidebar/Sidebar.tsx src/components/Grid/VirtualGrid.tsx src/components/Viewer/ImageViewer.tsx
git commit -m "Add placeholder components for sidebar, grid, and viewer"
```

After placeholders compile and render, proceed to Task 11.

---

## Task 11: Sidebar

### Files:
- Create: `src/components/Sidebar/Sidebar.tsx` (replace placeholder)
- Create: `src/components/Sidebar/LibrarySelector.tsx`
- Create: `src/components/Sidebar/FolderList.tsx`

---

#### Step 1: Write `src/components/Sidebar/Sidebar.tsx` container

**File: `src/components/Sidebar/Sidebar.tsx`**
```tsx
import { LibrarySelector } from './LibrarySelector';
import { FolderList } from './FolderList';

export function Sidebar() {
  return (
    <div className="flex flex-col h-full">
      {/* Library selector */}
      <div className="p-3 border-b border-neutral-700">
        <LibrarySelector />
      </div>

      {/* Folder list */}
      <div className="flex-1 overflow-y-auto p-2">
        <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2 px-1">
          Folders
        </h3>
        <FolderList />
      </div>
    </div>
  );
}
```

**Commit:**
```bash
git add src/components/Sidebar/Sidebar.tsx
git commit -m "Rewrite Sidebar with library selector and folder list containers"
```

---

#### Step 2: Write `src/components/Sidebar/LibrarySelector.tsx`

**File: `src/components/Sidebar/LibrarySelector.tsx`**
```tsx
import { useEffect } from 'react';
import { useLibraryStore } from '../../stores/libraryStore';
import { useItemStore } from '../../stores/itemStore';
import { useFilterStore } from '../../stores/filterStore';

export function LibrarySelector() {
  const libraries = useLibraryStore((s) => s.libraries);
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const setActiveLibraryId = useLibraryStore((s) => s.setActiveLibraryId);
  const loadLibraries = useLibraryStore((s) => s.loadLibraries);
  const queryItems = useItemStore((s) => s.queryItems);
  const clearItems = useItemStore((s) => s.clearItems);

  useEffect(() => {
    loadLibraries();
  }, [loadLibraries]);

  const handleChange = async (libraryId: string) => {
    setActiveLibraryId(libraryId);

    if (libraryId) {
      const filter = useFilterStore.getState();
      await queryItems(
        libraryId,
        filter.toItemFilter(),
        filter.toSortSpec(),
        filter.toPagination(),
      );
    } else {
      clearItems();
    }
  };

  if (libraries.length === 0) {
    return (
      <div className="text-xs text-neutral-500">
        No libraries yet. Create one to get started.
      </div>
    );
  }

  return (
    <select
      value={activeLibraryId ?? ''}
      onChange={(e) => handleChange(e.target.value)}
      className="w-full h-8 rounded bg-neutral-700 border border-neutral-600 text-sm text-neutral-200 px-2 focus:outline-none focus:border-blue-500"
    >
      <option value="" disabled>
        Select library...
      </option>
      {libraries.map((lib) => (
        <option key={lib.id} value={lib.id}>
          {lib.name}
        </option>
      ))}
    </select>
  );
}
```

**Commit:**
```bash
git add src/components/Sidebar/LibrarySelector.tsx
git commit -m "Add LibrarySelector dropdown with library switching"
```

---

#### Step 3: Write `src/components/Sidebar/FolderList.tsx`

**File: `src/components/Sidebar/FolderList.tsx`**
```tsx
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '../../stores/libraryStore';
import { useFilterStore } from '../../stores/filterStore';
import { useItemStore } from '../../stores/itemStore';
import type { Folder } from '../../lib/types';
import { useState } from 'react';

export function FolderList() {
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const setFolderId = useFilterStore((s) => s.setFolderId);
  const folderId = useFilterStore((s) => s.folderId);
  const queryItems = useItemStore((s) => s.queryItems);
  const [folders, setFolders] = useState<Folder[]>([]);

  useEffect(() => {
    if (!activeLibraryId) {
      setFolders([]);
      return;
    }

    invoke<Folder[]>('get_folders', { libraryId: activeLibraryId })
      .then(setFolders)
      .catch(console.error);
  }, [activeLibraryId]);

  const handleFolderClick = async (id: string | null) => {
    setFolderId(id);

    if (activeLibraryId) {
      const filter = useFilterStore.getState();
      await queryItems(
        activeLibraryId,
        filter.toItemFilter(),
        filter.toSortSpec(),
        filter.toPagination(),
      );
    }
  };

  return (
    <div className="space-y-0.5">
      {/* "All items" option */}
      <button
        onClick={() => handleFolderClick(null)}
        className={`w-full text-left px-2 py-1.5 rounded text-sm ${
          folderId === null
            ? 'bg-blue-600/20 text-blue-400'
            : 'text-neutral-400 hover:bg-neutral-700/50'
        }`}
      >
        All Items
      </button>

      {folders.map((folder) => (
        <button
          key={folder.id}
          onClick={() => handleFolderClick(folder.id)}
          className={`w-full text-left px-2 py-1.5 rounded text-sm ${
            folderId === folder.id
              ? 'bg-blue-600/20 text-blue-400'
              : 'text-neutral-400 hover:bg-neutral-700/50'
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 inline mr-1.5 -mt-0.5 text-neutral-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
          {folder.name}
        </button>
      ))}

      {folders.length === 0 && (
        <p className="text-xs text-neutral-600 px-2">No folders</p>
      )}
    </div>
  );
}
```

**Commit:**
```bash
git add src/components/Sidebar/FolderList.tsx
git commit -m "Add FolderList with folder filtering via filterStore"
```

---

#### Step 4: Verify sidebar shows library list

**Command:**
```bash
pnpm tauri dev
```

Test in browser console to verify IPC works:
```javascript
await window.__TAURI__.invoke('list_libraries')
// Expected: [] (empty array, no libraries yet)

await window.__TAURI__.invoke('create_library', { name: 'Test Library', path: '/tmp/test-library' })
// Expected: { id: "...", name: "Test Library", path: "/tmp/test-library", created_at: "..." }
```

After creating a library, the sidebar dropdown should show "Test Library". Clicking it sets it as active.

**Commit:**
```bash
git add -A
git commit -m "Complete sidebar with library selector and folder list"
```

---

## Task 12: Virtual Grid (Core UI)

### Files:
- Create: `src/components/Grid/VirtualGrid.tsx` (replace placeholder)
- Create: `src/components/Grid/AssetCard.tsx`

---

#### Step 1: Write `src/components/Grid/AssetCard.tsx` with thumbnail display

**File: `src/components/Grid/AssetCard.tsx`**
```tsx
import React, { memo, useState, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Item } from '../../lib/types';

interface AssetCardProps {
  item: Item;
  selected: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onDoubleClick: (id: string) => void;
  thumbPath: string | null;
}

// Performance note: React.memo's shallow comparison ensures only cards whose
// props actually changed re-render. When setThumbMap creates a new Map, only
// the card whose thumbPath changed from null→path will re-render — others skip.
// This is critical for grid performance with 1000+ items.
export const AssetCard = memo(function AssetCard({
  item,
  selected,
  onSelect,
  onDoubleClick,
  thumbPath,
}: AssetCardProps) {
  const [imgError, setImgError] = useState(false);
  const thumbnailUrl = thumbPath && !imgError ? convertFileSrc(thumbPath) : null;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(item.id, e);
    },
    [item.id, onSelect],
  );

  const handleDoubleClick = useCallback(() => {
    onDoubleClick(item.id);
  }, [item.id, onDoubleClick]);

  return (
    <div
      className={`flex flex-col items-center p-1 rounded cursor-pointer select-none transition-colors ${
        selected
          ? 'ring-2 ring-blue-500 bg-blue-500/10'
          : 'hover:bg-neutral-700/50'
      }`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {/* Thumbnail area */}
      <div className="w-full aspect-square bg-neutral-800 rounded overflow-hidden flex items-center justify-center">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={item.file_name}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="text-neutral-600 text-xs">No thumb</div>
        )}
      </div>

      {/* File name */}
      <p className="mt-1 text-xs text-neutral-400 truncate w-full text-center px-0.5">
        {item.file_name}
      </p>
    </div>
  );
});
```

**Commit:**
```bash
git add src/components/Grid/AssetCard.tsx
git commit -m "Add AssetCard with thumbnail display, selection, and double-click"
```

---

#### Step 2: Write `src/components/Grid/VirtualGrid.tsx` with useVirtualizer

**File: `src/components/Grid/VirtualGrid.tsx`**
```tsx
import { useRef, useEffect, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useItemStore } from '../../stores/itemStore';
import { useFilterStore } from '../../stores/filterStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useViewStore } from '../../stores/viewStore';
import { useUIStore } from '../../stores/uiStore';
import { AssetCard } from './AssetCard';

/** Map gridSize setting to approximate card width in pixels */
const GRID_SIZE_MAP = {
  small: 140,
  medium: 200,
  large: 280,
} as const;

export function VirtualGrid() {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(4);

  const items = useItemStore((s) => s.items);
  const total = useItemStore((s) => s.total);
  const loading = useItemStore((s) => s.loading);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const selectItem = useItemStore((s) => s.selectItem);
  const selectRange = useItemStore((s) => s.selectRange);
  const queryItems = useItemStore((s) => s.queryItems);
  const gridSize = useViewStore((s) => s.gridSize);
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const openViewer = useUIStore((s) => s.openViewer);
  const searchQuery = useFilterStore((s) => s.searchQuery);
  const sortBy = useFilterStore((s) => s.sortBy);
  const sortOrder = useFilterStore((s) => s.sortOrder);
  const folderId = useFilterStore((s) => s.folderId);

  const cardWidth = GRID_SIZE_MAP[gridSize];
  const gap = 8;

  // Dynamic column count based on container width
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const cols = Math.max(1, Math.floor((width + gap) / (cardWidth + gap)));
        setColumnCount(cols);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [cardWidth]);

  // Query items when library or filter changes
  useEffect(() => {
    if (!activeLibraryId) return;
    const filter = useFilterStore.getState();
    queryItems(
      activeLibraryId,
      filter.toItemFilter(),
      filter.toSortSpec(),
      filter.toPagination(),
    );
  }, [activeLibraryId, searchQuery, sortBy, sortOrder, folderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Virtual scrolling
  const rowCount = Math.ceil(items.length / columnCount);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => cardWidth + 32, // card height + name + padding
    overscan: 5,
  });

  // Selection handler
  const lastSelectedIdRef = useRef<string | null>(null);

  const handleSelect = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.shiftKey && lastSelectedIdRef.current) {
        selectRange(lastSelectedIdRef.current, id);
      } else {
        selectItem(id, e.ctrlKey || e.metaKey);
      }
      lastSelectedIdRef.current = id;
    },
    [selectItem, selectRange],
  );

  const handleDoubleClick = useCallback(
    (id: string) => {
      openViewer(id);
    },
    [openViewer],
  );

  // Clear selection on background click
  const handleBackgroundClick = useCallback(() => {
    useItemStore.getState().clearSelection();
  }, []);

  // No library selected
  if (!activeLibraryId) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500">
        Select or create a library to get started
      </div>
    );
  }

  // Loading state
  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500">
        Loading...
      </div>
    );
  }

  // Empty state
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500">
        No items — import a folder to get started
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="h-full overflow-y-auto overflow-x-hidden"
      onClick={handleBackgroundClick}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const startIdx = virtualRow.index * columnCount;
          const rowItems = items.slice(startIdx, startIdx + columnCount);

          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="flex justify-center gap-2 px-2"
            >
              {rowItems.map((item) => (
                <div
                  key={item.id}
                  style={{ width: `${cardWidth}px` }}
                  className="flex-shrink-0"
                >
                  <AssetCard
                    item={item}
                    selected={selectedIds.has(item.id)}
                    onSelect={handleSelect}
                    onDoubleClick={handleDoubleClick}
                    thumbPath={null} // Will be enhanced with thumbnail lookup
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**Commit:**
```bash
git add src/components/Grid/VirtualGrid.tsx
git commit -m "Add VirtualGrid with useVirtualizer, dynamic columns, and selection"
```

---

#### Step 3: Wire up thumbnail data flow from stores

Add a thumbnail cache hook that fetches thumbnail paths for visible items.

**File: `src/hooks/useThumbnails.ts`**
```typescript
import { invoke } from '@tauri-apps/api/core';
import { ThumbnailSize } from '../lib/types';

/**
 * Batch-fetch thumbnail paths for a list of item IDs.
 * Uses the batch RPC endpoint for efficiency — one IPC call instead of N.
 * Returns a Map of itemId -> thumbnail file path.
 */
export async function fetchThumbnailPaths(
  itemIds: string[],
  size: ThumbnailSize = ThumbnailSize.S256,
): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map();

  const result = await invoke<Record<string, string>>('get_thumbnails_batch', {
    itemIds,
    size,
  });

  return new Map(Object.entries(result));
}
```

Update `VirtualGrid.tsx` to use thumbnail paths. Add the thumbnail state and fetch logic inside the VirtualGrid component:

**Edit `src/components/Grid/VirtualGrid.tsx`** — add import:
```typescript
import { fetchThumbnailPaths } from '../../hooks/useThumbnails';
import { ThumbnailSize } from '../../lib/types';
```

**Edit `src/components/Grid/VirtualGrid.tsx`** — add thumbnail state inside the component, before the virtualizer setup:
```typescript
  // Thumbnail cache
  const [thumbMap, setThumbMap] = useState<Map<string, string>>(new Map());

  // Fetch thumbnails for visible items
  useEffect(() => {
    const visibleIds = rowVirtualizer.getVirtualItems().flatMap((vr) => {
      const startIdx = vr.index * columnCount;
      return items
        .slice(startIdx, startIdx + columnCount)
        .map((i) => i.id);
    });

    if (visibleIds.length === 0) return;

    // Only fetch for items not already in cache
    const missing = visibleIds.filter((id) => !thumbMap.has(id));
    if (missing.length === 0) return;

    fetchThumbnailPaths(missing, ThumbnailSize.S256).then((paths) => {
      setThumbMap((prev) => {
        const next = new Map(prev);
        for (const [id, path] of paths) {
          next.set(id, path);
        }
        return next;
      });
    });
  }, [items, rowVirtualizer.getVirtualItems(), columnCount]); // eslint-disable-line react-hooks/exhaustive-deps
```

**Edit `src/components/Grid/VirtualGrid.tsx`** — update AssetCard thumbPath prop from `null` to lookup:
```tsx
                  <AssetCard
                    item={item}
                    selected={selectedIds.has(item.id)}
                    onSelect={handleSelect}
                    onDoubleClick={handleDoubleClick}
                    thumbPath={thumbMap.get(item.id) ?? null}
                  />
```

**Commit:**
```bash
git add src/hooks/useThumbnails.ts src/components/Grid/VirtualGrid.tsx
git commit -m "Wire up thumbnail fetching for visible grid items"
```

---

#### Step 4: Test with manual invoke to create library + import

**Command:**
```bash
pnpm tauri dev
```

In browser console:
```javascript
// Create library
const lib = await window.__TAURI__.invoke('create_library', { name: 'Photos', path: '/tmp/shark-test' });

// Import a folder (point to a folder with images)
await window.__TAURI__.invoke('import_files', { libraryId: lib.id, sourcePath: '/path/to/test/images' });
```

Then click the library in the sidebar dropdown, verify grid renders with thumbnails.

**Expected:**
- Grid shows imported items as cards
- Thumbnails load progressively
- Click selects, double-click opens viewer (empty for now)
- Scroll is smooth

**Commit:**
```bash
git add -A
git commit -m "Complete virtual grid with thumbnail display and selection"
```

---

## Task 13: Image Viewer

### Files:
- Create: `src/components/Viewer/ImageViewer.tsx` (replace placeholder)

---

#### Step 1: Write `ImageViewer.tsx` modal component

**File: `src/components/Viewer/ImageViewer.tsx`**
```tsx
import { useEffect, useState, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useUIStore } from '../../stores/uiStore';
import { useItemStore } from '../../stores/itemStore';

export function ImageViewer() {
  const viewerItemId = useUIStore((s) => s.viewerItemId);
  const closeViewer = useUIStore((s) => s.closeViewer);
  const openViewer = useUIStore((s) => s.openViewer);
  const items = useItemStore((s) => s.items);
  const [imgError, setImgError] = useState(false);

  const currentIndex = items.findIndex((i) => i.id === viewerItemId);
  const item = items[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;

  const imageUrl = item ? convertFileSrc(item.file_path) : null;

  // Reset error state when item changes
  useEffect(() => {
    setImgError(false);
  }, [viewerItemId]);

  const navigatePrev = useCallback(() => {
    if (hasPrev) {
      openViewer(items[currentIndex - 1].id);
    }
  }, [hasPrev, currentIndex, items, openViewer]);

  const navigateNext = useCallback(() => {
    if (hasNext) {
      openViewer(items[currentIndex + 1].id);
    }
  }, [hasNext, currentIndex, items, openViewer]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          closeViewer();
          break;
        case 'ArrowLeft':
          navigatePrev();
          break;
        case 'ArrowRight':
          navigateNext();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeViewer, navigatePrev, navigateNext]);

  if (!item || !imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      onClick={(e) => {
        // Close only when clicking the backdrop itself, not the image
        if (e.target === e.currentTarget) {
          closeViewer();
        }
      }}
    >
      {/* Top bar — close button */}
      <div className="flex items-center justify-between px-4 py-2 flex-shrink-0">
        <button
          onClick={closeViewer}
          className="p-2 rounded hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
          title="Close (Esc)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <span className="text-sm text-neutral-400">
          {currentIndex + 1} / {items.length}
        </span>

        <div className="w-10" /> {/* Spacer for alignment */}
      </div>

      {/* Image area */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {/* Prev arrow */}
        {hasPrev && (
          <button
            onClick={navigatePrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors z-10"
            title="Previous (Left)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-8 w-8"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Image */}
        {!imgError ? (
          <img
            src={imageUrl}
            alt={item.file_name}
            className="max-w-full max-h-full object-contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="text-neutral-500">Failed to load image</div>
        )}

        {/* Next arrow */}
        {hasNext && (
          <button
            onClick={navigateNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors z-10"
            title="Next (Right)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-8 w-8"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* Bottom bar — file info */}
      <div className="flex items-center justify-center gap-4 px-4 py-3 flex-shrink-0 text-sm text-neutral-400">
        <span className="truncate max-w-md">{item.file_name}</span>
        {item.width && item.height && (
          <>
            <span className="text-neutral-600">|</span>
            <span>
              {item.width} x {item.height}
            </span>
          </>
        )}
        {item.file_size > 0 && (
          <>
            <span className="text-neutral-600">|</span>
            <span>{(item.file_size / 1024 / 1024).toFixed(1)} MB</span>
          </>
        )}
      </div>
    </div>
  );
}
```

---

#### Step 2: Verify keyboard navigation

**Commit:**
```bash
git add src/components/Viewer/ImageViewer.tsx
git commit -m "Add ImageViewer with keyboard navigation and file info"
```

---

#### Step 3: Verify viewer opens and navigates

**Command:**
```bash
pnpm tauri dev
```

Test flow:
1. Create library and import images (via console if needed)
2. Items appear in grid
3. Double-click an item -> viewer opens with full-resolution image
4. Press Right arrow -> next image loads
5. Press Left arrow -> previous image loads
6. Press Escape -> viewer closes, grid is visible
7. Counter shows "3 / 50" (example) at top-right
8. File name, dimensions, and size shown at bottom

**Expected:** All navigation works smoothly. Image loads via `convertFileSrc`. No console errors.

**Commit:**
```bash
git add -A
git commit -m "Verify and finalize ImageViewer component"
```

---

## Task 14: Import Flow

### Files:
- Modify: `src/components/Import/ImportButton.tsx` (enhance with progress)
- Create: `src/components/Import/ImportProgress.tsx`

---

#### Step 1: Create `src/components/Import/ImportProgress.tsx`

**File: `src/components/Import/ImportProgress.tsx`**
```tsx
import { useUIStore } from '../../stores/uiStore';

export function ImportProgress() {
  const importing = useUIStore((s) => s.importing);

  if (!importing) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center pointer-events-none">
      <div className="bg-neutral-800 rounded-lg px-6 py-4 shadow-xl flex items-center gap-3 pointer-events-auto">
        {/* Spinner */}
        <svg
          className="animate-spin h-5 w-5 text-blue-500"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        <span className="text-sm text-neutral-200">Importing files...</span>
      </div>
    </div>
  );
}
```

**Commit:**
```bash
git add src/components/Import/ImportProgress.tsx
git commit -m "Add ImportProgress overlay spinner component"
```

---

#### Step 2: Enhance `ImportButton.tsx` with loading state and refresh

**File: `src/components/Import/ImportButton.tsx` (rewrite)**
```tsx
import { useState, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUIStore } from '../../stores/uiStore';
import { useItemStore } from '../../stores/itemStore';
import { useFilterStore } from '../../stores/filterStore';
import type { ImportResult } from '../../lib/types';

export function ImportButton() {
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const setImporting = useUIStore((s) => s.setImporting);
  const queryItems = useItemStore((s) => s.queryItems);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);

  const handleImport = useCallback(async () => {
    if (!activeLibraryId) {
      setError('No library selected');
      return;
    }

    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;

    const sourcePath = selected as string;

    setImporting(true);
    setError(null);
    setLastResult(null);

    try {
      const result = await invoke<ImportResult>('import_files', {
        libraryId: activeLibraryId,
        sourcePath,
      });

      setLastResult(result);

      // Refresh grid with current filters
      const filter = useFilterStore.getState();
      await queryItems(
        activeLibraryId,
        filter.toItemFilter(),
        filter.toSortSpec(),
        filter.toPagination(),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setImporting(false);
    }
  }, [activeLibraryId, setImporting, queryItems]);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleImport}
        className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
      >
        Import
      </button>

      {error && (
        <span className="text-xs text-red-400 max-w-48 truncate" title={error}>
          Import failed: {error}
        </span>
      )}

      {lastResult && (
        <span className="text-xs text-green-400">
          +{lastResult.imported} imported
          {lastResult.duplicates > 0 && `, ${lastResult.duplicates} duplicates`}
        </span>
      )}
    </div>
  );
}
```

Now add `ImportProgress` to the App layout. Update `src/App.tsx`:

**Edit `src/App.tsx`** — add import and render `ImportProgress`:
```tsx
import { ImportProgress } from './components/Import/ImportProgress';
```

Add inside the `<div className="h-screen...">`, after the `ImageViewer` conditional:
```tsx
      {/* Import progress overlay */}
      <ImportProgress />
```

**Commit:**
```bash
git add src/components/Import/ImportButton.tsx src/App.tsx
git commit -m "Enhance ImportButton with result display and ImportProgress overlay"
```

---

#### Step 3: Verify import -> grid updates flow

**Command:**
```bash
pnpm tauri dev
```

Test flow:
1. Select a library in the sidebar
2. Click "Import" button
3. Native folder dialog opens
4. Select a folder with images
5. "Importing files..." overlay appears with spinner
6. Import completes:
   - Overlay disappears
   - Green text shows "+5 imported" (example)
   - Grid refreshes and shows new items with thumbnails
7. Click "Import" again, select same folder
8. Result shows "+0 imported, 5 duplicates"

**Expected:** Full import-to-grid update cycle works. No stale data. Error shown if dialog fails or import errors.

**Commit:**
```bash
git add -A
git commit -m "Verify complete import-to-grid refresh flow"
```

---

## Task 15: End-to-End Verification

### No files -- manual checklist

This is a manual smoke test and performance baseline. All items must pass before Phase 1 is considered complete.

---

#### Step 1: Clean state launch

**Action:** Delete any existing test data:
```bash
rm -rf ~/.shark/registry.db
rm -rf /tmp/shark-test-library
```

**Command:**
```bash
pnpm tauri dev
```

**Verify:**
- [ ] Window opens at 1200x800
- [ ] Toolbar renders with "Shark" title, sidebar toggle, search, grid size buttons, Import button
- [ ] Sidebar shows "No libraries yet. Create one to get started."
- [ ] Grid area shows "Select or create a library to get started"
- [ ] No errors in browser console or Rust terminal

---

#### Step 2: Create a new library

**Action:** In browser console:
```javascript
const lib = await window.__TAURI__.invoke('create_library', { name: 'Photo Library', path: '/tmp/shark-test-library' });
console.log(lib);
```

**Verify:**
- [ ] `lib.id` is a valid UUID string
- [ ] `lib.name` is "Photo Library"
- [ ] `lib.path` is "/tmp/shark-test-library"
- [ ] `/tmp/shark-test-library/.shark/metadata.db` exists on disk (created by create_library, not just open_library)
- [ ] `/tmp/shark-test-library/images/` directory exists
- [ ] `/tmp/shark-test-library/.shark/thumbs/256/` directory exists
- [ ] Sidebar dropdown now shows "Photo Library"
- [ ] `~/.shark/registry.db` exists

---

#### Step 3: Import a folder with 100+ images

**Preparation:** Create a test folder with images. If you have a real photo folder, use it. Otherwise:
```bash
# Generate 120 test PNG images (requires ImageMagick)
mkdir -p /tmp/shark-test-images
for i in $(seq 1 120); do
  convert -size 800x600 xc:"rgb($((RANDOM%256)),$((RANDOM%256)),$((RANDOM%256)))" /tmp/shark-test-images/test_$i.png 2>/dev/null || \
  python3 -c "
from PIL import Image
import random
img = Image.new('RGB', (800, 600), (random.randint(0,255), random.randint(0,255), random.randint(0,255)))
img.save('/tmp/shark-test-images/test_$i.png')
"
done
```

**Action:** Click "Import" button in toolbar, select `/tmp/shark-test-images`.

**Verify:**
- [ ] Native folder dialog opens
- [ ] After selecting folder, "Importing files..." spinner appears
- [ ] Import completes (spinner disappears)
- [ ] Green text shows imported count (e.g., "+120 imported")
- [ ] Grid populates with 120 thumbnail cards
- [ ] Thumbnails render progressively

---

#### Step 4: Grid renders all thumbnails, scroll is smooth

**Verify:**
- [ ] All 120 items visible in grid (scroll to bottom)
- [ ] Thumbnails load without blank gaps (a few may briefly show "No thumb" then load)
- [ ] Grid size buttons (Small/Medium/Large) change card sizes correctly
- [ ] Resizing window adjusts column count dynamically
- [ ] No lag or stuttering during scroll

**Performance check (optional):**
Open DevTools -> Performance tab, record 5 seconds of scrolling.
- [ ] No frames > 16.67ms (target: 60fps)
- [ ] No memory leaks (heap stable, not growing continuously)

---

#### Step 5: Click -> selected, Double-click -> viewer

**Verify:**
- [ ] Click a card -> blue border highlight appears
- [ ] Click another card -> previous deselects, new one selects
- [ ] Ctrl+click (Cmd+click on Mac) -> both selected
- [ ] Shift+click -> range selection
- [ ] Click empty area -> all deselected
- [ ] Double-click a card -> viewer opens with full image
- [ ] Viewer shows large image centered on black background
- [ ] Counter shows "1 / 120" at top

---

#### Step 6: Viewer navigation

**Verify:**
- [ ] Right arrow key -> next image
- [ ] Left arrow key -> previous image
- [ ] Arrow buttons on screen work (left/right overlays)
- [ ] Counter updates (e.g., "2 / 120", "3 / 120")
- [ ] Escape key -> viewer closes
- [ ] Back to grid, selection maintained
- [ ] Double-click different item -> viewer opens at that item

---

#### Step 7: Close viewer -> grid, Import another -> updates

**Verify:**
- [ ] After closing viewer, grid scrolls to same position
- [ ] Click "Import" again, select another folder (or same folder)
- [ ] Import completes, grid refreshes with updated item count
- [ ] Duplicates are skipped (shown in result message)
- [ ] No duplicate items in grid

---

#### Step 8: Restart -> persists

**Action:** Close the app (Ctrl+C in terminal), then relaunch:
```bash
pnpm tauri dev
```

**Verify:**
- [ ] App launches without errors
- [ ] Sidebar shows "Photo Library" (persisted via libraryStore)
- [ ] Active library is still selected
- [ ] Grid size setting preserved (Medium/Large/etc.)
- [ ] Grid loads all 120 items again on library select
- [ ] Thumbnails load from cache (no regeneration needed)

---

#### Step 9: Memory and performance baseline

**Action:** Open Activity Monitor (macOS) or Task Manager, find the `shark` process.

**Verify:**
- [ ] Memory usage < 500MB with 120 items loaded
- [ ] Grid scroll is smooth (no jank, no frame drops)
- [ ] Search input responsiveness is instant (no debounce lag)
- [ ] App startup < 1 second from launch to interactive

---

#### Step 10: Final commit

If all checklist items pass:

```bash
git add -A
git commit -m "Complete Phase 1: core viewer with library, import, grid, and viewer

Verified:
- Library creation and persistence
- Folder import with thumbnail generation
- Virtual grid with 120+ items at 60fps
- Single image viewer with keyboard navigation
- Import flow with progress feedback
- State persistence across restarts
- Memory < 500MB baseline"
```

---

### Phase 1 Summary

At this point, the following functional loop is complete:

1. **Create** a library (via browser console -- UI creation form is Phase 2)
2. **Import** a folder of images via the Import button
3. **Browse** thumbnails in a virtual grid with smooth scrolling
4. **Select** items with click/ctrl+click/shift+click
5. **View** full-resolution images with arrow key navigation
6. **Persist** state across app restarts

**Files created in Tasks 9-15:**
```
src/
  lib/types.ts
  hooks/useInvoke.ts
  hooks/useThumbnails.ts
  stores/libraryStore.ts
  stores/itemStore.ts
  stores/filterStore.ts
  stores/viewStore.ts
  stores/uiStore.ts
  App.tsx
  components/
    Toolbar/Toolbar.tsx
    Import/ImportButton.tsx
    Import/ImportProgress.tsx
    Sidebar/Sidebar.tsx
    Sidebar/LibrarySelector.tsx
    Sidebar/FolderList.tsx
    Grid/VirtualGrid.tsx
    Grid/AssetCard.tsx
    Viewer/ImageViewer.tsx
```

**Deferred to Phase 2:**
- Library creation dialog (currently console-only)
- Folder tree nesting (currently flat list)
- Real-time import progress via Tauri events
- Search integration (FTS5 backend exists, search bar needs wiring to `search_items_cmd`)
- Drag-and-drop import
- Multi-select batch operations
- Color extraction