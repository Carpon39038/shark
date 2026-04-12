use rusqlite::{params, Connection, Row};
use std::path::Path;

use crate::error::AppError;
use crate::models::{Folder, Item, ItemFilter, ItemPage, ItemStatus, Library, Pagination, RuleGroup, SmartFolder, SortDirection, SortSpec, TagCount};

pub fn row_to_item(row: &Row) -> Result<Item, rusqlite::Error> {
    let status_str: String = row.get(11)?;
    let status = match status_str.as_str() {
        "active" => ItemStatus::Active,
        "deleted" => ItemStatus::Deleted,
        "corrupted" => ItemStatus::Corrupted,
        _ => ItemStatus::Active,
    };
    Ok(Item {
        id: row.get(0)?,
        file_path: row.get(1)?,
        file_name: row.get(2)?,
        file_size: row.get(3)?,
        file_type: row.get(4)?,
        width: row.get(5)?,
        height: row.get(6)?,
        tags: row.get(7)?,
        rating: row.get(8)?,
        notes: row.get(9)?,
        sha256: row.get(10)?,
        status,
        created_at: row.get(12)?,
        modified_at: row.get(13)?,
    })
}

const ITEM_COLUMNS: &str = "id, file_path, file_name, file_size, file_type, width, height, tags, rating, notes, sha256, status, created_at, modified_at";

struct FilterParams {
    where_sql: String,
    param_values: Vec<Box<dyn rusqlite::types::ToSql>>,
}

fn build_filter_params(filter: &ItemFilter) -> FilterParams {
    let mut where_clauses = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref folder_id) = filter.folder_id {
        where_clauses.push(format!(
            "id IN (SELECT item_id FROM item_folders WHERE folder_id = ?{})",
            param_values.len() + 1
        ));
        param_values.push(Box::new(folder_id.clone()));
    }

    if let Some(ref file_types) = filter.file_types {
        if !file_types.is_empty() {
            let placeholders: Vec<String> = (0..file_types.len())
                .map(|i| format!("?{}", param_values.len() + i + 1))
                .collect();
            where_clauses.push(format!("file_type IN ({})", placeholders.join(", ")));
            for ft in file_types {
                param_values.push(Box::new(ft.clone()));
            }
        }
    }

    if let Some(rating_min) = filter.rating_min {
        where_clauses.push(format!("rating >= ?{}", param_values.len() + 1));
        param_values.push(Box::new(rating_min));
    }

    if let Some(ref tag) = filter.tag {
        if !tag.is_empty() {
            where_clauses.push(format!("(',' || tags || ',') LIKE ?{}", param_values.len() + 1));
            param_values.push(Box::new(format!("%,{tag},%")));
        }
    }

    where_clauses.push("status = 'active'".to_string());

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    FilterParams { where_sql, param_values }
}

pub struct DbState {
    pub registry: std::sync::Mutex<Connection>,
    pub library: std::sync::Mutex<Option<Connection>>,
}

impl DbState {
    pub fn new(registry_path: &Path) -> Result<Self, AppError> {
        let conn = init_registry_db(registry_path)?;
        Ok(Self {
            registry: std::sync::Mutex::new(conn),
            library: std::sync::Mutex::new(None),
        })
    }
}

fn apply_pragmas(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;")?;
    Ok(())
}

// --- Registry DB ---

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
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )?;
        conn.pragma_update(None, "user_version", 1)?;
    }
    Ok(())
}

pub fn create_library(conn: &Connection, name: &str, path: &str) -> Result<Library, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();

    // Create directory structure
    let lib_dir = Path::new(path);
    std::fs::create_dir_all(lib_dir.join("images"))?;
    std::fs::create_dir_all(lib_dir.join(".shark"))?;

    // Create per-library DB
    let db_path = lib_dir.join(".shark").join("metadata.db");
    let lib_conn = init_library_db(&db_path)?;
    drop(lib_conn);

    conn.execute(
        "INSERT INTO libraries (id, name, path, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, path, created_at],
    )?;

    Ok(Library {
        id,
        name: name.to_string(),
        path: path.to_string(),
        created_at,
    })
}

