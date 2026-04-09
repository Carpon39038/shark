# Tag Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add full tag management — sidebar tag panel with counts, inspector panel for editing tags/rating/notes, tag filtering, right-click context menu.

**Architecture:** Generic `update_item` backend command for field patches. Frontend handles comma-separated tag string manipulation. `get_tag_counts` for sidebar display. Tag filter added to existing `query_items` flow.

**Tech Stack:** Rust (rusqlite), React/TypeScript, Zustand, Tailwind CSS

---

### Task 1: Add `tag` field to `ItemFilter` + tag filter in `build_filter_params`

**Files:**
- Modify: `src-tauri/src/models.rs:64-69`
- Modify: `src-tauri/src/db.rs:40-70`

**Step 1: Add `tag` field to `ItemFilter` in models.rs**

In `src-tauri/src/models.rs`, add `tag` field to `ItemFilter` after `search_query`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ItemFilter {
    pub folder_id: Option<String>,
    pub file_types: Option<Vec<String>>,
    pub rating_min: Option<i64>,
    pub search_query: Option<String>,
    pub tag: Option<String>,
}
```

**Step 2: Add tag filter clause in `build_filter_params` in db.rs**

In `src-tauri/src/db.rs`, inside `build_filter_params`, add after the `rating_min` block and before the `status = 'active'` line:

```rust
    if let Some(ref tag) = filter.tag {
        if !tag.is_empty() {
            where_clauses.push(format!("(',' || tags || ',') LIKE ?{}", param_values.len() + 1));
            param_values.push(Box::new(format!("%,{tag},%")));
        }
    }
```

This uses the `',' || tags || ',' LIKE '%,tag,%'` trick to avoid partial matches (e.g., tag "art" won't match "artwork").

**Step 3: Run cargo check**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors

**Step 4: Run existing tests**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass

**Step 5: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/db.rs
git commit -m "feat: add tag filter to ItemFilter and query_items"
```

---

### Task 2: Add `update_item` backend command

**Files:**
- Modify: `src-tauri/src/db.rs` (add `update_item` function)
- Modify: `src-tauri/src/commands.rs` (add IPC command)
- Modify: `src-tauri/src/lib.rs` (register command)

**Step 1: Write failing test in db.rs**

Add to the `tests` module in `src-tauri/src/db.rs`, after `test_get_all_tags`:

```rust
    #[test]
    fn test_update_item() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let mut item = make_test_item("id-1", "1");
        item.tags = "landscape".to_string();
        insert_item(&conn, &item).unwrap();

        // Update tags only
        let updated = update_item(&conn, "id-1", Some("landscape,nature"), None, None).unwrap();
        assert_eq!(updated.tags, "landscape,nature");
        assert_eq!(updated.rating, 0); // unchanged

        // Update rating only
        let updated = update_item(&conn, "id-1", None, Some(5), None).unwrap();
        assert_eq!(updated.tags, "landscape,nature"); // unchanged
        assert_eq!(updated.rating, 5);

        // Update notes only
        let updated = update_item(&conn, "id-1", None, None, Some("great photo")).unwrap();
        assert_eq!(updated.notes, "great photo");

        // Verify modified_at changed
        let fetched = get_item(&conn, "id-1").unwrap();
        assert_eq!(fetched.tags, "landscape,nature");
        assert_eq!(fetched.rating, 5);
        assert_eq!(fetched.notes, "great photo");
    }
```

**Step 2: Run test to verify it fails**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml test_update_item`
Expected: FAIL — `update_item` function not found

**Step 3: Implement `update_item` in db.rs**

Add in `src-tauri/src/db.rs`, after `get_item` (after the `get_item` function, around line 324):

```rust
pub fn update_item(
    conn: &Connection,
    id: &str,
    tags: Option<&str>,
    rating: Option<i64>,
    notes: Option<&str>,
) -> Result<Item, AppError> {
    // Verify exists
    get_item(conn, id)?;

    let mut set_clauses = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(t) = tags {
        set_clauses.push(format!("tags = ?{}", param_values.len() + 1));
        param_values.push(Box::new(t.to_string()));
    }
    if let Some(r) = rating {
        set_clauses.push(format!("rating = ?{}", param_values.len() + 1));
        param_values.push(Box::new(r));
    }
    if let Some(n) = notes {
        set_clauses.push(format!("notes = ?{}", param_values.len() + 1));
        param_values.push(Box::new(n.to_string()));
    }

    if set_clauses.is_empty() {
        return get_item(conn, id);
    }

    set_clauses.push("modified_at = datetime('now')".to_string());

    let sql = format!(
        "UPDATE items SET {} WHERE id = ?{}",
        set_clauses.join(", "),
        param_values.len() + 1
    );
    param_values.push(Box::new(id.to_string()));

    let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_refs.as_slice())?;

    get_item(conn, id)
}
```

**Step 4: Run test to verify it passes**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml test_update_item`
Expected: PASS

