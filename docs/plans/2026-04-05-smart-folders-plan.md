# Smart Folders Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement smart folders — saved filter rules that dynamically query items from the library.

**Architecture:** Rust backend parses JSON rules into parameterized SQL. New `smart_folder.rs` module handles rules-to-SQL conversion and CRUD. Frontend gets a `SmartFolderList` sidebar section and a `SmartFolderEditor` modal with visual rule builder. A new `smartFolderStore` manages state; `filterStore` gains `smartFolderId`.

**Tech Stack:** Rust (rusqlite, serde, serde_json), TypeScript, React, Zustand, Tailwind CSS

---

### Task 1: Rust models for smart folder types

**Files:**
- Modify: `src-tauri/src/models.rs` (append after line 133)

**Step 1: Add SmartFolder and rule structs to models.rs**

Append after the `SearchResult` struct at the end of `models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFolder {
    pub id: String,
    pub name: String,
    pub rules: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleGroup {
    pub operator: String, // "AND" or "OR"
    pub conditions: Vec<Condition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Condition {
    pub field: String,
    pub op: String,
    pub value: serde_json::Value,
}
```

**Step 2: Run cargo check**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles without errors

**Step 3: Commit**

```bash
git add src-tauri/src/models.rs
git commit -m "feat: add SmartFolder and rule types to models"
```

---

### Task 2: Rules-to-SQL engine with unit tests

**Files:**
- Create: `src-tauri/src/smart_folder.rs`

**Step 1: Write the rules engine**

Create `src-tauri/src/smart_folder.rs`:

