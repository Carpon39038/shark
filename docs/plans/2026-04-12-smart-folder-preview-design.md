# Smart Folder Rule Preview — Design

## Goal

Show a live match count in the Smart Folder editor so users know how many items their rules will match *before* saving.

## UX

Plain text line between "+ Add Condition" and the action buttons:

```
┌─────────────────────────────┐
│ Match: ALL conditions        │
│ [field] [op] [value]         │
│ [field] [op] [value]         │
│ + Add Condition              │
│                              │
│ 匹配 128 个项目               │
│              [Cancel] [Save] │
└─────────────────────────────┘
```

- Querying: "正在计算..."
- Error: hide the line (silent fail)

300 ms debounce after any rule change before querying.

## Rust — new IPC command

```rust
// commands.rs
#[tauri::command]
pub fn preview_smart_folder(
    library_id: String,
    rules: String,
    state: State<'_, DbState>,
) -> Result<u64, AppError>
```

Implementation:

1. Parse `rules` JSON → `RuleGroup` (reuse existing `serde_json::from_str`)
2. Call `smart_folder::rules_to_sql(&rule_group)` to get `(sql_fragment, params)`
3. Execute `SELECT COUNT(*) FROM items WHERE status = 'active' AND (<generated>)` with params
4. Return count as `u64`

Reuses the existing `rules_to_sql()` function — no new SQL generation logic.

## Frontend — editor changes

In `SmartFolderEditor.tsx`:

- `matchCount` state: `number | null` (null = not yet queried)
- `useEffect` watching `operator` and `conditions` with 300 ms debounce:
  - Serialise `{ operator, conditions }` to JSON
  - `invoke('preview_smart_folder', { libraryId, rules })`
  - Set `matchCount` on success, leave `null` on error
- Render the count line between the add-condition button and the action buttons

No new store needed — the editor is self-contained and already receives `library_id` through the smart folder store.