pub fn get_library(conn: &Connection, id: &str) -> Result<Library, AppError> {
    conn.query_row(
        "SELECT id, name, path, created_at FROM libraries WHERE id = ?1",
        params![id],
        |row| {
            Ok(Library {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
    .map_err(|e| AppError::NotFound(format!("Library {id}: {e}")))
}

pub fn get_library_by_path(conn: &Connection, path: &str) -> Result<Library, AppError> {
    conn.query_row(
        "SELECT id, name, path, created_at FROM libraries WHERE path = ?1",
        params![path],
        |row| {
            Ok(Library {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
    .map_err(|e| AppError::NotFound(format!("Library at {path}: {e}")))
}

pub fn list_libraries(conn: &Connection) -> Result<Vec<Library>, AppError> {
    let mut stmt = conn.prepare("SELECT id, name, path, created_at FROM libraries ORDER BY name")?;
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

// --- Library DB ---

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
            "CREATE TABLE items (
                id TEXT PRIMARY KEY,
                file_path TEXT NOT NULL UNIQUE,
                file_name TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                file_type TEXT NOT NULL,
                width INTEGER,
                height INTEGER,
                tags TEXT NOT NULL DEFAULT '',
                rating INTEGER NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                sha256 TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                modified_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX idx_items_file_type ON items(file_type);
            CREATE INDEX idx_items_rating ON items(rating);
            CREATE INDEX idx_items_created_at ON items(created_at);
            CREATE INDEX idx_items_sha256 ON items(sha256);

            CREATE TABLE folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
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
                sort_order INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (parent_id) REFERENCES smart_folders(id) ON DELETE CASCADE
            );

            CREATE TABLE thumbnails (
                item_id TEXT PRIMARY KEY,
                thumb_256_path TEXT,
                thumb_1024_path TEXT,
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
            END;",
        )?;
        conn.pragma_update(None, "user_version", 1)?;
    }
    Ok(())
}

pub fn insert_item(conn: &Connection, item: &Item) -> Result<(), AppError> {
    let status_str = item.status.as_str();
    conn.execute(
        "INSERT INTO items (id, file_path, file_name, file_size, file_type, width, height, tags, rating, notes, sha256, status, created_at, modified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            item.id, item.file_path, item.file_name, item.file_size,
            item.file_type, item.width, item.height, item.tags,
            item.rating, item.notes, item.sha256, status_str,
            item.created_at, item.modified_at
        ],
    )?;
    Ok(())
}

pub fn get_item(conn: &Connection, id: &str) -> Result<Item, AppError> {
    conn.query_row(
        &format!("SELECT {ITEM_COLUMNS} FROM items WHERE id = ?1"),
        params![id],
        row_to_item,
    )
    .map_err(|e| AppError::NotFound(format!("Item {id}: {e}")))
}

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

pub fn query_items(
    conn: &Connection,
    filter: &ItemFilter,
    sort: &SortSpec,
    pagination: &Pagination,
) -> Result<ItemPage, AppError> {
    let mut fp = build_filter_params(filter);

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

    let params_refs: Vec<&dyn rusqlite::types::ToSql> = fp.param_values.iter().map(|p| p.as_ref()).collect();

    let count_sql = format!("SELECT COUNT(*) FROM items {}", fp.where_sql);
    let total: i64 = conn.query_row(&count_sql, params_refs.as_slice(), |row| row.get(0))?;

    // Append limit/offset params onto filter params
    let limit_idx = fp.param_values.len() + 1;
    let offset_idx = fp.param_values.len() + 2;
    fp.param_values.push(Box::new(pagination.limit()));
    fp.param_values.push(Box::new(pagination.offset()));
    let query_refs: Vec<&dyn rusqlite::types::ToSql> = fp.param_values.iter().map(|p| p.as_ref()).collect();

    let query_sql = format!(
        "SELECT {ITEM_COLUMNS} FROM items {} ORDER BY {} {} LIMIT ?{} OFFSET ?{}",
        fp.where_sql, sort_field, sort_dir, limit_idx, offset_idx
    );

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

pub fn delete_items(conn: &Connection, ids: &[String], permanent: bool) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }

    let tx = conn.unchecked_transaction()?;
    if permanent {
        let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{i}")).collect();
        let sql = format!("DELETE FROM items WHERE id IN ({})", placeholders.join(", "));
        let params: Vec<&dyn rusqlite::types::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();
        tx.execute(&sql, params.as_slice())?;
    } else {
        let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "UPDATE items SET status = 'deleted', modified_at = datetime('now') WHERE id IN ({})",
            placeholders.join(", ")
        );
        let params: Vec<&dyn rusqlite::types::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();
        tx.execute(&sql, params.as_slice())?;
    }
    tx.commit()?;
    Ok(())
}

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

pub fn get_all_tags(conn: &Connection) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare("SELECT DISTINCT tags FROM items WHERE tags != '' AND status = 'active'")?;
    let rows = stmt.query_map([], |row| {
        let tags: String = row.get(0)?;
        Ok(tags)
    })?;

    let mut tag_set = std::collections::HashSet::new();
    for row in rows {
        let tags_str = row?;
        for tag in tags_str.split(',') {
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

pub fn batch_sha256_exists(
    conn: &Connection,
    hashes: &[&str],
) -> Result<std::collections::HashSet<String>, AppError> {
    if hashes.is_empty() {
        return Ok(std::collections::HashSet::new());
    }
    let placeholders: Vec<String> = (1..=hashes.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "SELECT sha256 FROM items WHERE sha256 IN ({})",
        placeholders.join(", ")
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = hashes
        .iter()
        .map(|h| h as &dyn rusqlite::types::ToSql)
        .collect();
    let mut stmt = conn.prepare(&sql)?;
    let existing: std::collections::HashSet<String> = stmt
        .query_map(params.as_slice(), |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(existing)
}

pub fn get_items_by_sha256(
    conn: &Connection,
    hashes: &[&str],
) -> Result<Vec<Item>, AppError> {
    if hashes.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders: Vec<String> = (1..=hashes.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "SELECT {ITEM_COLUMNS} FROM items WHERE sha256 IN ({})",
        placeholders.join(", ")
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = hashes
        .iter()
        .map(|h| h as &dyn rusqlite::types::ToSql)
        .collect();
    let mut stmt = conn.prepare(&sql)?;
    let items = stmt
        .query_map(params.as_slice(), row_to_item)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

pub fn insert_thumbnail(
    conn: &Connection,
    item_id: &str,
    thumb_256_path: Option<&str>,
    thumb_1024_path: Option<&str>,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR REPLACE INTO thumbnails (item_id, thumb_256_path, thumb_1024_path) VALUES (?1, ?2, ?3)",
        params![item_id, thumb_256_path, thumb_1024_path],
    )?;
    Ok(())
}

pub fn get_thumbnail_path(
    conn: &Connection,
    item_id: &str,
    size: &str,
) -> Result<Option<String>, AppError> {
    let column = match size {
        "256" => "thumb_256_path",
        "1024" => "thumb_1024_path",
        _ => return Err(AppError::Database(format!("Invalid thumbnail size: {size}"))),
    };
    let sql = format!(
        "SELECT {} FROM thumbnails WHERE item_id = ?1",
        column
    );
    let result: Option<String> = conn
        .query_row(&sql, params![item_id], |row| row.get(0))
        .ok();
    Ok(result)
}

// --- Tests ---

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_item(id: &str, suffix: &str) -> Item {
        Item {
            id: id.to_string(),
            file_path: format!("/lib/images/test{suffix}.png"),
            file_name: format!("test{suffix}.png"),
            file_size: 1024,
            file_type: "PNG".to_string(),
            width: Some(100),
            height: Some(100),
            tags: String::new(),
            rating: 0,
            notes: String::new(),
            sha256: format!("hash{suffix}"),
            status: ItemStatus::Active,
            created_at: "2026-04-02T12:00:00".to_string(),
            modified_at: "2026-04-02T12:00:00".to_string(),
        }
    }

    #[test]
    fn test_schema_creation() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert!(tables.contains(&"items".to_string()));
        assert!(tables.contains(&"folders".to_string()));
        assert!(tables.contains(&"thumbnails".to_string()));
    }

    #[test]
    fn test_migration_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("metadata.db");
        let _ = init_library_db(&db_path).unwrap();
        let _ = init_library_db(&db_path).unwrap(); // run again
    }

    #[test]
    fn test_insert_and_query_item() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let item = make_test_item("id-1", "1");
        insert_item(&conn, &item).unwrap();

        let fetched = get_item(&conn, "id-1").unwrap();
        assert_eq!(fetched.file_name, "test1.png");
        assert_eq!(fetched.file_size, 1024);
    }

    #[test]
    fn test_query_items_with_sort_and_pagination() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        for i in 1..=5 {
            let item = make_test_item(&format!("id-{i}"), &i.to_string());
            insert_item(&conn, &item).unwrap();
        }

        let page = query_items(
            &conn,
            &ItemFilter::default(),
            &SortSpec {
                field: "file_name".to_string(),
                direction: SortDirection::Asc,
            },
            &Pagination {
                page: 0,
                page_size: 3,
            },
        )
        .unwrap();

        assert_eq!(page.items.len(), 3);
        assert_eq!(page.total, 5);
        assert_eq!(page.page, 0);
    }

    #[test]
    fn test_delete_items_soft_and_hard() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let item = make_test_item("id-del", "del");
        insert_item(&conn, &item).unwrap();

        delete_items(&conn, &["id-del".to_string()], false).unwrap();
        let fetched = get_item(&conn, "id-del").unwrap();
        assert_eq!(fetched.status.as_str(), "deleted");

        delete_items(&conn, &["id-del".to_string()], true).unwrap();
        assert!(get_item(&conn, "id-del").is_err());
    }

    #[test]
    fn test_registry_crud() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("registry.db");
        let conn = init_registry_db(&db_path).unwrap();

        let lib = create_library(&conn, "Test", "/tmp/test-lib").unwrap();
        assert_eq!(lib.name, "Test");

        let libs = list_libraries(&conn).unwrap();
        assert_eq!(libs.len(), 1);

        let fetched = get_library(&conn, &lib.id).unwrap();
        assert_eq!(fetched.name, "Test");
    }

    #[test]
    fn test_get_all_tags() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let mut item1 = make_test_item("id-1", "1");
        item1.tags = "landscape,nature".to_string();
        insert_item(&conn, &item1).unwrap();

        let mut item2 = make_test_item("id-2", "2");
        item2.tags = "portrait,nature".to_string();
        insert_item(&conn, &item2).unwrap();

        let tags = get_all_tags(&conn).unwrap();
        assert_eq!(tags, vec!["landscape", "nature", "portrait"]);
    }

    #[test]
    fn test_foreign_keys_enforced() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("metadata.db");
        let conn = init_library_db(&db_path).unwrap();

        let result = conn.execute(
            "INSERT INTO item_folders (item_id, folder_id) VALUES ('no-item', 'no-folder')",
            [],
        );
        assert!(result.is_err());
    }

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

        // Verify persisted
        let fetched = get_item(&conn, "id-1").unwrap();
        assert_eq!(fetched.tags, "landscape,nature");
        assert_eq!(fetched.rating, 5);
        assert_eq!(fetched.notes, "great photo");
    }

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
}