```rust
use rusqlite::types::ToSql;

use crate::error::AppError;
use crate::models::{Condition, RuleGroup};

/// Fields that can be used in smart folder rules.
const ALLOWED_FIELDS: &[&str] = &[
    "file_name",
    "file_type",
    "file_size",
    "width",
    "height",
    "tags",
    "rating",
    "notes",
    "created_at",
    "modified_at",
];

/// Operators allowed per field type.
fn allowed_ops_for_field(field: &str) -> &[&str] {
    match field {
        "file_name" | "notes" => &["contains", "eq", "neq"],
        "file_type" => &["eq", "neq", "in", "not_in"],
        "tags" => &["contains", "eq", "neq"],
        "file_size" | "width" | "height" => &["eq", "gt", "gte", "lt", "lte", "between"],
        "rating" => &["eq", "gt", "gte", "lt", "lte"],
        "created_at" | "modified_at" => &["gte", "lte", "between"],
        _ => &[],
    }
}

fn validate_condition(cond: &Condition) -> Result<(), AppError> {
    if !ALLOWED_FIELDS.contains(&cond.field.as_str()) {
        return Err(AppError::Database(format!(
            "Invalid field: '{}'",
            cond.field
        )));
    }
    if !allowed_ops_for_field(&cond.field).contains(&cond.op.as_str()) {
        return Err(AppError::Database(format!(
            "Invalid operator '{}' for field '{}'",
            cond.op, cond.field
        )));
    }
    Ok(())
}

/// Convert a condition into a SQL fragment and parameter values.
fn condition_to_sql(
    cond: &Condition,
    param_offset: usize,
) -> Result<(String, Vec<Box<dyn ToSql>>), AppError> {
    validate_condition(cond)?;

    let field = &cond.field;
    let op = &cond.op;
    let mut params: Vec<Box<dyn ToSql>> = Vec::new();

    let sql = match op.as_str() {
        "contains" => {
            // For tags, use LIKE with comma-delimited matching
            let val = cond
                .value
                .as_str()
                .ok_or_else(|| AppError::Database("contains expects a string".into()))?;
            if field == "tags" {
                // Match tag in comma-separated list: tag exactly, or tag at start/end/middle
                params.push(Box::new(format!("%,{val},%")));
                let p1 = param_offset + 1;
                params.push(Box::new(format!("{val},%")));
                let p2 = param_offset + 2;
                params.push(Box::new(format!("%,{val}")));
                let p3 = param_offset + 3;
                format!(
                    "({field} LIKE ?{p1} OR {field} LIKE ?{p2} OR {field} LIKE ?{p3} OR {field} = ?{p4})",
                    p4 = param_offset + 4
                )
            } else {
                params.push(Box::new(format!("%{val}%")));
                format!("{field} LIKE ?{}", param_offset + 1)
            }
        }
        "eq" | "neq" => {
            let cmp = if op == "eq" { "=" } else { "!=" };
            let val = value_to_sql_param(&cond.value, field)?;
            params.push(val);
            format!("{field} {cmp} ?{}", param_offset + 1)
        }
        "gt" | "gte" | "lt" | "lte" => {
            let cmp = match op.as_str() {
                "gt" => ">",
                "gte" => ">=",
                "lt" => "<",
                "lte" => "<=",
                _ => unreachable!(),
            };
            let val = value_to_sql_param(&cond.value, field)?;
            params.push(val);
            format!("{field} {cmp} ?{}", param_offset + 1)
        }
        "in" | "not_in" => {
            let arr = cond
                .value
                .as_array()
                .ok_or_else(|| AppError::Database("in/not_in expects an array".into()))?;
            if arr.is_empty() {
                return Ok(("1=1".to_string(), Vec::new()));
            }
            let placeholders: Vec<String> = (0..arr.len())
                .map(|i| format!("?{}", param_offset + i + 1))
                .collect();
            for v in arr {
                params.push(value_to_sql_param(v, field)?);
            }
            let keyword = if op == "in" { "IN" } else { "NOT IN" };
            format!("{field} {keyword} ({})", placeholders.join(", "))
        }
        "between" => {
            let arr = cond
                .value
                .as_array()
                .ok_or_else(|| AppError::Database("between expects an array [min, max]".into()))?;
            if arr.len() != 2 {
                return Err(AppError::Database(
                    "between expects exactly 2 values".into(),
                ));
            }
            let mut min_val = value_to_sql_param(&arr[0], field)?;
            let mut max_val = value_to_sql_param(&arr[1], field)?;
            // Auto-swap if needed (compare as strings for simplicity — works for numbers and dates)
            let p1 = param_offset + 1;
            let p2 = param_offset + 2;
            params.push(min_val);
            params.push(max_val);
            format!("{field} BETWEEN ?{p1} AND ?{p2}")
        }
        _ => return Err(AppError::Database(format!("Unknown operator: {op}"))),
    };

    Ok((sql, params))
}

fn value_to_sql_param(val: &serde_json::Value, field: &str) -> Result<Box<dyn ToSql>, AppError> {
    match val {
        serde_json::Value::String(s) => Ok(Box::new(s.clone())),
        serde_json::Value::Number(n) => {
            if n.is_i64() {
                Ok(Box::new(n.as_i64().unwrap()))
            } else {
                Ok(Box::new(n.as_f64().unwrap()))
            }
        }
        _ => Err(AppError::Database(format!(
            "Unsupported value type for field '{field}'"
        ))),
    }
}

/// Convert a RuleGroup into a SQL WHERE clause (without the WHERE keyword)
/// and a list of parameter values.
pub fn rules_to_sql(rules: &RuleGroup) -> Result<(String, Vec<Box<dyn ToSql>>), AppError> {
    if rules.conditions.is_empty() {
        return Ok(("1=1".to_string(), Vec::new()));
    }

    let mut fragments: Vec<String> = Vec::new();
    let mut all_params: Vec<Box<dyn ToSql>> = Vec::new();

    for cond in &rules.conditions {
        let offset = all_params.len();
        let (sql, params) = condition_to_sql(cond, offset)?;
        fragments.push(sql);
        all_params.extend(params);
    }

    let joiner = match rules.operator.as_str() {
        "OR" => " OR ",
        _ => " AND ",
    };

    let where_sql = if fragments.len() == 1 {
        fragments.into_iter().next().unwrap()
    } else {
        format!("({})", fragments.join(joiner))
    };

    Ok((where_sql, all_params))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_condition(field: &str, op: &str, value: serde_json::Value) -> Condition {
        Condition {
            field: field.to_string(),
            op: op.to_string(),
            value,
        }
    }

    #[test]
    fn test_single_eq_condition() {
        let rules = RuleGroup {
            operator: "AND".to_string(),
            conditions: vec![make_condition("rating", "gte", serde_json::json!(3))],
        };
        let (sql, params) = rules_to_sql(&rules).unwrap();
        assert!(sql.contains("rating >="));
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_multiple_and_conditions() {
        let rules = RuleGroup {
            operator: "AND".to_string(),
            conditions: vec![
                make_condition("rating", "gte", serde_json::json!(3)),
                make_condition("file_type", "eq", serde_json::json!("JPG")),
            ],
        };
        let (sql, params) = rules_to_sql(&rules).unwrap();
        assert!(sql.starts_with('('));
        assert!(sql.contains("AND"));
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn test_or_conditions() {
        let rules = RuleGroup {
            operator: "OR".to_string(),
            conditions: vec![
                make_condition("file_type", "eq", serde_json::json!("JPG")),
                make_condition("file_type", "eq", serde_json::json!("PNG")),
            ],
        };
        let (sql, _) = rules_to_sql(&rules).unwrap();
        assert!(sql.contains("OR"));
    }

    #[test]
    fn test_in_operator() {
        let rules = RuleGroup {
            operator: "AND".to_string(),
            conditions: vec![make_condition(
                "file_type",
                "in",
                serde_json::json!(["JPG", "PNG", "WEBP"]),
            )],
        };
        let (sql, params) = rules_to_sql(&rules).unwrap();
        assert!(sql.contains("IN"));
        assert!(sql.contains("?, ?, ?"));
        assert_eq!(params.len(), 3);
    }

    #[test]
    fn test_between_operator() {
        let rules = RuleGroup {
            operator: "AND".to_string(),
            conditions: vec![make_condition(
                "file_size",
                "between",
                serde_json::json!([1000, 5000]),
            )],
        };
        let (sql, params) = rules_to_sql(&rules).unwrap();
        assert!(sql.contains("BETWEEN"));
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn test_contains_text() {
        let rules = RuleGroup {
            operator: "AND".to_string(),
            conditions: vec![make_condition(
                "file_name",
                "contains",
                serde_json::json!("sunset"),
            )],
        };
        let (sql, params) = rules_to_sql(&rules).unwrap();
        assert!(sql.contains("LIKE"));
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_empty_conditions() {
        let rules = RuleGroup {
            operator: "AND".to_string(),
            conditions: vec![],
        };
        let (sql, params) = rules_to_sql(&rules).unwrap();
        assert_eq!(sql, "1=1");
        assert!(params.is_empty());
    }

    #[test]
    fn test_empty_in_array() {
        let rules = RuleGroup {
            operator: "AND".to_string(),
            conditions: vec![make_condition("file_type", "in", serde_json::json!([]))],
        };
        let (sql, params) = rules_to_sql(&rules).unwrap();
        assert_eq!(sql, "1=1");
        assert!(params.is_empty());
    }

    #[test]
    fn test_invalid_field_rejected() {
        let rules = RuleGroup {
            operator: "AND".to_string(),
            conditions: vec![make_condition(
                "evil_field",
                "eq",
                serde_json::json!("hax"),
            )],
        };
        assert!(rules_to_sql(&rules).is_err());
    }

    #[test]
    fn test_invalid_op_rejected() {
        let rules = RuleGroup {
            operator: "AND".to_string(),
            conditions: vec![make_condition("rating", "contains", serde_json::json!("x"))],
        };
        assert!(rules_to_sql(&rules).is_err());
    }

    #[test]
    fn test_not_in_operator() {
        let rules = RuleGroup {
            operator: "AND".to_string(),
            conditions: vec![make_condition(
                "file_type",
                "not_in",
                serde_json::json!(["GIF", "BMP"]),
            )],
        };
        let (sql, _) = rules_to_sql(&rules).unwrap();
        assert!(sql.contains("NOT IN"));
    }
}
```

