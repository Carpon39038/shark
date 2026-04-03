use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::models::{Item, SearchResult};

pub fn search_items(
    conn: &Connection,
    query: &str,
    limit: i64,
) -> Result<Vec<SearchResult>, AppError> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    // Sanitize: remove FTS5 special characters
    let sanitized: String = query
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '_' || c == '-' {
                c
            } else {
                ' '
            }
        })
        .collect();

    // Phase 1: OR semantics — each token gets a prefix wildcard
    let tokens: Vec<&str> = sanitized.split_whitespace().collect();
    if tokens.is_empty() {
        return Ok(Vec::new());
    }

    let fts_query: String = tokens
        .iter()
        .map(|t| format!("{}*", t))
        .collect::<Vec<_>>()
        .join(" OR ");

    let sql = "
        SELECT i.id, i.file_path, i.file_name, i.file_size, i.file_type,
               i.width, i.height, i.tags, i.rating, i.notes, i.sha256,
               i.status, i.created_at, i.modified_at, f.rank
        FROM items_fts f
        JOIN items i ON i.rowid = f.rowid
        WHERE items_fts MATCH ?1 AND i.status = 'active'
        ORDER BY f.rank
        LIMIT ?2
    ";

    let mut stmt = conn.prepare(sql)?;
    let results = stmt
        .query_map(params![fts_query, limit], |row| {
            Ok(SearchResult {
                item: Item {
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
                    status: row.get(11)?,
                    created_at: row.get(12)?,
                    modified_at: row.get(13)?,
                },
                rank: row.get(14)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{init_library_db, insert_item};

    fn make_test_item(id: &str, name: &str, tags: &str) -> Item {
        Item {
            id: id.to_string(),
            file_path: format!("/lib/{name}"),
            file_name: name.to_string(),
            file_size: 1024,
            file_type: "JPG".to_string(),
            width: Some(100),
            height: Some(100),
            tags: tags.to_string(),
            rating: 0,
            notes: String::new(),
            sha256: format!("hash-{id}"),
            status: "active".to_string(),
            created_at: "2026-04-02T12:00:00".to_string(),
            modified_at: "2026-04-02T12:00:00".to_string(),
        }
    }

    #[test]
    fn test_basic_search() {
        let dir = tempfile::tempdir().unwrap();
        let conn = init_library_db(&dir.path().join("meta.db")).unwrap();

        insert_item(&conn, &make_test_item("1", "sunset_beach.jpg", "")).unwrap();
        insert_item(&conn, &make_test_item("2", "mountain_snow.png", "")).unwrap();

        let results = search_items(&conn, "sunset", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].item.file_name.contains("sunset"));
    }

    #[test]
    fn test_tag_search() {
        let dir = tempfile::tempdir().unwrap();
        let conn = init_library_db(&dir.path().join("meta.db")).unwrap();

        insert_item(&conn, &make_test_item("1", "photo1.jpg", "landscape,nature")).unwrap();
        insert_item(&conn, &make_test_item("2", "photo2.jpg", "portrait")).unwrap();

        let results = search_items(&conn, "nature", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "1");
    }

    #[test]
    fn test_empty_query() {
        let dir = tempfile::tempdir().unwrap();
        let conn = init_library_db(&dir.path().join("meta.db")).unwrap();

        let results = search_items(&conn, "", 10).unwrap();
        assert!(results.is_empty());

        let results = search_items(&conn, "   ", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_no_results() {
        let dir = tempfile::tempdir().unwrap();
        let conn = init_library_db(&dir.path().join("meta.db")).unwrap();
        insert_item(&conn, &make_test_item("1", "photo.jpg", "")).unwrap();

        let results = search_items(&conn, "xyznonexistent", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_multi_token_or() {
        let dir = tempfile::tempdir().unwrap();
        let conn = init_library_db(&dir.path().join("meta.db")).unwrap();

        insert_item(&conn, &make_test_item("1", "sunset_beach.jpg", "")).unwrap();
        insert_item(&conn, &make_test_item("2", "mountain_snow.png", "")).unwrap();

        // "sunset mountain" → OR → matches both
        let results = search_items(&conn, "sunset mountain", 10).unwrap();
        assert_eq!(results.len(), 2);
    }
}
