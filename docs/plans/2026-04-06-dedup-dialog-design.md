# Dedup Dialog Design

## Overview

Import-time deduplication dialog. When SHA256 duplicates are detected during folder import, pause the import and show a modal dialog for the user to decide how to handle each duplicate pair.

## Requirements

- **Trigger**: Real-time during import when duplicates found
- **Options**: Skip (discard new) / Keep Both, plus "Apply to all remaining" checkbox
- **Preview**: Thumbnails + filename + path + file size for both existing and new file
- **UI**: Centered modal dialog, consistent with existing modal patterns

## Data Flow

```
PREPARING → FOUND_DUPLICATES → RESOLVING → IMPORTING → DONE
```

1. Import prep phase detects duplicates via SHA256
2. Backend pauses and sends duplicate info to frontend
3. Frontend shows DedupDialog modal
4. User decides skip/keep for each pair (or applies to all)
5. Backend receives decisions, continues import

## Backend Changes

### New Type: `DuplicateInfo`

```rust
pub struct DuplicateInfo {
    pub existing_item: ExistingItemInfo,
    pub new_file: NewFileInfo,
}

pub struct ExistingItemInfo {
    pub id: String,
    pub filename: String,
    pub path: String,
    pub file_size: i64,
    pub thumbnail_path: String,
}

pub struct NewFileInfo {
    pub filename: String,
    pub path: String,
    pub file_size: i64,
    pub temp_thumbnail_path: String, // generated during prep
}
```

### Modified Command: `import_folder`

- Instead of silently skipping duplicates, collect `DuplicateInfo` list
- Return duplicates to frontend, pause import state
- Wait for `resolve_duplicates` call

### New Command: `resolve_duplicates`

```rust
#[tauri::command]
pub async fn resolve_duplicates(
    library_id: String,
    decisions: Vec<DedupDecision>, // (file_path, action)
    import_id: String,
) -> Result<ImportResult, AppError>

pub enum DedupAction {
    Skip,
    KeepBoth,
}
```

## Frontend Components

### DedupDialog

```
┌─────────────────────────────────────────────┐
│         发现重复文件 (3/25)                   │
│                                             │
│  ┌──────────────┐    ┌──────────────┐       │
│  │  已有文件     │    │  新文件       │       │
│  │  [缩略图]    │ VS │  [缩略图]    │       │
│  │  photo.jpg   │    │  photo.jpg   │       │
│  │  /folder/a/  │    │  /folder/b/  │       │
│  │  2.4 MB      │    │  2.4 MB      │       │
│  └──────────────┘    └──────────────┘       │
│                                             │
│  ☐ 应用于所有剩余重复 (22)                   │
│                                             │
│  [ 跳过 ]              [ 保留两者 ]          │
└─────────────────────────────────────────────┘
```

### Store Changes (uiStore)

```typescript
dedupState: 'idle' | 'active' | 'resolved';
dedupItems: DuplicateInfo[];
dedupCurrentIndex: number;
dedupApplyAll: boolean;
dedupApplyAllAction: 'skip' | 'keep' | null;
```

### TypeScript Types

```typescript
interface DuplicateInfo {
  existingItem: {
    id: string;
    filename: string;
    path: string;
    fileSize: number;
    thumbnailPath: string;
  };
  newFile: {
    filename: string;
    path: string;
    fileSize: number;
    tempThumbnailPath: string;
  };
}

type DedupAction = 'skip' | 'keepBoth';
```

## Interaction Details

1. Show one duplicate pair at a time with counter (e.g. 3/25)
2. "Skip" moves to next pair; "Keep Both" marks new file for import
3. "Apply to all" checkbox: when checked, current action auto-applies to all remaining pairs
4. Dialog close = skip all remaining duplicates
5. After all decisions made, dialog closes and import continues

## Error Handling

- **0 duplicates**: No dialog, normal import
- **All duplicates**: After resolving all, import ends immediately
- **Same content, different filename**: Only SHA256 compared; dialog shows both paths clearly
- **Backend state lost**: Dialog closes, import falls back to silent skip
- **Cancel import during dedup**: Equivalent to "skip all"

## Files to Modify

### Backend
- `src-tauri/src/commands.rs` — modify `import_folder`, add `resolve_duplicates`
- `src-tauri/src/indexer.rs` — collect duplicate info instead of silently skipping
- `src-tauri/src/models.rs` — add `DuplicateInfo`, `DedupAction` types

### Frontend
- `src/components/Import/DedupDialog.tsx` — new component
- `src/stores/uiStore.ts` — add dedup state fields
- `src/components/Import/ImportProgress.tsx` — integrate dedup trigger
- `src/lib/types.ts` — add dedup TypeScript types