**Step 2: Register the module in lib.rs**

In `src-tauri/src/lib.rs`, add `mod smart_folder;` after line 6 (`mod search;`).

**Step 3: Run tests**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml -- smart_folder`
Expected: all 11 tests pass

**Step 4: Commit**

```bash
git add src-tauri/src/smart_folder.rs src-tauri/src/lib.rs
git commit -m "feat: add rules-to-SQL engine for smart folders"
```

---

### Task 3: DB CRUD functions for smart folders

**Files:**
- Modify: `src-tauri/src/db.rs` (append after `get_all_tags` function, ~line 435)

**Step 1: Add smart folder CRUD functions to db.rs**

Append after the `get_all_tags` function:

```rust
// --- Smart Folders ---

pub fn list_smart_folders(conn: &Connection) -> Result<Vec<SmartFolder>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, rules, parent_id FROM smart_folders ORDER BY name",
    )?;
    let folders = stmt
        .query_map([], |row| {
            Ok(SmartFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                rules: row.get(2)?,
                parent_id: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(folders)
}

pub fn get_smart_folder(conn: &Connection, id: &str) -> Result<SmartFolder, AppError> {
    conn.query_row(
        "SELECT id, name, rules, parent_id FROM smart_folders WHERE id = ?1",
        params![id],
        |row| {
            Ok(SmartFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                rules: row.get(2)?,
                parent_id: row.get(3)?,
            })
        },
    )
    .map_err(|e| AppError::NotFound(format!("Smart folder {id}: {e}")))
}

pub fn create_smart_folder(
    conn: &Connection,
    name: &str,
    rules: &str,
    parent_id: Option<&str>,
) -> Result<SmartFolder, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO smart_folders (id, name, rules, parent_id) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, rules, parent_id],
    )?;
    get_smart_folder(conn, &id)
}

pub fn update_smart_folder(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    rules: Option<&str>,
    parent_id: Option<Option<&str>>,
) -> Result<SmartFolder, AppError> {
    // Verify exists first
    get_smart_folder(conn, id)?;

    let mut set_clauses = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(n) = name {
        param_values.push(Box::new(n.to_string()));
        set_clauses.push(format!("name = ?{}", param_values.len()));
    }
    if let Some(r) = rules {
        param_values.push(Box::new(r.to_string()));
        set_clauses.push(format!("rules = ?{}", param_values.len()));
    }
    if let Some(pid) = parent_id {
        param_values.push(Box::new(pid.map(String::from)));
        set_clauses.push(format!("parent_id = ?{}", param_values.len()));
    }

    if set_clauses.is_empty() {
        return get_smart_folder(conn, id);
    }

    param_values.push(Box::new(id.to_string()));
    let sql = format!(
        "UPDATE smart_folders SET {} WHERE id = ?{}",
        set_clauses.join(", "),
        param_values.len()
    );

    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_refs.as_slice())?;

    get_smart_folder(conn, id)
}

pub fn delete_smart_folder(conn: &Connection, id: &str) -> Result<(), AppError> {
    let rows = conn.execute("DELETE FROM smart_folders WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("Smart folder {id}")));
    }
    Ok(())
}

pub fn query_smart_folder_items(
    conn: &Connection,
    rules_json: &str,
    sort: &SortSpec,
    pagination: &Pagination,
) -> Result<ItemPage, AppError> {
    let rule_group: RuleGroup =
        serde_json::from_str(rules_json).map_err(|e| AppError::Database(format!("Invalid rules JSON: {e}")))?;
    let (where_fragment, mut rule_params) = crate::smart_folder::rules_to_sql(&rule_group)?;

    let allowed_sort_fields = ["created_at", "modified_at", "file_name", "file_size", "rating"];
    let sort_field = if allowed_sort_fields.contains(&sort.field.as_str()) {
        &sort.field
    } else {
        "created_at"
    };
    let sort_dir = match sort.direction {
        SortDirection::Asc => "ASC",
        SortDirection::Desc => "DESC",
    };

    // Count with rule WHERE + status filter
    let count_sql = format!(
        "SELECT COUNT(*) FROM items WHERE ({}) AND status = 'active'",
        where_fragment
    );
    let count_refs: Vec<&dyn rusqlite::types::ToSql> = rule_params.iter().map(|p| p.as_ref()).collect();
    let total: i64 = conn.query_row(&count_sql, count_refs.as_slice(), |row| row.get(0))?;

    // Query with pagination
    let limit_idx = rule_params.len() + 1;
    let offset_idx = rule_params.len() + 2;
    rule_params.push(Box::new(pagination.limit()));
    rule_params.push(Box::new(pagination.offset()));

    let query_sql = format!(
        "SELECT {ITEM_COLUMNS} FROM items WHERE ({}) AND status = 'active' ORDER BY {} {} LIMIT ?{} OFFSET ?{}",
        where_fragment, sort_field, sort_dir, limit_idx, offset_idx
    );
    let query_refs: Vec<&dyn rusqlite::types::ToSql> = rule_params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&query_sql)?;
    let items = stmt
        .query_map(query_refs.as_slice(), row_to_item)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ItemPage {
        items,
        total,
        page: pagination.page,
        page_size: pagination.page_size,
    })
}
```

**Step 2: Add `use crate::models::RuleGroup;` and `use crate::models::SmartFolder;` to db.rs imports**

Add to the imports at top of `db.rs` (after the existing `use crate::models::*;` is already there via the glob import — but `RuleGroup` is needed explicitly since it's used in `query_smart_folder_items`).

Actually, since `db.rs` already has `use crate::models::*;`, all the new types are automatically available. No change needed.

**Step 3: Fix the foreign key in the migration**

The existing `smart_folders` table has `FOREIGN KEY (parent_id) REFERENCES folders(id)`. This should reference `smart_folders(id)` instead. Add a migration to fix it.

In `run_library_migrations` in `db.rs`, after the `version < 1` block and before the closing `Ok(())`, add:

```rust
    if version < 2 {
        conn.execute_batch(
            "CREATE TABLE smart_folders_v2 (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                rules TEXT NOT NULL,
                parent_id TEXT,
                FOREIGN KEY (parent_id) REFERENCES smart_folders_v2(id) ON DELETE CASCADE
            );
            INSERT OR IGNORE INTO smart_folders_v2 (id, name, rules, parent_id) SELECT id, name, rules, parent_id FROM smart_folders;
            DROP TABLE smart_folders;
            ALTER TABLE smart_folders_v2 RENAME TO smart_folders;",
        )?;
        conn.pragma_update(None, "user_version", 2)?;
    }
