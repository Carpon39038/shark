# Smart Folders Design

## Overview

Smart folders are saved filters that dynamically match items based on user-defined rules. They appear as a separate section in the sidebar and support nested hierarchy.

## Data Model

Uses existing `smart_folders` table:

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PRIMARY KEY | UUID |
| name | TEXT NOT NULL | Display name |
| rules | TEXT NOT NULL | JSON filter rules |
| parent_id | TEXT | References smart_folders(id), nullable, ON DELETE CASCADE |
| sort_order | INTEGER NOT NULL DEFAULT 0 | Sort position for drag-and-drop reorder (post-MVP) |

### Rules JSON Format

```json
{
  "operator": "AND",
  "conditions": [
    { "field": "rating", "op": ">=", "value": 3 },
    { "field": "file_type", "op": "in", "value": ["JPG", "PNG"] },
    { "field": "tags", "op": "contains", "value": "landscape" }
  ]
}
```

- `operator`: `"AND"` or `"OR"`
- `conditions`: array of condition objects
- Empty conditions array = match all items

### Filterable Fields & Operators

| Field | Type | Supported Operators |
|-------|------|-------------------|
| file_name | text | `contains`, `eq`, `neq` |
| file_type | text | `eq`, `neq`, `in`, `not_in` |
| file_size | number | `eq`, `gt`, `gte`, `lt`, `lte`, `between` |
| width | number | `gt`, `gte`, `lt`, `lte`, `between` |
| height | number | `gt`, `gte`, `lt`, `lte`, `between` |
| tags | text | `contains`, `eq`, `neq` |
| rating | number | `eq`, `gt`, `gte`, `lt`, `lte` |
| notes | text | `contains`, `eq`, `neq` |
| created_at | date | `gte`, `lte`, `between` |
| modified_at | date | `gte`, `lte`, `between` |

## Backend (Rust)

### New Module: `src-tauri/src/smart_folder.rs`

- `RuleGroup` struct for deserializing rules JSON
- `Condition` struct for individual conditions
- `rules_to_sql(rules: &RuleGroup) -> Result<(String, Vec<Box<dyn rusqlite::types::ToSql>>), AppError>` — recursive conversion of rule tree to parameterized SQL WHERE clause
- Field name validated against allowlist (exact match, never interpolated)
- All values bound via parameterized queries

### SQL Generation Rules

- `contains` on text fields → `field LIKE ?` with `%value%`
- `in` / `not_in` → `field IN (?, ?, ...)` or `NOT IN`
- `between` → `field BETWEEN ? AND ?`
- Comparison operators → `field OP ?`
- AND/OR → join conditions with operator, wrap in parentheses
- Empty conditions → `1=1` (match all)

### Performance Considerations

For 100k+ item libraries:

- **Existing indexes** cover common filter fields: `idx_items_file_type` on `file_type`, `idx_items_rating` on `rating`, `idx_items_created_at` on `created_at`. These support equality and range queries.
- **tags LIKE '%value%'** cannot use B-tree indexes. For smart folder rules filtering by tags, use FTS5 auxiliary queries instead of LIKE when possible (`tags MATCH ?` with FTS5 prefix syntax). Post-MVP: consider a `tags` + `item_tags` normalized table for indexed tag lookups.
- **file_name / notes `contains`** also use LIKE with wildcards. FTS5 full-text search is available for these fields via `items_fts`. Consider routing `contains` on `file_name`/`notes` through FTS5 when the value is a word token (no special characters).
- **Complex rule evaluation** — AND/OR nesting with multiple conditions generates multi-clause WHERE. SQLite handles this well at 100k rows; no additional indexes needed beyond existing ones for the supported field set.

### IPC Commands

| Command | Signature | Description |
|---------|-----------|-------------|
| `list_smart_folders` | `(library_id: String) -> Vec<SmartFolder>` | List all smart folders ordered by sort_order |
| `get_smart_folder` | `(library_id: String, id: String) -> SmartFolder` | Get single smart folder |
| `create_smart_folder` | `(library_id: String, name: String, rules: String, parent_id: Option<String>) -> SmartFolder` | Create new |
| `update_smart_folder` | `(library_id: String, id: String, name: Option<String>, rules: Option<String>, parent_id: Option<Option<String>>) -> SmartFolder` | Update fields (see Option semantics below) |
| `delete_smart_folder` | `(library_id: String, id: String) -> ()` | Delete with CASCADE |
| `get_smart_folder_items` | `(library_id: String, id: String, page: i32, page_size: i32) -> ItemPage` | Resolve rules to items with pagination |

