# Tag Management Design

**Goal:** Add full tag management — view all tags in sidebar, edit tags on items via inspector panel, filter grid by tag, right-click context menu.

**Approach:** Generic `update_item` command for field patches (tags, rating, notes). Frontend handles comma-separated tag string manipulation.

---

## Backend Changes

### 1. `update_item` command

**File:** `src-tauri/src/commands.rs`, `src-tauri/src/db.rs`

Accept optional field patches. Only updates provided fields, leaves others unchanged. Sets `modified_at` to now.

```rust
#[tauri::command]
pub fn update_item(
    item_id: String,
    tags: Option<String>,
    rating: Option<i64>,
    notes: Option<String>,
    state: State<'_, DbState>,
) -> Result<Item, AppError>
```

DB function builds dynamic SET clause from provided fields. FTS trigger auto-syncs tags column.

Note on rating semantics: `None` means "don't modify this field", `Some(0)` means "clear the rating". The UI uses click-same-star to clear (sends `Some(0)`). This distinction is sufficient for V1.

### 2. `get_tag_counts` command

**File:** `src-tauri/src/commands.rs`, `src-tauri/src/db.rs`

Returns tags with item counts for sidebar display.

```rust
#[tauri::command]
pub fn get_tag_counts(
    library_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<TagCount>, AppError>
```

Note: `library_id` is currently unused because each library uses a separate DB file. It's kept for API consistency and will be needed if migrating to a single-DB multi-library model.

```rust
pub struct TagCount {
    pub tag: String,
    pub count: i64,
}
```

SQL: parse comma-separated `tags` column, group by individual tag, count active items.

### 3. Tag filter in `query_items`

**File:** `src-tauri/src/db.rs`, `src-tauri/src/models.rs`

Add `tag` field to `ItemFilter`. Backend adds `WHERE (',' || tags || ',') LIKE '%,tag,%'` using parameterized query. This uses precise comma-delimited matching to avoid partial matches (e.g., "art" won't match "artwork").

```rust
pub struct ItemFilter {
    pub folder_id: Option<String>,
    pub file_types: Option<Vec<String>>,
    pub rating_min: Option<i64>,
    pub search_query: Option<String>,
    pub tag: Option<String>,  // NEW
}
```

### 4. Register new commands in `lib.rs`

Add `update_item` and `get_tag_counts` to invoke_handler.

---

## Frontend Changes

### 1. `TagPanel` component (Sidebar)

**File:** `src/components/Sidebar/TagPanel.tsx`

- Loads tag counts on library change via `get_tag_counts`
- Displays tags as a scrollable list with counts
- Click tag → sets `filterStore.selectedTag` → triggers grid reload
- Active tag highlighted with blue accent
- Small search input to filter the tag list
- Placed below `SmartFolderList` in Sidebar

### 2. `InspectorPanel` component (Right side)

**File:** `src/components/Inspector/InspectorPanel.tsx`

- Toggle visibility via `viewStore.inspectorOpen`
- Shows when a single item is selected (or always visible when open)
- Three sections:

**Tag editor:**
- Shows item's tags as removable chips (x button)
- Text input with autocomplete dropdown from all tags
- Enter to add tag, comma to separate
- Calls `update_item` on change

**Rating editor:**
- 5-star clickable rating
- Calls `update_item` on click

**Notes editor:**
- Textarea for notes
- Saves on blur (debounced)
- Calls `update_item`

### 3. Grid context menu

**File:** `src/components/Grid/ContextMenu.tsx`

- Right-click on AssetCard opens context menu
- Menu items: "Add Tag...", separator, "Open in Viewer"
- "Add Tag" shows inline input with autocomplete, same logic as inspector

### 4. Store updates

**filterStore:** Add `selectedTag: string | null` + `setSelectedTag` action

**viewStore:** Add `inspectorOpen: boolean` + `toggleInspector` action

**types.ts:** Add `TagCount` interface, update `ItemFilter` type

### 5. App layout

**File:** `src/App.tsx`

```
[Sidebar] [VirtualGrid] [InspectorPanel (conditional)]
```

InspectorPanel rendered conditionally when `inspectorOpen` is true.

### 6. Toolbar update

**File:** `src/components/Toolbar/Toolbar.tsx`

Add inspector toggle button (info icon) in toolbar.

---

## Data Flow

```
Tag click in sidebar
  → filterStore.setSelectedTag("landscape")
  → triggers loadItems with filter { tag: "landscape" }
  → backend: WHERE (',' || tags || ',') LIKE '%,landscape,%'
  → grid shows filtered items

Tag add in inspector
  → invoke('update_item', { itemId, tags: "landscape,nature" })
  → FTS trigger updates search index
  → TagPanel refreshes counts

Right-click → Add Tag
  → same update_item call
  → same refresh flow
```

---

## Scope (V1)

**In scope:**
- Single item tag editing (inspector + context menu)
- Tag list with counts in sidebar
- Click to filter by tag
- Rating and notes editing in inspector

**Out of scope (future):**
- Batch tag operations (multi-select)
- Tag color/grouping
- Tag rename/delete across all items
- Drag tags onto items

**Technical debt note:** Tags are stored as comma-separated strings. Future batch operations (rename/delete tag across all items) will require `UPDATE` on every matching row, which may be slow for large libraries. Consider migrating to a normalized `item_tags` join table before implementing batch operations.