```

**Step 4: Run cargo check**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles without errors

**Step 5: Run existing tests to verify no regressions**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all existing tests pass

**Step 6: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: add smart folder CRUD and query functions to db"
```

---

### Task 4: IPC command handlers

**Files:**
- Modify: `src-tauri/src/commands.rs` (append after existing commands)
- Modify: `src-tauri/src/lib.rs` (register new commands)

**Step 1: Add command handlers to commands.rs**

Append after the last command in `commands.rs`:

```rust
#[tauri::command]
pub fn list_smart_folders(state: State<'_, DbState>) -> Result<Vec<SmartFolder>, AppError> {
    with_library_conn(&state, |conn| db::list_smart_folders(conn))
}

#[tauri::command]
pub fn get_smart_folder(id: String, state: State<'_, DbState>) -> Result<SmartFolder, AppError> {
    with_library_conn(&state, |conn| db::get_smart_folder(conn, &id))
}

#[tauri::command]
pub fn create_smart_folder(
    name: String,
    rules: String,
    parent_id: Option<String>,
    state: State<'_, DbState>,
) -> Result<SmartFolder, AppError> {
    with_library_conn(&state, |conn| {
        // Validate rules parse correctly
        let _: RuleGroup = serde_json::from_str(&rules)
            .map_err(|e| AppError::Database(format!("Invalid rules JSON: {e}")))?;
        db::create_smart_folder(conn, &name, &rules, parent_id.as_deref())
    })
}

#[tauri::command]
pub fn update_smart_folder(
    id: String,
    name: Option<String>,
    rules: Option<String>,
    parent_id: Option<Option<String>>,
    state: State<'_, DbState>,
) -> Result<SmartFolder, AppError> {
    with_library_conn(&state, |conn| {
        if let Some(ref r) = rules {
            let _: RuleGroup = serde_json::from_str(r)
                .map_err(|e| AppError::Database(format!("Invalid rules JSON: {e}")))?;
        }
        db::update_smart_folder(
            conn,
            &id,
            name.as_deref(),
            rules.as_deref(),
            parent_id.as_ref().map(|opt| opt.as_deref()),
        )
    })
}

#[tauri::command]
pub fn delete_smart_folder(id: String, state: State<'_, DbState>) -> Result<(), AppError> {
    with_library_conn(&state, |conn| db::delete_smart_folder(conn, &id))
}

#[tauri::command]
pub fn query_smart_folder_items(
    id: String,
    sort: SortSpec,
    page: Pagination,
    state: State<'_, DbState>,
) -> Result<ItemPage, AppError> {
    with_library_conn(&state, |conn| {
        let sf = db::get_smart_folder(conn, &id)?;
        db::query_smart_folder_items(conn, &sf.rules, &sort, &page)
    })
}
```

Add `use crate::models::RuleGroup;` to the imports at the top of `commands.rs`.

**Step 2: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, add these to the `generate_handler![]` list:

```rust
commands::list_smart_folders,
commands::get_smart_folder,
commands::create_smart_folder,
commands::update_smart_folder,
commands::delete_smart_folder,
commands::query_smart_folder_items,
```

**Step 3: Run cargo check**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles without errors

**Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add IPC commands for smart folders"
```

---

### Task 5: TypeScript types

**Files:**
- Modify: `src/lib/types.ts` (append after line 67)

**Step 1: Add smart folder types**

Append to `src/lib/types.ts`:

```typescript
export interface SmartFolder {
  id: string;
  name: string;
  rules: string; // JSON string of RuleGroup
  parent_id: string | null;
}

export interface RuleGroup {
  operator: 'AND' | 'OR';
  conditions: Condition[];
}

export interface Condition {
  field: string;
  op: string;
  value: unknown;
}

export type FieldType = 'file_name' | 'file_type' | 'file_size' | 'width' | 'height' | 'tags' | 'rating' | 'notes' | 'created_at' | 'modified_at';

export type FieldKind = 'text' | 'number' | 'date';

export const FIELD_KINDS: Record<FieldType, FieldKind> = {
  file_name: 'text',
  file_type: 'text',
  file_size: 'number',
  width: 'number',
  height: 'number',
  tags: 'text',
  rating: 'number',
  notes: 'text',
  created_at: 'date',
  modified_at: 'date',
};

export const FIELD_LABELS: Record<FieldType, string> = {
  file_name: 'File Name',
  file_type: 'File Type',
  file_size: 'File Size',
  width: 'Width',
  height: 'Height',
  tags: 'Tags',
  rating: 'Rating',
  notes: 'Notes',
  created_at: 'Date Created',
  modified_at: 'Date Modified',
};