#### Option Semantics for `update_smart_folder`

For `name` and `rules` (NOT NULL columns): `None` = don't modify, `Some(value)` = set new value. These fields cannot be cleared.

For `parent_id` (nullable column): `None` = don't modify, `Some(None)` = clear to NULL (make top-level), `Some(Some(id))` = set new parent. This double-Option pattern is the standard Tauri IPC convention for distinguishing "skip this field" from "set to null".

## Frontend

### Sidebar Layout

Smart folders appear as an independent section below the regular folder list:

```
┌──────────────────────┐
│  Library Selector     │
├──────────────────────┤
│  All Items            │
│  📁 Photos            │
│  📁 Screenshots       │
├──────────────────────┤
│  Smart Folders    [+] │
│  ├─ ⭐ Best Photos    │
│  │  └─ 🔵 Recent     │
│  └─ 🏷️ Landscapes    │
└──────────────────────┘
```

- `[+]` button opens creation dialog
- Click smart folder → set `filterStore.smartFolderId` → backend query
- Right-click context menu: Edit, Delete

### Components

**`SmartFolderList`** — renders smart folder tree in sidebar
**`SmartFolderEditor`** — modal dialog for create/edit with visual rule builder

### Visual Rule Builder

```
┌─────────────────────────────┐
│  New Smart Folder           │
│  Name: [Best Photos       ] │
│                             │
│  Match: [ALL ▾]             │
│                             │
│  [Rating  ▾] [>= ▾] [3   ] │
│  [File Type▾] [in ▾] [JPG] │
│  + Add Condition            │
│                             │
│  Parent: [None ▾]           │
│                             │
│  [Cancel]        [Save]     │
└─────────────────────────────┘
```

- Field dropdown changes → operator dropdown updates to valid operators
- `in`/`not_in` → multi-select tag input
- `between` → two inputs (min/max)
- Date fields → date picker

### State Management

**`filterStore` additions:**
- `smartFolderId: string | null` — currently selected smart folder
- Setting `smartFolderId` clears the folder selection (mutually exclusive). Note: the current `filterStore` does not have a `folderId` field — folder selection is managed separately in `itemStore`. During implementation, add `smartFolderId` to `filterStore` and ensure mutual exclusivity is handled in the component that triggers item queries.

**New `smartFolderStore` (Zustand):**
- `folders: SmartFolder[]`
- `fetchFolders()` — load from backend
- `create(name, rules, parentId)` — create + refresh list
- `update(id, name, rules, parentId)` — edit + refresh list
- `remove(id)` — delete + refresh list

### Data Flow

```
User clicks smart folder
  → filterStore.setSmartFolderId(id)
  → itemStore calls get_smart_folder_items(id, page, pageSize)
  → Rust resolves rules → SQL → query items
  → Return items to Grid
```

## Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| Empty rules (0 conditions) | Match all items (SQL: `1=1`) |
| Parent smart folder deleted | `ON DELETE CASCADE` on foreign key deletes children |
| Invalid field name | Allowlist validation → AppError |
| Empty `in`/`not_in` array | Skip condition (don't append to WHERE) |
| `between` min > max | Auto-swap values |
| Invalid JSON | Deserialization error → AppError → frontend toast |

## Testing

### Rust Unit Tests (`smart_folder.rs`)
- `rules_to_sql` pure function tests for various rule combinations
- Single condition, multi-condition AND/OR, nested groups
- Invalid field name rejection, empty condition handling
- Boundary values

### Rust Integration Tests
- CRUD operations against temp SQLite database
- Query: insert test items → create smart folder → verify correct items returned
- Nesting: parent_id association, cascade delete

### Frontend Tests (Vitest)
- `smartFolderStore` — create/edit/delete state transitions
- `filterStore` — smartFolderId and folder selection mutual exclusivity

## Scope

### MVP
- Visual rule builder (create/edit)
- Sidebar smart folder section with nesting
- Query filtering (resolve rules to items)
- Delete smart folder (right-click menu)
- Edit smart folder

### Post-MVP
- Save from current filters
- Drag-and-drop reorder (sort_order field already in schema)
- Icon/color customization
