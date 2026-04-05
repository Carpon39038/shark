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
| parent_id | TEXT | References smart_folders(id), nullable |

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

### IPC Commands

| Command | Signature | Description |
|---------|-----------|-------------|
| `list_smart_folders` | `(library_id: String) -> Vec<SmartFolder>` | List all smart folders |
| `get_smart_folder` | `(library_id: String, id: String) -> SmartFolder` | Get single smart folder |
| `create_smart_folder` | `(library_id: String, name: String, rules: String, parent_id: Option<String>) -> SmartFolder` | Create new |
| `update_smart_folder` | `(library_id: String, id: String, name: Option<String>, rules: Option<String>, parent_id: Option<Option<String>>) -> SmartFolder` | Update fields |
| `delete_smart_folder` | `(library_id: String, id: String) -> ()` | Delete with cascade |
| `get_smart_folder_items` | `(library_id: String, id: String, page: i32, page_size: i32) -> (Vec<Item>, i32)` | Resolve rules to items |

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
- Setting smartFolderId clears folderId (mutually exclusive)

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
| Parent smart folder deleted | CASCADE deletes children |
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
- `filterStore` — smartFolderId and folderId mutual exclusivity

## MVP Scope

- [x] Visual rule builder (create/edit)
- [x] Sidebar smart folder section with nesting
- [x] Query filtering (resolve rules to items)
- [x] Delete smart folder (right-click menu)
- [x] Edit smart folder
- [ ] Save from current filters (post-MVP)
- [ ] Drag-and-drop reorder (post-MVP)