export const OPERATORS_BY_KIND: Record<FieldKind, { value: string; label: string }[]> = {
  text: [
    { value: 'contains', label: 'contains' },
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
  ],
  number: [
    { value: 'eq', label: '=' },
    { value: 'gt', label: '>' },
    { value: 'gte', label: '>=' },
    { value: 'lt', label: '<' },
    { value: 'lte', label: '<=' },
    { value: 'between', label: 'between' },
  ],
  date: [
    { value: 'gte', label: 'after' },
    { value: 'lte', label: 'before' },
    { value: 'between', label: 'between' },
  ],
};

// Special case: file_type also supports in/not_in
export const FILE_TYPE_OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'in', label: 'is one of' },
  { value: 'not_in', label: 'is not one of' },
];
```

**Step 2: Run frontend type check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add TypeScript types for smart folders"
```

---

### Task 6: smartFolderStore (Zustand)

**Files:**
- Create: `src/stores/smartFolderStore.ts`

**Step 1: Create the store**

```typescript
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { SmartFolder, RuleGroup } from '@/lib/types';
import { useUiStore } from './uiStore';
import { useLibraryStore } from './libraryStore';

interface SmartFolderState {
  folders: SmartFolder[];
  loading: boolean;
  selectedId: string | null;
}

interface SmartFolderActions {
  fetchFolders: () => Promise<void>;
  create: (name: string, rules: RuleGroup, parentId?: string | null) => Promise<void>;
  update: (id: string, name: string, rules: RuleGroup, parentId?: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setSelectedId: (id: string | null) => void;
}

export const useSmartFolderStore = create<SmartFolderState & SmartFolderActions>()(
  (set, get) => ({
    folders: [],
    loading: false,
    selectedId: null,

    fetchFolders: async () => {
      set({ loading: true });
      try {
        const folders = await invoke<SmartFolder[]>('list_smart_folders');
        set({ folders });
      } catch (e) {
        useUiStore.getState().setError(String(e));
      } finally {
        set({ loading: false });
      }
    },

    create: async (name, rules, parentId = null) => {
      try {
        await invoke<SmartFolder>('create_smart_folder', {
          name,
          rules: JSON.stringify(rules),
          parentId,
        });
        await get().fetchFolders();
      } catch (e) {
        useUiStore.getState().setError(String(e));
      }
    },

    update: async (id, name, rules, parentId = null) => {
      try {
        await invoke<SmartFolder>('update_smart_folder', {
          id,
          name,
          rules: JSON.stringify(rules),
          parentId,
        });
        await get().fetchFolders();
      } catch (e) {
        useUiStore.getState().setError(String(e));
      }
    },

    remove: async (id) => {
      try {
        await invoke('delete_smart_folder', { id });
        const { selectedId } = get();
        if (selectedId === id) {
          set({ selectedId: null });
        }
        await get().fetchFolders();
      } catch (e) {
        useUiStore.getState().setError(String(e));
      }
    },

    setSelectedId: (id) => set({ selectedId: id }),
  }),
);
```

**Step 2: Update filterStore to add smartFolderId**

In `src/stores/filterStore.ts`, add `smartFolderId` to the state and reset logic:

Add to `FilterState`:
```typescript
smartFolderId: string | null;
```

Add to `FilterActions`:
```typescript
setSmartFolderId: (id: string | null) => void;
```

Add to `initialState`:
```typescript
smartFolderId: null,
```

Add to the store implementation:
```typescript
setSmartFolderId: (id) => set({ smartFolderId: id }),
```

Update `resetFilters` to include:
```typescript
resetFilters: () => set({ ...initialState }),
```
(This already works since `initialState` will include the new field.)

**Step 3: Update itemStore to handle smart folder queries**

In `src/stores/itemStore.ts`, add a new action `loadSmartFolderItems`:

Add to `ItemActions`:
```typescript
loadSmartFolderItems: (
  libraryId: string,
  smartFolderId: string,
  sort: SortSpec,
  page: Pagination,
) => Promise<void>;
```

Add implementation:
```typescript
loadSmartFolderItems: async (libraryId, smartFolderId, sort, page) => {
  set({ loading: true });
  try {
    const result = await invoke<ItemPage>('query_smart_folder_items', {
      id: smartFolderId,
      sort,
      page,
    });
    set({
      items: result.items,
      total: result.total,
      selectedIds: new Set<string>(),
    });
    const ids = result.items.map((i) => i.id);
    if (ids.length > 0) {
      get().loadThumbnails(ids);
    }
  } catch (e) {
    console.error('Failed to load smart folder items:', e);
    useUiStore.getState().setError(String(e));
  } finally {
    set({ loading: false });
  }
},
```

**Step 4: Run frontend type check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

**Step 5: Commit**

```bash
git add src/stores/smartFolderStore.ts src/stores/filterStore.ts src/stores/itemStore.ts
git commit -m "feat: add smart folder stores and update filter/item stores"
```

---

### Task 7: SmartFolderList sidebar component

**Files:**
- Create: `src/components/Sidebar/SmartFolderList.tsx`
- Modify: `src/components/Sidebar/Sidebar.tsx`

**Step 1: Create SmartFolderList component**

