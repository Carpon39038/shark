export interface Library {
  id: string;
  name: string;
  path: string;
  created_at: string;
}

export interface Item {
  id: string;
  file_path: string;
  file_name: string;
  file_size: number;
  file_type: string;
  width: number | null;
  height: number | null;
  tags: string;
  rating: number;
  notes: string;
  sha256: string;
  status: 'active' | 'deleted' | 'corrupted';
  created_at: string;
  modified_at: string;
}

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
}

export interface ItemFilter {
  folder_id?: string | null;
  file_types?: string[] | null;
  rating_min?: number | null;
  search_query?: string | null;
  tag?: string | null;
}

export interface SortSpec {
  field: string;
  direction: 'asc' | 'desc';
}

export interface Pagination {
  page: number;
  page_size: number;
}

export interface ItemPage {
  items: Item[];
  total: number;
  page: number;
  page_size: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
}

export interface ExistingItemInfo {
  id: string;
  filename: string;
  path: string;
  fileSize: number;
  thumbnailPath: string | null;
}

export interface NewFileInfo {
  sourcePath: string;
  filename: string;
  fileSize: number;
}

export interface DuplicateInfo {
  existing: ExistingItemInfo;
  newFile: NewFileInfo;
}

export interface ImportPrepResult {
  duplicates: DuplicateInfo[];
  totalPrepared: number;
}

export type DedupAction = 'skip' | 'keepBoth';

export type ThumbnailSize = 'S256' | 'S1024';

export interface TagCount {
  tag: string;
  count: number;
}

export interface SearchResult {
  item: Item;
  rank: number;
}

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