**Step 5: Add IPC command in commands.rs**

Add in `src-tauri/src/commands.rs`, after `get_all_tags` (around line 490):

```rust
#[tauri::command]
pub fn update_item(
    item_id: String,
    tags: Option<String>,
    rating: Option<i64>,
    notes: Option<String>,
    state: State<'_, DbState>,
) -> Result<Item, AppError> {
    with_library_conn(&state, |conn| {
        db::update_item(
            conn,
            &item_id,
            tags.as_deref(),
            rating,
            notes.as_deref(),
        )
    })
}
```

**Step 6: Register command in lib.rs**

Add `commands::update_item,` to the `invoke_handler` list in `src-tauri/src/lib.rs`, after `commands::get_all_tags,`:

```rust
commands::update_item,
```

**Step 7: Run cargo check**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors

**Step 8: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add update_item command for tags/rating/notes"
```

---

### Task 3: Add `TagCount` model and `get_tag_counts` command

**Files:**
- Modify: `src-tauri/src/models.rs` (add `TagCount` struct)
- Modify: `src-tauri/src/db.rs` (add `get_tag_counts` function)
- Modify: `src-tauri/src/commands.rs` (add IPC command)
- Modify: `src-tauri/src/lib.rs` (register command)

**Step 1: Write failing test in db.rs**

Add to the tests module:

```rust
    #[test]
    fn test_get_tag_counts() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let mut item1 = make_test_item("id-1", "1");
        item1.tags = "landscape,nature".to_string();
        insert_item(&conn, &item1).unwrap();

        let mut item2 = make_test_item("id-2", "2");
        item2.tags = "portrait,nature".to_string();
        insert_item(&conn, &item2).unwrap();

        let mut item3 = make_test_item("id-3", "3");
        item3.tags = "landscape".to_string();
        insert_item(&conn, &item3).unwrap();

        let counts = get_tag_counts(&conn).unwrap();
        assert_eq!(counts.len(), 3);

        let landscape = counts.iter().find(|tc| tc.tag == "landscape").unwrap();
        assert_eq!(landscape.count, 2);

        let nature = counts.iter().find(|tc| tc.tag == "nature").unwrap();
        assert_eq!(nature.count, 2);

        let portrait = counts.iter().find(|tc| tc.tag == "portrait").unwrap();
        assert_eq!(portrait.count, 1);
    }
```

**Step 2: Run test to verify it fails**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml test_get_tag_counts`
Expected: FAIL

**Step 3: Add `TagCount` struct to models.rs**

Add at the end of `src-tauri/src/models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagCount {
    pub tag: String,
    pub count: i64,
}
```

**Step 4: Implement `get_tag_counts` in db.rs**

Add after `get_all_tags` in `src-tauri/src/db.rs`:

```rust
pub fn get_tag_counts(conn: &Connection) -> Result<Vec<TagCount>, AppError> {
    let mut stmt = conn.prepare("SELECT DISTINCT tags FROM items WHERE tags != '' AND status = 'active'")?;
    let rows = stmt.query_map([], |row| {
        let tags: String = row.get(0)?;
        Ok(tags)
    })?;

    let mut tag_counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for row in rows {
        let tags_str = row?;
        for tag in tags_str.split(',') {
            let trimmed = tag.trim();
            if !trimmed.is_empty() {
                *tag_counts.entry(trimmed.to_string()).or_insert(0) += 1;
            }
        }
    }

    let mut result: Vec<TagCount> = tag_counts
        .into_iter()
        .map(|(tag, count)| TagCount { tag, count })
        .collect();
    result.sort_by(|a, b| b.count.cmp(&a.count).then(a.tag.cmp(&b.tag)));
    Ok(result)
}
```

Don't forget to add `use crate::models::TagCount;` at the top of db.rs if needed (it's in the same crate, so `use super::*` in tests already covers it).