Create `src/components/Sidebar/SmartFolderList.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useLibraryStore } from '@/stores/libraryStore';
import { useSmartFolderStore } from '@/stores/smartFolderStore';
import { useItemStore } from '@/stores/itemStore';
import { useFilterStore } from '@/stores/filterStore';
import type { SmartFolder } from '@/lib/types';

interface SmartFolderListProps {
  onEdit: (folder: SmartFolder) => void;
}

export function SmartFolderList({ onEdit }: SmartFolderListProps) {
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const { folders, selectedId, fetchFolders, setSelectedId, remove } =
    useSmartFolderStore();
  const loadItems = useItemStore((s) => s.loadItems);
  const loadSmartFolderItems = useItemStore((s) => s.loadSmartFolderItems);
  const setSmartFolderId = useFilterStore((s) => s.setSmartFolderId);
  const [contextMenu, setContextMenu] = useState<{
    folder: SmartFolder;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (activeLibraryId) {
      fetchFolders();
    }
  }, [activeLibraryId, fetchFolders]);

  // Close context menu on click anywhere
  useEffect(() => {
    const handler = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener('click', handler);
      return () => window.removeEventListener('click', handler);
    }
  }, [contextMenu]);

  const handleSelect = (folder: SmartFolder) => {
    setSelectedId(folder.id);
    setSmartFolderId(folder.id);
    if (activeLibraryId) {
      loadSmartFolderItems(
        activeLibraryId,
        folder.id,
        { field: 'created_at', direction: 'desc' },
        { page: 0, page_size: 100 },
      );
    }
  };

  const handleContextMenu = (e: React.MouseEvent, folder: SmartFolder) => {
    e.preventDefault();
    setContextMenu({ folder, x: e.clientX, y: e.clientY });
  };

  const handleDelete = async () => {
    if (!contextMenu) return;
    const { folder } = contextMenu;
    const ok = window.confirm(`Delete smart folder "${folder.name}"?`);
    if (!ok) return;
    await remove(folder.id);
    if (selectedId === folder.id) {
      setSelectedId(null);
      setSmartFolderId(null);
    }
    setContextMenu(null);
  };

  const handleEdit = () => {
    if (!contextMenu) return;
    onEdit(contextMenu.folder);
    setContextMenu(null);
  };

  // Build tree from flat list
  const topLevel = folders.filter((f) => !f.parent_id);
  const getChildren = (parentId: string): SmartFolder[] =>
    folders.filter((f) => f.parent_id === parentId);

  const renderFolder = (folder: SmartFolder, depth: number = 0) => {
    const children = getChildren(folder.id);
    return (
      <div key={folder.id}>
        <button
          onClick={() => handleSelect(folder)}
          onContextMenu={(e) => handleContextMenu(e, folder)}
          className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
            selectedId === folder.id
              ? 'bg-purple-600/20 text-purple-300'
              : 'hover:bg-neutral-700 text-neutral-300'
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          {folder.name}
        </button>
        {children.map((child) => renderFolder(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="border-t border-neutral-700 pt-2 px-2">
      <div className="flex items-center justify-between mb-1 px-1">
        <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
          Smart Folders
        </span>
      </div>
      {topLevel.length === 0 ? (
        <p className="text-xs text-neutral-600 px-1">None yet</p>
      ) : (
        topLevel.map((folder) => renderFolder(folder))
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed bg-neutral-800 border border-neutral-600 rounded shadow-lg z-50 py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={handleEdit}
            className="block w-full text-left px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            Edit
          </button>
          <button
            onClick={handleDelete}
            className="block w-full text-left px-3 py-1 text-sm text-red-400 hover:bg-neutral-700"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Update Sidebar.tsx to include SmartFolderList**

Modify `src/components/Sidebar/Sidebar.tsx`:

```tsx
import { LibrarySelector } from './LibrarySelector';
import { FolderList } from './FolderList';
import { SmartFolderList } from './SmartFolderList';

export function Sidebar() {
  return (
    <div className="w-56 shrink-0 bg-neutral-800 border-r border-neutral-700 flex flex-col overflow-hidden">
      <LibrarySelector />
      <FolderList />
      <SmartFolderList />
    </div>
  );
}
```

Note: `SmartFolderList` will need an `onEdit` prop wired to the editor later. For now, pass a no-op or leave it to be connected in Task 8. Use `onEdit={() => {}}` as placeholder.

Actually, better approach: lift the editor state to Sidebar or the main layout. For now in Sidebar:

```tsx
import { useState } from 'react';
import type { SmartFolder } from '@/lib/types';

export function Sidebar() {
  const [editingFolder, setEditingFolder] = useState<SmartFolder | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  return (
    <div className="w-56 shrink-0 bg-neutral-800 border-r border-neutral-700 flex flex-col overflow-hidden">
      <LibrarySelector />
      <FolderList />
      <SmartFolderList
        onEdit={(folder) => {
          setEditingFolder(folder);
          setShowEditor(true);
        }}
      />
      {/* SmartFolderEditor will be rendered here or as a portal in Task 8 */}
    </div>
  );
}
```

**Step 3: Run frontend type check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors (the editor component doesn't exist yet but isn't rendered)

**Step 4: Commit**

```bash
git add src/components/Sidebar/SmartFolderList.tsx src/components/Sidebar/Sidebar.tsx
git commit -m "feat: add SmartFolderList sidebar component"
```

---

### Task 8: SmartFolderEditor modal

**Files:**
- Create: `src/components/Sidebar/SmartFolderEditor.tsx`
- Modify: `src/components/Sidebar/Sidebar.tsx` (wire up editor)

**Step 1: Create the editor component**

Create `src/components/Sidebar/SmartFolderEditor.tsx`:

```tsx
import { useState, useEffect } from 'react';
import {
  type SmartFolder,
  type RuleGroup,
  type Condition,
  type FieldType,
  FIELD_KINDS,
  FIELD_LABELS,
  OPERATORS_BY_KIND,
  FILE_TYPE_OPERATORS,
} from '@/lib/types';
import { useSmartFolderStore } from '@/stores/smartFolderStore';

interface SmartFolderEditorProps {
  folder?: SmartFolder | null; // null = create new
  onClose: () => void;
}

