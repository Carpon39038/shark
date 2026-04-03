use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub file_path: String,
    pub file_name: String,
    pub file_size: i64,
    pub file_type: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub tags: String,
    pub rating: i64,
    pub notes: String,
    pub sha256: String,
    pub status: String,
    pub created_at: String,
    pub modified_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ItemFilter {
    pub folder_id: Option<String>,
    pub file_types: Option<Vec<String>>,
    pub rating_min: Option<i64>,
    pub search_query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortSpec {
    pub field: String,
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pagination {
    pub page: i64,
    pub page_size: i64,
}

impl Pagination {
    pub fn offset(&self) -> i64 {
        self.page * self.page_size
    }

    pub fn limit(&self) -> i64 {
        self.page_size
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemPage {
    pub items: Vec<Item>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ImportResult {
    pub imported: i64,
    pub skipped: i64,
    pub duplicates: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ThumbnailSize {
    S256,
    S1024,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub item: Item,
    pub rank: f64,
}