**Step 5: Run test to verify it passes**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml test_get_tag_counts`
Expected: PASS

**Step 6: Add IPC command in commands.rs**

Add after `get_all_tags` command in `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub fn get_tag_counts(
    library_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<TagCount>, AppError> {
    let _ = library_id;
    with_library_conn(&state, |conn| db::get_tag_counts(conn))
}
```

**Step 7: Register command in lib.rs**

Add `commands::get_tag_counts,` to the invoke_handler list, after `commands::get_all_tags,`:

```rust
commands::get_tag_counts,
```

**Step 8: Run cargo check**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors

**Step 9: Run all tests**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass

**Step 10: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/db.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add TagCount model and get_tag_counts command"
```

---

### Task 4: Update frontend types and stores

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/stores/filterStore.ts`
- Modify: `src/stores/viewStore.ts`

**Step 1: Add `TagCount` type and update `ItemFilter` in types.ts**

Add to `src/lib/types.ts` after the `SearchResult` interface:

```typescript
export interface TagCount {
  tag: string;
  count: number;
}
```

Update `ItemFilter` to include `tag`:

```typescript
export interface ItemFilter {
  folder_id?: string | null;
  file_types?: string[] | null;
  rating_min?: number | null;
  search_query?: string | null;
  tag?: string | null;
}
```

**Step 2: Update filterStore — add `selectedTag`**

In `src/stores/filterStore.ts`, add to `FilterState`:

```typescript
selectedTag: string | null;
```

Add to `FilterActions`:

```typescript
setSelectedTag: (tag: string | null) => void;
```

Add to initial state:

```typescript
selectedTag: null,
```

Add implementation:

```typescript
setSelectedTag: (tag) => set({ selectedTag: tag }),
```

Also add `selectedTag: null` to `resetFilters`.

**Step 3: Update viewStore — add `inspectorOpen`**

In `src/stores/viewStore.ts`, add to `ViewState`:

```typescript
inspectorOpen: boolean;
```

Add to `ViewActions`:

```typescript
toggleInspector: () => void;
```

Add to initial state:

```typescript
inspectorOpen: false,
```

Add implementation:

```typescript
toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
```

**Step 4: Verify frontend compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors

**Step 5: Commit**

```bash
git add src/lib/types.ts src/stores/filterStore.ts src/stores/viewStore.ts
git commit -m "feat: add TagCount type, selectedTag filter, inspectorOpen state"
```

---

### Task 5: Wire tag filter into grid loading

**Files:**
- Modify: `src/components/Toolbar/Toolbar.tsx` (pass tag filter to loadItems)
- Modify: `src/components/Sidebar/Sidebar.tsx` (load tag counts, pass tag filter)

**Step 1: Update Toolbar search to include tag filter**

In `src/components/Toolbar/Toolbar.tsx`, update the `handleSearch` and the else branch to include `selectedTag`:

Add import:

```typescript
import { useFilterStore } from '@/stores/filterStore';
```

The `searchQuery` and `setSearchQuery` are already destructured from `useFilterStore`. Also destructure `selectedTag`:

```typescript
const { searchQuery, setSearchQuery, selectedTag } = useFilterStore();
```

Update the `loadItems` call in `handleSearch` else branch to merge all existing filters with the tag filter:

```typescript
loadItems(
  activeLibraryId,
  {
    ...(searchQuery && { search_query: searchQuery }),
    ...(fileTypes.length > 0 && { file_types: fileTypes }),
    ...(ratingMin != null && { rating_min: ratingMin }),
    ...(selectedTag && { tag: selectedTag }),
  },
  { field: 'created_at', direction: 'desc' },
  { page: 0, page_size: 100 },
);
```

Note: Also destructure `fileTypes` and `ratingMin` from `useFilterStore()` to include them in the filter.

**Step 2: Verify frontend compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors

**Step 3: Commit**

```bash
git add src/components/Toolbar/Toolbar.tsx
git commit -m "feat: wire selectedTag filter into grid loading"
```

---

### Task 6: Create `TagPanel` sidebar component

**Files:**
- Create: `src/components/Sidebar/TagPanel.tsx`
- Modify: `src/components/Sidebar/Sidebar.tsx`

**Step 1: Create TagPanel component**

Create `src/components/Sidebar/TagPanel.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '@/stores/libraryStore';
import { useFilterStore } from '@/stores/filterStore';
import { useItemStore } from '@/stores/itemStore';
import type { TagCount } from '@/lib/types';

export function TagPanel() {
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const selectedTag = useFilterStore((s) => s.selectedTag);
  const setSelectedTag = useFilterStore((s) => s.setSelectedTag);
  const loadItems = useItemStore((s) => s.loadItems);

  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const [search, setSearch] = useState('');

  const loadTags = useCallback(async () => {
    if (!activeLibraryId) {
      setTagCounts([]);
      return;
    }
    try {
      const counts = await invoke<TagCount[]>('get_tag_counts', { libraryId: activeLibraryId });
      setTagCounts(counts);
    } catch (e) {
      console.error('Failed to load tag counts:', e);
    }
  }, [activeLibraryId]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  // Reload tags when items change (after import, update, etc.)
  // Only trigger on actual items array changes, not selection or other state
  useEffect(() => {
    const unsub = useItemStore.subscribe(
      (state) => state.items,
      () => loadTags(),
    );
    return unsub;
  }, [loadTags]);

  const filteredTags = search
    ? tagCounts.filter((tc) => tc.tag.toLowerCase().includes(search.toLowerCase()))
    : tagCounts;

  const handleTagClick = (tag: string) => {
    const newTag = selectedTag === tag ? null : tag;
    setSelectedTag(newTag);
    if (activeLibraryId) {
      const { searchQuery, fileTypes, ratingMin } = useFilterStore.getState();
      loadItems(
        activeLibraryId,
        {
          ...(searchQuery && { search_query: searchQuery }),
          ...(fileTypes?.length && { file_types: fileTypes }),
          ...(ratingMin != null && { rating_min: ratingMin }),
          ...(newTag && { tag: newTag }),
        },
        { field: 'created_at', direction: 'desc' },
        { page: 0, page_size: 100 },
      );
    }
  };

  if (tagCounts.length === 0) return null;

  return (
    <div className="px-2 pb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Tags</span>
        <span className="text-xs text-neutral-600">{tagCounts.length}</span>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter tags..."
        className="w-full mb-1 px-2 py-1 bg-neutral-700/50 border border-neutral-600 rounded text-xs text-white placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none"
      />

      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {filteredTags.map((tc) => (
          <button
            key={tc.tag}
            onClick={() => handleTagClick(tc.tag)}
            className={`w-full text-left px-2 py-1 rounded text-xs flex items-center justify-between group transition-colors ${
              selectedTag === tc.tag
                ? 'bg-blue-600/20 text-blue-300'
                : 'text-neutral-400 hover:bg-neutral-700/50 hover:text-neutral-300'
            }`}
          >
            <span className="truncate">{tc.tag}</span>
            <span className="text-neutral-600 group-hover:text-neutral-500 tabular-nums">{tc.count}</span>
          </button>
        ))}
        {filteredTags.length === 0 && (
          <span className="text-xs text-neutral-600 px-2">No tags found</span>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Add TagPanel to Sidebar**

In `src/components/Sidebar/Sidebar.tsx`, add import:

```tsx
import { TagPanel } from './TagPanel';
```

Add `<TagPanel />` before `<SidebarDropZone />`:

```tsx
<TagPanel />
<SidebarDropZone />
```

**Step 3: Verify frontend compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors

**Step 4: Commit**

```bash
git add src/components/Sidebar/TagPanel.tsx src/components/Sidebar/Sidebar.tsx
git commit -m "feat: add TagPanel component in sidebar"
```

---

### Task 7: Create `InspectorPanel` component

**Files:**
- Create: `src/components/Inspector/InspectorPanel.tsx`

**Step 1: Create InspectorPanel component**

Create `src/components/Inspector/InspectorPanel.tsx`:

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useItemStore } from '@/stores/itemStore';
import { useLibraryStore } from '@/stores/libraryStore';
import type { Item, TagCount } from '@/lib/types';

export function InspectorPanel() {
  const items = useItemStore((s) => s.items);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);

  const selectedItem = items.find((i) => selectedIds.has(i.id) && selectedIds.size === 1) ?? null;

  if (!selectedItem) {
    return (
      <div className="w-60 shrink-0 bg-neutral-800 border-l border-neutral-700 flex items-center justify-center">
        <span className="text-xs text-neutral-600">Select an item to inspect</span>
      </div>
    );
  }

  return <ItemInspector item={selectedItem} activeLibraryId={activeLibraryId} />;
}

function ItemInspector({
  item,
  activeLibraryId,
}: {
  item: Item;
  activeLibraryId: string | null;
}) {
  const [tags, setTags] = useState(item.tags);
  const [rating, setRating] = useState(item.rating);
  const [notes, setNotes] = useState(item.notes);
  const [allTags, setAllTags] = useState<TagCount[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const tagInputRef = useRef<HTMLInputElement>(null);

  // Sync local state when item changes
  useEffect(() => {
    setTags(item.tags);
    setRating(item.rating);
    setNotes(item.notes);
  }, [item.id, item.tags, item.rating, item.notes]);

  // Load all tags for autocomplete
  useEffect(() => {
    if (!activeLibraryId) return;
    invoke<TagCount[]>('get_tag_counts', { libraryId: activeLibraryId })
      .then(setAllTags)
      .catch(console.error);
  }, [activeLibraryId, tags]);

  const parseTags = (tagsStr: string): string[] =>
    tagsStr.split(',').map((t) => t.trim()).filter(Boolean);

  const tagsList = parseTags(tags);

  const saveField = useCallback(
    async (field: { tags?: string; rating?: number; notes?: string }) => {
      if (!activeLibraryId) return;
      try {
        const updated = await invoke<Item>('update_item', {
          itemId: item.id,
          tags: field.tags,
          rating: field.rating,
          notes: field.notes,
        });
        // Update item in local store instead of full reload
        useItemStore.setState((state) => ({
          items: state.items.map((i) => (i.id === item.id ? updated : i)),
        }));
      } catch (e) {
        console.error('Failed to update item:', e);
      }
    },
    [item.id, activeLibraryId],
  );

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed || tagsList.includes(trimmed)) return;
    const newTags = [...tagsList, trimmed].join(',');
    setTags(newTags);
    saveField({ tags: newTags });
    setTagInput('');
    setShowSuggestions(false);
  };

  const removeTag = (tag: string) => {
    const newTags = tagsList.filter((t) => t !== tag).join(',');
    setTags(newTags);
    saveField({ tags: newTags });
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (tagInput.trim()) addTag(tagInput);
    } else if (e.key === 'Backspace' && !tagInput && tagsList.length > 0) {
      removeTag(tagsList[tagsList.length - 1]);
    }
  };

  const suggestions = allTags
    .map((tc) => tc.tag)
    .filter((t) => !tagsList.includes(t) && t.toLowerCase().includes(tagInput.toLowerCase()));

  return (
    <div className="w-60 shrink-0 bg-neutral-800 border-l border-neutral-700 overflow-y-auto">
      <div className="p-3 space-y-4">
        {/* File info */}
        <div>
          <span className="text-xs text-neutral-500 block truncate" title={item.file_name}>
            {item.file_name}
          </span>
          {item.width && item.height && (
            <span className="text-xs text-neutral-600">
              {item.width} x {item.height}
            </span>
          )}
        </div>

        {/* Tags */}
        <div>
          <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">
            Tags
          </label>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {tagsList.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-neutral-700 rounded text-xs text-neutral-300 group"
              >
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="text-neutral-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  x
                </button>
              </span>
            ))}
          </div>
          <div className="relative">
            <input
              ref={tagInputRef}
              type="text"
              value={tagInput}
              onChange={(e) => {
                setTagInput(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onKeyDown={handleTagKeyDown}
              placeholder="Add tag..."
              className="w-full px-2 py-1 bg-neutral-700/50 border border-neutral-600 rounded text-xs text-white placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-0.5 bg-neutral-700 border border-neutral-600 rounded shadow-lg max-h-32 overflow-y-auto">
                {suggestions.slice(0, 8).map((tag) => (
                  <button
                    key={tag}
                    onMouseDown={() => addTag(tag)}
                    className="w-full text-left px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-600"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Rating */}
        <div>
          <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">
            Rating
          </label>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => {
                  const newRating = rating === star ? 0 : star;
                  setRating(newRating);
                  saveField({ rating: newRating });
                }}
                className={`text-lg leading-none ${
                  star <= rating ? 'text-yellow-400' : 'text-neutral-600 hover:text-yellow-400/50'
                }`}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== item.notes) saveField({ notes });
            }}
            placeholder="Add notes..."
            rows={3}
            className="w-full px-2 py-1 bg-neutral-700/50 border border-neutral-600 rounded text-xs text-white placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none resize-none"
          />
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
git add src/components/Inspector/InspectorPanel.tsx
git commit -m "feat: add InspectorPanel component with tag/rating/notes editing"
```

---

### Task 8: Wire InspectorPanel into App layout + Toolbar toggle

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Toolbar/Toolbar.tsx`

**Step 1: Add InspectorPanel to App.tsx**

In `src/App.tsx`, add import:

```tsx
import { InspectorPanel } from '@/components/Inspector/InspectorPanel';
```

Add `useViewStore` import (already imported) and destructure `inspectorOpen`:

```tsx
const inspectorOpen = useViewStore((s) => s.inspectorOpen);
```

Update the layout div to include InspectorPanel:

Change:
```tsx
<div className="flex flex-1 overflow-hidden">
  {sidebarOpen && <Sidebar />}
  <VirtualGrid />
</div>
```

To:
```tsx
<div className="flex flex-1 overflow-hidden">
  {sidebarOpen && <Sidebar />}
  <VirtualGrid />
  {inspectorOpen && <InspectorPanel />}
</div>
```

**Step 2: Add inspector toggle button to Toolbar**

In `src/components/Toolbar/Toolbar.tsx`, add to the destructured `useViewStore`:

```tsx
const { sidebarOpen, toggleSidebar, gridSize, setGridSize, inspectorOpen, toggleInspector } = useViewStore();
```

Add an inspector toggle button after the ImportButton, before the closing `</div>` of the toolbar:

```tsx
<button
  onClick={toggleInspector}
  className={`p-1.5 hover:bg-neutral-700 rounded transition-colors ${inspectorOpen ? 'text-blue-400' : ''}`}
  title={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
>
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="8" cy="6.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M5 13c0-1.7 1.3-3 3-3s3 1.3 3 3" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
</button>
```

**Step 3: Verify frontend compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors

**Step 4: Commit**

```bash
git add src/App.tsx src/components/Toolbar/Toolbar.tsx
git commit -m "feat: wire InspectorPanel into layout with toolbar toggle"
```

---

### Task 9: Add grid right-click context menu

**Files:**
- Create: `src/components/Grid/ContextMenu.tsx`
- Modify: `src/components/Grid/VirtualGrid.tsx`

**Step 1: Create ContextMenu component**

Create `src/components/Grid/ContextMenu.tsx`:

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useItemStore } from '@/stores/itemStore';
import { useLibraryStore } from '@/stores/libraryStore';
import type { Item, TagCount } from '@/lib/types';

interface ContextMenuProps {
  x: number;
  y: number;
  item: Item;
  onClose: () => void;
}

export function ContextMenu({ x, y, item, onClose }: ContextMenuProps) {
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [allTags, setAllTags] = useState<TagCount[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  useEffect(() => {
    if (!activeLibraryId) return;
    invoke<TagCount[]>('get_tag_counts', { libraryId: activeLibraryId })
      .then(setAllTags)
      .catch(console.error);
  }, [activeLibraryId]);

  const parseTags = (tagsStr: string): string[] =>
    tagsStr.split(',').map((t) => t.trim()).filter(Boolean);

  const updateTags = useCallback(
    async (newTags: string) => {
      if (!activeLibraryId) return;
      try {
        const updated = await invoke<Item>('update_item', { itemId: item.id, tags: newTags });
        // Update item in local store instead of full reload
        useItemStore.setState((state) => ({
          items: state.items.map((i) => (i.id === item.id ? updated : i)),
        }));
      } catch (e) {
        console.error('Failed to update tags:', e);
      }
      onClose();
    },
    [item.id, activeLibraryId, onClose],
  );

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed) return;
    const existing = parseTags(item.tags);
    if (existing.includes(trimmed)) return;
    updateTags([...existing, trimmed].join(','));
  };

  // Adjust position to stay in viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 150);

  const existingTags = parseTags(item.tags);
  const suggestions = allTags
    .map((tc) => tc.tag)
    .filter((t) => !existingTags.includes(t) && t.toLowerCase().includes(tagInput.toLowerCase()));

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-neutral-800 border border-neutral-600 rounded-lg shadow-xl py-1 min-w-[160px]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <button
        className="w-full text-left px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700"
        onClick={() => {
          useUiStore.getState().openViewer(item.id);
          onClose();
        }}
      >
        Open in Viewer
      </button>

      <div className="border-t border-neutral-700 my-1" />

      <button
        className="w-full text-left px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700"
        onClick={() => setAddingTag(true)}
      >
        Add Tag...
      </button>

      {addingTag && (
        <div className="px-2 py-1">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (tagInput.trim()) addTag(tagInput);
              }
              if (e.key === 'Escape') onClose();
            }}
            placeholder="Tag name..."
            autoFocus
            className="w-full px-2 py-1 bg-neutral-700 border border-neutral-600 rounded text-xs text-white focus:border-blue-500 focus:outline-none"
          />
          {tagInput && suggestions.length > 0 && (
            <div className="mt-0.5 bg-neutral-700 border border-neutral-600 rounded max-h-24 overflow-y-auto">
              {suggestions.slice(0, 5).map((tag) => (
                <button
                  key={tag}
                  onMouseDown={() => addTag(tag)}
                  className="w-full text-left px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-600"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

Note: The ContextMenu needs `useUiStore` import for the openViewer call. Add this import:

```tsx
import { useUiStore } from '@/stores/uiStore';
```

**Step 2: Wire context menu into VirtualGrid**

In `src/components/Grid/VirtualGrid.tsx`, add state and imports:

```tsx
import { ContextMenu } from './ContextMenu';
import type { Item } from '@/lib/types';
```

Add state inside the `VirtualGrid` function:

```tsx
const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: Item } | null>(null);
```

Add handler:

```tsx
const handleContextMenu = useCallback((e: React.MouseEvent, item: Item) => {
  e.preventDefault();
  setContextMenu({ x: e.clientX, y: e.clientY, item });
}, []);
```

Pass `onContextMenu` to each `AssetCard`:

```tsx
<AssetCard
  key={item.id}
  item={item}
  size={gridSize}
  selected={selectedIds.has(item.id)}
  thumbnailPath={thumbnailPaths[item.id]}
  onClick={(e) => handleClick(e, item.id)}
  onDoubleClick={() => handleDoubleClick(item.id)}
  onContextMenu={(e) => handleContextMenu(e, item)}
/>
```

**Step 3: Update AssetCard to accept onContextMenu**

In `src/components/Grid/AssetCard.tsx`, add `onContextMenu` to props:

```tsx
interface AssetCardProps {
  item: Item;
  size: number;
  selected: boolean;
  thumbnailPath?: string;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}
```

And pass it to the outer div:

```tsx
<div
  className={...}
  style={{ width: size }}
  onClick={onClick}
  onDoubleClick={onDoubleClick}
  onContextMenu={onContextMenu}
>
```

Render ContextMenu at the end of VirtualGrid's return, after the grid div:

```tsx
{contextMenu && (
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    item={contextMenu.item}
    onClose={() => setContextMenu(null)}
  />
)}
```

**Step 4: Verify frontend compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors

**Step 5: Commit**

```bash
git add src/components/Grid/ContextMenu.tsx src/components/Grid/VirtualGrid.tsx src/components/Grid/AssetCard.tsx
git commit -m "feat: add right-click context menu with Add Tag"
```

---

### Task 10: End-to-end verification

**Step 1: Run full Rust test suite**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass

**Step 2: Run frontend type check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

**Step 3: Start dev server and manual test**

Run: `pnpm tauri dev`

Manual test checklist:
- [ ] Inspector toggle button in toolbar works
- [ ] Inspector panel shows when item selected, placeholder when nothing selected
- [ ] Add tag via inspector input (Enter to add)
- [ ] Remove tag via x button on tag chip
- [ ] Tag autocomplete shows suggestions from existing tags
- [ ] Rating stars clickable, persists on reload
- [ ] Notes textarea saves on blur
- [ ] Sidebar TagPanel shows all tags with counts
- [ ] Click tag in sidebar filters grid
- [ ] Click active tag again clears filter
- [ ] Tag search in sidebar filters tag list
- [ ] Right-click on grid item shows context menu
- [ ] "Add Tag..." in context menu works with autocomplete
- [ ] "Open in Viewer" in context menu works
- [ ] Tag counts update after adding/removing tags
- [ ] Button-based import still works as before
- [ ] Search still works with tag filter active
