use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ItemStatus {
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "deleted")]
    Deleted,
    #[serde(rename = "corrupted")]
    Corrupted,
}

impl Default for ItemStatus {
    fn default() -> Self {
        Self::Active
    }
}

impl ItemStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Deleted => "deleted",
            Self::Corrupted => "corrupted",
        }
    }
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
    pub status: ItemStatus,
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
pub enum SortDirection {
    #[serde(rename = "asc")]
    Asc,
    #[serde(rename = "desc")]
    Desc,
}

impl Default for SortDirection {
    fn default() -> Self {
        Self::Desc
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortSpec {
    pub field: String,
    pub direction: SortDirection,
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
pub struct ExistingItemInfo {
    pub id: String,
    pub filename: String,
    pub path: String,
    pub file_size: i64,
    pub thumbnail_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewFileInfo {
    pub source_path: String,
    pub filename: String,
    pub file_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateInfo {
    pub existing: ExistingItemInfo,
    pub new_file: NewFileInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPrepResult {
    pub duplicates: Vec<DuplicateInfo>,
    pub total_prepared: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DedupAction {
    Skip,
    KeepBoth,
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