const ALL_FIELDS: FieldType[] = [
  'file_name',
  'file_type',
  'file_size',
  'width',
  'height',
  'tags',
  'rating',
  'notes',
  'created_at',
  'modified_at',
];

function getDefaultCondition(): Condition {
  return { field: 'rating', op: 'gte', value: 0 };
}

function getOperatorsForField(field: FieldType) {
  if (field === 'file_type') return FILE_TYPE_OPERATORS;
  return OPERATORS_BY_KIND[FIELD_KINDS[field]];
}

export function SmartFolderEditor({ folder, onClose }: SmartFolderEditorProps) {
  const { create, update } = useSmartFolderStore();
  const [name, setName] = useState(folder?.name ?? '');
  const [operator, setOperator] = useState<'AND' | 'OR'>(
    folder ? (JSON.parse(folder.rules).operator ?? 'AND') : 'AND',
  );
  const [conditions, setConditions] = useState<Condition[]>(
    folder ? (JSON.parse(folder.rules).conditions ?? [getDefaultCondition()]) : [getDefaultCondition()],
  );
  const [saving, setSaving] = useState(false);

  const addCondition = () => {
    setConditions([...conditions, getDefaultCondition()]);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (index: number, patch: Partial<Condition>) => {
    setConditions(
      conditions.map((c, i) => {
        if (i !== index) return c;
        const updated = { ...c, ...patch };
        // Reset value when field changes
        if (patch.field && patch.field !== c.field) {
          updated.value = FIELD_KINDS[patch.field as FieldType] === 'number' ? 0 : '';
        }
        // Reset op when field changes
        if (patch.field && patch.field !== c.field) {
          const ops = getOperatorsForField(patch.field as FieldType);
          if (!ops.some((o) => o.value === updated.op)) {
            updated.op = ops[0].value;
          }
        }
        return updated;
      }),
    );
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const rules: RuleGroup = { operator, conditions };
    try {
      if (folder) {
        await update(folder.id, name.trim(), rules);
      } else {
        await create(name.trim(), rules);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-neutral-800 border border-neutral-600 rounded-lg shadow-xl w-[480px] max-h-[80vh] overflow-y-auto">
        <div className="p-4">
          <h2 className="text-lg font-semibold text-white mb-4">
            {folder ? 'Edit Smart Folder' : 'New Smart Folder'}
          </h2>

          {/* Name */}
          <label className="block text-sm text-neutral-400 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-neutral-700 border border-neutral-600 rounded px-3 py-2 text-sm text-white mb-4"
            placeholder="e.g. Best Photos"
          />

          {/* Match operator */}
          <label className="block text-sm text-neutral-400 mb-1">Match</label>
          <select
            value={operator}
            onChange={(e) => setOperator(e.target.value as 'AND' | 'OR')}
            className="bg-neutral-700 border border-neutral-600 rounded px-3 py-2 text-sm text-white mb-3"
          >
            <option value="AND">ALL conditions</option>
            <option value="OR">ANY condition</option>
          </select>

          {/* Conditions */}
          <div className="space-y-2 mb-3">
            {conditions.map((cond, i) => (
              <ConditionRow
                key={i}
                condition={cond}
                onChange={(patch) => updateCondition(i, patch)}
                onRemove={() => removeCondition(i)}
                showRemove={conditions.length > 1}
              />
            ))}
          </div>

          <button
            onClick={addCondition}
            className="text-sm text-blue-400 hover:text-blue-300 mb-4"
          >
            + Add Condition
          </button>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-neutral-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
  showRemove,
}: {
  condition: Condition;
  onChange: (patch: Partial<Condition>) => void;
  onRemove: () => void;
  showRemove: boolean;
}) {
  const fieldType = condition.field as FieldType;
  const kind = FIELD_KINDS[fieldType] ?? 'text';
  const operators = getOperatorsForField(fieldType);

  return (
    <div className="flex items-center gap-2">
      {/* Field selector */}
      <select
        value={condition.field}
        onChange={(e) => onChange({ field: e.target.value })}
        className="bg-neutral-700 border border-neutral-600 rounded px-2 py-1.5 text-sm text-white"
      >
        {ALL_FIELDS.map((f) => (
          <option key={f} value={f}>
            {FIELD_LABELS[f]}
          </option>
        ))}
      </select>

      {/* Operator selector */}
      <select
        value={condition.op}
        onChange={(e) => onChange({ op: e.target.value })}
        className="bg-neutral-700 border border-neutral-600 rounded px-2 py-1.5 text-sm text-white"
      >
        {operators.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Value input(s) */}
      {condition.op === 'between' ? (
        <div className="flex gap-1">
          <input
            type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
            value={Array.isArray(condition.value) ? condition.value[0] ?? '' : ''}
            onChange={(e) => {
              const arr = Array.isArray(condition.value) ? [...condition.value] : ['', ''];
              arr[0] = kind === 'number' ? Number(e.target.value) : e.target.value;
              onChange({ value: arr });
            }}
            className="w-20 bg-neutral-700 border border-neutral-600 rounded px-2 py-1.5 text-sm text-white"
          />
          <span className="text-neutral-500 self-center">~</span>
          <input
            type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
            value={Array.isArray(condition.value) ? condition.value[1] ?? '' : ''}
            onChange={(e) => {
              const arr = Array.isArray(condition.value) ? [...condition.value] : ['', ''];
              arr[1] = kind === 'number' ? Number(e.target.value) : e.target.value;
              onChange({ value: arr });
            }}
            className="w-20 bg-neutral-700 border border-neutral-600 rounded px-2 py-1.5 text-sm text-white"
          />
        </div>
      ) : condition.op === 'in' || condition.op === 'not_in' ? (
        <input
          type="text"
          value={Array.isArray(condition.value) ? condition.value.join(', ') : ''}
          onChange={(e) => {
            const vals = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
            onChange({ value: vals });
          }}
          placeholder="JPG, PNG, ..."
          className="flex-1 bg-neutral-700 border border-neutral-600 rounded px-2 py-1.5 text-sm text-white"
        />
      ) : (
        <input
          type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
          value={condition.value as string | number}
          onChange={(e) =>
            onChange({
              value: kind === 'number' ? Number(e.target.value) : e.target.value,
            })
          }
          className="flex-1 bg-neutral-700 border border-neutral-600 rounded px-2 py-1.5 text-sm text-white"
        />
      )}

      {/* Remove button */}
      {showRemove && (
        <button
          onClick={onRemove}
          className="text-neutral-500 hover:text-red-400 text-sm"
        >
          x
        </button>
      )}
    </div>
  );
}
```

**Step 2: Wire up editor in Sidebar.tsx**

Update `src/components/Sidebar/Sidebar.tsx`:

```tsx
import { useState } from 'react';
import { LibrarySelector } from './LibrarySelector';
import { FolderList } from './FolderList';
import { SmartFolderList } from './SmartFolderList';
import { SmartFolderEditor } from './SmartFolderEditor';
import type { SmartFolder } from '@/lib/types';

export function Sidebar() {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<SmartFolder | null>(null);

  const handleEdit = (folder: SmartFolder) => {
    setEditingFolder(folder);
    setEditorOpen(true);
  };

  const handleCreate = () => {
    setEditingFolder(null);
    setEditorOpen(true);
  };

  return (
    <div className="w-56 shrink-0 bg-neutral-800 border-r border-neutral-700 flex flex-col overflow-hidden">
      <LibrarySelector />
      <FolderList />
      <SmartFolderList onEdit={handleEdit} onCreate={handleCreate} />
      {editorOpen && (
        <SmartFolderEditor
          folder={editingFolder}
          onClose={() => {
            setEditorOpen(false);
            setEditingFolder(null);
          }}
        />
      )}
    </div>
  );
}
```

Update `SmartFolderList` props to accept `onCreate` and add the `[+]` button:

In `SmartFolderList.tsx`, update the interface:
```tsx
interface SmartFolderListProps {
  onEdit: (folder: SmartFolder) => void;
  onCreate: () => void;
}
```

And update the component signature and the header to include the create button:
```tsx
export function SmartFolderList({ onEdit, onCreate }: SmartFolderListProps) {
```

In the header div, add the button:
```tsx
<div className="flex items-center justify-between mb-1 px-1">
  <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
    Smart Folders
  </span>
  <button
    onClick={onCreate}
    className="text-neutral-500 hover:text-neutral-300 text-xs"
    title="New Smart Folder"
  >
    +
  </button>
</div>
```

**Step 3: Run frontend type check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add src/components/Sidebar/SmartFolderEditor.tsx src/components/Sidebar/SmartFolderList.tsx src/components/Sidebar/Sidebar.tsx
git commit -m "feat: add SmartFolderEditor modal and wire up sidebar"
```

---

### Task 9: Integration — make FolderList and SmartFolderList selection mutually exclusive

**Files:**
- Modify: `src/components/Sidebar/FolderList.tsx`
- Modify: `src/components/Sidebar/SmartFolderList.tsx`

**Step 1: Clear smart folder selection when clicking a regular folder**

In `FolderList.tsx`, import `useFilterStore` and `useSmartFolderStore`:

```tsx
import { useFilterStore } from '@/stores/filterStore';
import { useSmartFolderStore } from '@/stores/smartFolderStore';
```

In the component, add:
```tsx
const setSmartFolderId = useFilterStore((s) => s.setSmartFolderId);
const setSelectedSmartFolder = useSmartFolderStore((s) => s.setSelectedId);
```

In `handleSelectFolder`, add clearing the smart folder selection:
```tsx
const handleSelectFolder = (folderId: string | null) => {
    setSelectedFolder(folderId);
    setSmartFolderId(null);
    setSelectedSmartFolder(null);
    // ... rest unchanged
};
```

**Step 2: Clear folder selection when clicking a smart folder**

This is already handled in `SmartFolderList.tsx` via `setSmartFolderId`, but we should also clear `FolderList`'s local `selectedFolder` state. The cleanest approach: lift the selectedFolder state out of FolderList into the filterStore, or use a shared callback.

Simpler approach: in `SmartFolderList.tsx`, when selecting a smart folder, also call a prop to clear the folder selection. Add an `onSelect` prop to FolderList from Sidebar, or use filterStore.

Actually, the simplest fix: In `FolderList.tsx`, listen to `filterStore.smartFolderId` and reset `selectedFolder` when it changes:

```tsx
const smartFolderId = useFilterStore((s) => s.smartFolderId);

useEffect(() => {
  if (smartFolderId) {
    setSelectedFolder(null);
  }
}, [smartFolderId]);
```

**Step 3: Run frontend type check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add src/components/Sidebar/FolderList.tsx src/components/Sidebar/SmartFolderList.tsx
git commit -m "feat: make folder and smart folder selection mutually exclusive"
```

---

### Task 10: End-to-end smoke test

**Step 1: Run full Rust test suite**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass

**Step 2: Run frontend type check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

**Step 3: Start dev server and manual test**

Run: `pnpm tauri dev`

Manual test checklist:
- [ ] Sidebar shows "Smart Folders" section with `[+]` button
- [ ] Click `[+]` opens the editor modal
- [ ] Create a smart folder with a rating >= 3 rule
- [ ] Smart folder appears in sidebar
- [ ] Click smart folder → grid shows matching items
- [ ] Click regular folder → smart folder selection clears
- [ ] Right-click smart folder → context menu with Edit/Delete
- [ ] Edit smart folder → change name/rules
- [ ] Delete smart folder → removed from list

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete smart folders feature"
```
