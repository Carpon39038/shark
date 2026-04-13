# Regular Folders Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement CRUD for manual folders + item assignment + drag-and-drop in sidebar + "Add to Folder" in grid context menu.

**Architecture:** Store-driven — new `folderStore` (parallel to `smartFolderStore`) manages folder state. Backend adds 7 IPC commands to `db.rs` + `commands.rs`. Frontend rewrites `FolderList.tsx` with tree view, context menu, drag-and-drop, and item counts. Grid context menu gets an "Add to Folder" submenu.

**Tech Stack:** Rust/rusqlite (backend), React/Zustand/Tailwind (frontend), HTML5 Drag & Drop API

---

## Task 1: Add FolderCount model

**Files:**
- Modify: `src-tauri/src/models.rs:195` (append after `TagCount`)

**Step 1: Add FolderCount struct**

Append to `src-tauri/src/models.rs` after `TagCount`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderCount {
    pub folder_id: String,
    pub count: i64,
}
```

**Step 2: Verify compilation**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors

**Step 3: Commit**

```bash
git add src-tauri/src/models.rs
git commit -m "feat: add FolderCount model for folder item counts"
```

---

## Task 2: Add db.rs functions for folder CRUD + item association

**Files:**
- Modify: `src-tauri/src/db.rs:466` (append after `get_folders` function)
- Modify: `src-tauri/src/db.rs:1` (import `FolderCount` from models)

**Step 1: Update the import line at top of db.rs**

At `src-tauri/src/db.rs:5`, change the models import to include `FolderCount`:

```rust
use crate::models::{Folder, FolderCount, Item, ItemFilter, ItemPage, ItemStatus, Library, Pagination, RuleGroup, SmartFolder, SortDirection, SortSpec, TagCount};
```

**Step 2: Add folder database functions after `get_folders`**

Append these functions after the `get_folders` function (after line 466):

```rust
pub fn create_folder(conn: &Connection, name: &str, parent_id: Option<&str>) -> Result<Folder, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    // Get next sort_order for this parent level
    let max_order: i64 = match parent_id {
        Some(pid) => conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM folders WHERE parent_id = ?1",
            [pid],
            |row| row.get(0),
        ).unwrap_or(-1),
        None => conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM folders WHERE parent_id IS NULL",
            [],
            |row| row.get(0),
        ).unwrap_or(-1),
    };
    conn.execute(
        "INSERT INTO folders (id, name, parent_id, sort_order) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, name, parent_id, max_order + 1],
    )?;
    Ok(Folder {
        id,
        name: name.to_string(),
        parent_id: parent_id.map(String::from),
        sort_order: max_order + 1,
    })
}

pub fn rename_folder(conn: &Connection, id: &str, name: &str) -> Result<Folder, AppError> {
    conn.execute("UPDATE folders SET name = ?1 WHERE id = ?2", rusqlite::params![name, id])?;
    let mut stmt = conn.prepare("SELECT id, name, parent_id, sort_order FROM folders WHERE id = ?1")?;
    let folder = stmt.query_row([id], |row| {
        Ok(Folder {
            id: row.get(0)?,
            name: row.get(1)?,
            parent_id: row.get(2)?,
            sort_order: row.get(3)?,
        })
    })?;
    Ok(folder)
}

pub fn delete_folder(conn: &Connection, id: &str) -> Result<(), AppError> {
    // CASCADE handles children and item_folders automatically
    conn.execute("DELETE FROM folders WHERE id = ?1", [id])?;
    Ok(())
}

pub fn move_folder(conn: &Connection, id: &str, parent_id: Option<&str>, sort_order: Option<i64>) -> Result<(), AppError> {
    match (parent_id, sort_order) {
        (Some(pid), Some(order)) => {
            conn.execute(
                "UPDATE folders SET parent_id = ?1, sort_order = ?2 WHERE id = ?3",
                rusqlite::params![pid, order, id],
            )?;
        }
        (Some(pid), None) => {
            conn.execute(
                "UPDATE folders SET parent_id = ?1 WHERE id = ?2",
                rusqlite::params![pid, id],
            )?;
        }
        (None, Some(order)) => {
            conn.execute(
                "UPDATE folders SET sort_order = ?1 WHERE id = ?2",
                rusqlite::params![order, id],
            )?;
        }
        (None, None) => {}
    }
    Ok(())
}

pub fn get_folder_item_counts(conn: &Connection) -> Result<Vec<FolderCount>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT folder_id, COUNT(*) as count FROM item_folders GROUP BY folder_id",
    )?;
    let counts = stmt
        .query_map([], |row| {
            Ok(FolderCount {
                folder_id: row.get(0)?,
                count: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(counts)
}

pub fn add_items_to_folder(conn: &Connection, folder_id: &str, item_ids: &[String]) -> Result<(), AppError> {
    for item_id in item_ids {
        conn.execute(
            "INSERT OR IGNORE INTO item_folders (item_id, folder_id) VALUES (?1, ?2)",
            rusqlite::params![item_id, folder_id],
        )?;
    }
    Ok(())
}

pub fn remove_items_from_folder(conn: &Connection, folder_id: &str, item_ids: &[String]) -> Result<(), AppError> {
    for item_id in item_ids {
        conn.execute(
            "DELETE FROM item_folders WHERE item_id = ?1 AND folder_id = ?2",
            rusqlite::params![item_id, folder_id],
        )?;
    }
    Ok(())
}
```

**Step 3: Verify compilation**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors

**Step 4: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: add folder CRUD and item association database functions"
```

---

## Task 3: Add IPC command handlers in commands.rs

**Files:**
- Modify: `src-tauri/src/commands.rs:481` (append after `get_folders` command)

**Step 1: Add command handlers**

Append these commands after the `get_folders` command (after line 481). Note: these use the same pattern as existing commands — `with_library_conn` wrapper, no `library_id` needed for non-routing commands but keep for consistency:

```rust
#[tauri::command]
pub fn create_folder(
    name: String,
    parent_id: Option<String>,
    state: State<'_, DbState>,
) -> Result<Folder, AppError> {
    with_library_conn(&state, |conn| {
        db::create_folder(conn, &name, parent_id.as_deref())
    })
}

#[tauri::command]
pub fn rename_folder(
    id: String,
    name: String,
    state: State<'_, DbState>,
) -> Result<Folder, AppError> {
    with_library_conn(&state, |conn| db::rename_folder(conn, &id, &name))
}

#[tauri::command]
pub fn delete_folder(id: String, state: State<'_, DbState>) -> Result<(), AppError> {
    with_library_conn(&state, |conn| db::delete_folder(conn, &id))
}

#[tauri::command]
pub fn move_folder(
    id: String,
    parent_id: Option<String>,
    sort_order: Option<i64>,
    state: State<'_, DbState>,
) -> Result<(), AppError> {
    with_library_conn(&state, |conn| {
        db::move_folder(conn, &id, parent_id.as_deref(), sort_order)
    })
}

#[tauri::command]
pub fn get_folder_item_counts(
    state: State<'_, DbState>,
) -> Result<Vec<FolderCount>, AppError> {
    with_library_conn(&state, |conn| db::get_folder_item_counts(conn))
}

#[tauri::command]
pub fn add_items_to_folder(
    folder_id: String,
    item_ids: Vec<String>,
    state: State<'_, DbState>,
) -> Result<(), AppError> {
    with_library_conn(&state, |conn| {
        db::add_items_to_folder(conn, &folder_id, &item_ids)
    })
}

#[tauri::command]
pub fn remove_items_from_folder(
    folder_id: String,
    item_ids: Vec<String>,
    state: State<'_, DbState>,
) -> Result<(), AppError> {
    with_library_conn(&state, |conn| {
        db::remove_items_from_folder(conn, &folder_id, &item_ids)
    })
}
```

**Step 2: Verify compilation**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors

**Step 3: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat: add folder CRUD and item association IPC commands"
```

---

## Task 4: Register new commands in lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs:46` (add new commands to invoke_handler)

**Step 1: Add new commands to the invoke_handler list**

In `src-tauri/src/lib.rs`, after the existing `commands::get_folders` line (line 46), add:

```rust
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::move_folder,
            commands::get_folder_item_counts,
            commands::add_items_to_folder,
            commands::remove_items_from_folder,
```

**Step 2: Verify compilation**

Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors

**Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: register folder IPC commands in Tauri handler"
```

---

## Task 5: Add FolderCount type to frontend types

**Files:**
- Modify: `src/lib/types.ts:94` (append after `TagCount`)

**Step 1: Add FolderCount interface**

After the `TagCount` interface (after line 94), add:

```typescript
export interface FolderCount {
  folder_id: string;
  count: number;
}
```

**Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add FolderCount type to frontend types"
```

---

## Task 6: Create folderStore

**Files:**
- Create: `src/stores/folderStore.ts`

**Step 1: Write folderStore**

Create `src/stores/folderStore.ts` following the same pattern as `smartFolderStore.ts`:

```typescript
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Folder, FolderCount } from '@/lib/types';
import { useUiStore } from './uiStore';

interface FolderState {
  folders: Folder[];
  itemCounts: Record<string, number>;
  loading: boolean;
}

interface FolderActions {
  fetchFolders: () => Promise<void>;
  create: (name: string, parentId?: string | null) => Promise<Folder>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  move: (id: string, parentId: string | null, sortOrder?: number) => Promise<void>;
  addItems: (folderId: string, itemIds: string[]) => Promise<void>;
  removeItems: (folderId: string, itemIds: string[]) => Promise<void>;
  getItemCount: (folderId: string) => number;
}

export const useFolderStore = create<FolderState & FolderActions>()(
  (set, get) => ({
    folders: [],
    itemCounts: {},
    loading: false,

    fetchFolders: async () => {
      set({ loading: true });
      try {
        const [folders, counts] = await Promise.all([
          invoke<Folder[]>('get_folders', { libraryId: '' }),
          invoke<FolderCount[]>('get_folder_item_counts'),
        ]);
        const itemCounts: Record<string, number> = {};
        for (const c of counts) {
          itemCounts[c.folder_id] = c.count;
        }
        set({ folders, itemCounts });
      } catch (e) {
        useUiStore.getState().setError(String(e));
      } finally {
        set({ loading: false });
      }
    },

    create: async (name, parentId = null) => {
      const folder = await invoke<Folder>('create_folder', { name, parentId });
      await get().fetchFolders();
      return folder;
    },

    rename: async (id, name) => {
      await invoke('rename_folder', { id, name });
      await get().fetchFolders();
    },

    remove: async (id) => {
      await invoke('delete_folder', { id });
      await get().fetchFolders();
    },

    move: async (id, parentId, sortOrder) => {
      await invoke('move_folder', { id, parentId, sortOrder });
      await get().fetchFolders();
    },

    addItems: async (folderId, itemIds) => {
      await invoke('add_items_to_folder', { folderId, itemIds });
      await get().fetchFolders();
    },

    removeItems: async (folderId, itemIds) => {
      await invoke('remove_items_from_folder', { folderId, itemIds });
      await get().fetchFolders();
    },

    getItemCount: (folderId: string) => {
      return get().itemCounts[folderId] ?? 0;
    },
  }),
);
```

**Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/stores/folderStore.ts
git commit -m "feat: add folderStore for folder state management"
```

---

## Task 7: Rewrite FolderList component

**Files:**
- Rewrite: `src/components/Sidebar/FolderList.tsx`

This is the largest task. The component needs: tree rendering, context menu, drag-and-drop, item counts, inline rename.

**Step 1: Write the new FolderList component**

Completely rewrite `src/components/Sidebar/FolderList.tsx`:

```tsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { useLibraryStore } from '@/stores/libraryStore';
import { useItemStore } from '@/stores/itemStore';
import { useFilterStore } from '@/stores/filterStore';
import { useSmartFolderStore } from '@/stores/smartFolderStore';
import { useFolderStore } from '@/stores/folderStore';
import { useUiStore } from '@/stores/uiStore';
import { Folder as FolderIcon, Image as ImageIcon, Tag, Star, Trash2, Plus } from 'lucide-react';
import type { Folder as FolderType } from '@/lib/types';

type DropPosition = 'before' | 'inside' | 'after';

interface DragState {
  folderId: string;
  targetId: string;
  position: DropPosition;
}

export function FolderList() {
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const loadItems = useItemStore((s) => s.loadItems);
  const setSmartFolderId = useFilterStore((s) => s.setSmartFolderId);
  const setSelectedSmartFolder = useSmartFolderStore((s) => s.setSelectedId);
  const { folders, fetchFolders, create, rename: renameFolder, remove: removeFolder, move, getItemCount } = useFolderStore();
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ folder: FolderType; x: number; y: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [bgContextMenu, setBgContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const smartFolderId = useFilterStore((s) => s.smartFolderId);

  useEffect(() => {
    if (smartFolderId) {
      setSelectedFolder(null);
    }
  }, [smartFolderId]);

  useEffect(() => {
    if (!activeLibraryId) return;
    fetchFolders();
  }, [activeLibraryId, fetchFolders]);

  // Close context menus on click anywhere
  useEffect(() => {
    const handler = () => {
      setContextMenu(null);
      setBgContextMenu(null);
    };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  const handleSelectFolder = (folderId: string | null) => {
    setSelectedFolder(folderId);
    setSmartFolderId(null);
    setSelectedSmartFolder(null);
    if (activeLibraryId) {
      loadItems(
        activeLibraryId,
        { folder_id: folderId },
        { field: 'created_at', direction: 'desc' },
        { page: 0, page_size: 100 },
      );
    }
  };

  // Context menu handlers
  const handleFolderContextMenu = (e: React.MouseEvent, folder: FolderType) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ folder, x: e.clientX, y: e.clientY });
  };

  const handleBgContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setBgContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleCreateFolder = async (parentId?: string | null) => {
    const name = window.prompt('Folder name:');
    if (!name?.trim()) return;
    const folder = await create(name.trim(), parentId ?? null);
    handleSelectFolder(folder.id);
  };

  const handleStartRename = (folder: FolderType) => {
    setEditingId(folder.id);
    setEditingName(folder.name);
    setContextMenu(null);
  };

  const handleFinishRename = async () => {
    if (!editingId || !editingName.trim()) {
      setEditingId(null);
      return;
    }
    await renameFolder(editingId, editingName.trim());
    setEditingId(null);
  };

  const handleDelete = async (folder: FolderType) => {
    const ok = window.confirm(`Delete folder "${folder.name}"? Items will not be deleted.`);
    if (!ok) return;
    await removeFolder(folder.id);
    if (selectedFolder === folder.id) {
      handleSelectFolder(null);
    }
    setContextMenu(null);
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, folderId: string) => {
    e.dataTransfer.setData('application/x-folder-id', folderId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    let position: DropPosition;
    if (y < height * 0.25) {
      position = 'before';
    } else if (y > height * 0.75) {
      position = 'after';
    } else {
      position = 'inside';
    }
    setDragState({ folderId: '', targetId: folderId, position });
  };

  const handleDrop = async (e: React.DragEvent, targetFolder: FolderType) => {
    e.preventDefault();
    setDragState(null);

    const folderId = e.dataTransfer.getData('application/x-folder-id');
    const itemIdsJson = e.dataTransfer.getData('application/x-item-ids');

    if (itemIdsJson) {
      // Items dropped from grid
      const itemIds: string[] = JSON.parse(itemIdsJson);
      if (itemIds.length > 0) {
        await useFolderStore.getState().addItems(targetFolder.id, itemIds);
      }
      return;
    }

    if (!folderId || folderId === targetFolder.id) return;

    // Prevent dropping a folder into its own descendant
    const isDescendant = (parentId: string, childId: string): boolean => {
      const children = folders.filter(f => f.parent_id === parentId);
      for (const child of children) {
        if (child.id === childId) return true;
        if (isDescendant(child.id, childId)) return true;
      }
      return false;
    };
    if (isDescendant(folderId, targetFolder.id)) return;

    const ds = dragState;
    if (!ds) return;

    if (ds.position === 'inside') {
      await move(folderId, targetFolder.id);
    } else {
      // before/after: same parent as target, adjust sort_order
      const newParentId = targetFolder.parent_id;
      const targetOrder = targetFolder.sort_order;
      const newOrder = ds.position === 'before' ? targetOrder : targetOrder + 1;
      // Shift siblings to make room
      const siblings = folders.filter(
        f => f.parent_id === newParentId && f.sort_order >= newOrder && f.id !== folderId
      );
      for (const s of siblings) {
        await useFolderStore.getState().move(s.id, newParentId ?? null, s.sort_order + 1);
      }
      await move(folderId, newParentId ?? null, newOrder);
    }
  };

  const handleDragLeave = () => {
    setDragState(null);
  };

  // Build tree from flat list
  const topLevel = folders.filter((f) => !f.parent_id);
  const getChildren = (parentId: string): FolderType[] =>
    folders.filter((f) => f.parent_id === parentId);

  const renderFolder = (folder: FolderType, depth: number = 0) => {
    const children = getChildren(folder.id);
    const isActive = selectedFolder === folder.id;
    const ds = dragState;
    const isDragTarget = ds?.targetId === folder.id;
    const count = getItemCount(folder.id);

    return (
      <div key={folder.id}>
        <div
          draggable
          onDragStart={(e) => handleDragStart(e, folder.id)}
          onDragOver={(e) => handleDragOver(e, folder.id)}
          onDrop={(e) => handleDrop(e, folder)}
          onDragLeave={handleDragLeave}
          onClick={() => {
            if (editingId !== folder.id) handleSelectFolder(folder.id);
          }}
          onContextMenu={(e) => handleFolderContextMenu(e, folder)}
          onDoubleClick={() => handleStartRename(folder)}
          className={`relative flex items-center justify-between px-3 py-1.5 rounded-md cursor-pointer text-[13px] mb-0.5 transition-colors duration-100 ${
            isActive
              ? 'bg-[#0063E1] text-white'
              : 'hover:bg-[#ECECEC] text-[#333333]'
          } ${isDragTarget && ds?.position === 'inside ? 'bg-[#E0ECFF]' : ''}`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          {/* Drop indicator line */}
          {isDragTarget && ds?.position === 'before' && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#0063E1]" />
          )}
          {isDragTarget && ds?.position === 'after' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0063E1]" />
          )}
          <div className="flex items-center gap-2 min-w-0">
            <FolderIcon size={16} className={isActive ? 'text-white' : 'text-[#0063E1]'} />
            {editingId === folder.id ? (
              <input
                autoFocus
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={handleFinishRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFinishRename();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white text-[#333333] text-[13px] px-1 py-0 border border-[#0063E1] rounded outline-none w-full"
              />
            ) : (
              <span className="truncate">{folder.name}</span>
            )}
          </div>
          {count > 0 && (
            <span className={`text-[11px] shrink-0 ${isActive ? 'text-white/70' : 'text-[#999999]'}`}>
              {count}
            </span>
          )}
        </div>
        {children.map((child) => renderFolder(child, depth + 1))}
      </div>
    );
  };

  // Nav items (All Items, Uncategorized, etc.)
  const NavItem = ({ id, icon: Icon, label, color = 'text-[#666666]' }: {
    id: string | null;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
    color?: string;
  }) => {
    const isActive = selectedFolder === id;
    return (
      <div
        onClick={() => handleSelectFolder(id)}
        className={`flex items-center justify-between px-3 py-1.5 rounded-md cursor-pointer text-[13px] mb-0.5 ${
          isActive ? 'bg-[#0063E1] text-white' : 'hover:bg-[#ECECEC] text-[#333333]'
        }`}
      >
        <div className="flex items-center gap-2">
          <Icon size={16} className={isActive ? 'text-white' : color} />
          <span className="truncate">{label}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 mb-6">
      <div className="mb-3">
        <NavItem id={null} icon={ImageIcon} label="All Items" color="text-[#0063E1]" />
        <NavItem id="__uncategorized" icon={FolderIcon} label="Uncategorized" color="text-[#999999]" />
        <NavItem id="__untagged" icon={Tag} label="Untagged" color="text-[#999999]" />
        <NavItem id="__random" icon={Star} label="Random" color="text-[#FF9500]" />
        <NavItem id="__trash" icon={Trash2} label="Trash" color="text-[#999999]" />
      </div>

      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold text-[#999999] uppercase tracking-wider">Folders</span>
        <Plus
          size={14}
          className="text-[#999999] hover:text-[#666666] cursor-pointer"
          onClick={() => handleCreateFolder(null)}
        />
      </div>

      <div ref={listRef} onContextMenu={handleBgContextMenu}>
        {folders.length === 0 ? (
          <p className="text-[12px] text-[#999999] px-3">None yet</p>
        ) : (
          topLevel.map((folder) => renderFolder(folder))
        )}
      </div>

      {/* Folder context menu */}
      {contextMenu && (
        <div
          className="fixed bg-white border border-[#E5E5E5] rounded-lg shadow-lg z-50 py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => handleStartRename(contextMenu.folder)}
            className="block w-full text-left px-3 py-1 text-[13px] text-[#333333] hover:bg-[#F0F0F0]"
          >
            Rename
          </button>
          <button
            onClick={() => {
              handleCreateFolder(contextMenu.folder.id);
              setContextMenu(null);
            }}
            className="block w-full text-left px-3 py-1 text-[13px] text-[#333333] hover:bg-[#F0F0F0]"
          >
            New Sub-folder
          </button>
          <button
            onClick={() => handleDelete(contextMenu.folder)}
            className="block w-full text-left px-3 py-1 text-[13px] text-[#FF3B30] hover:bg-[#F0F0F0]"
          >
            Delete
          </button>
        </div>
      )}

      {/* Background context menu */}
      {bgContextMenu && (
        <div
          className="fixed bg-white border border-[#E5E5E5] rounded-lg shadow-lg z-50 py-1 min-w-[140px]"
          style={{ left: bgContextMenu.x, top: bgContextMenu.y }}
        >
          <button
            onClick={() => {
              handleCreateFolder(null);
              setBgContextMenu(null);
            }}
            className="block w-full text-left px-3 py-1 text-[13px] text-[#333333] hover:bg-[#F0F0F0]"
          >
            New Folder
          </button>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/components/Sidebar/FolderList.tsx
git commit -m "feat: rewrite FolderList with tree view, context menu, drag-and-drop, counts"
```

---

## Task 8: Add "Add to Folder" to grid item context menu

**Files:**
- Find and modify the grid item context menu component (search for existing context menu in `src/components/Grid/`)

**Context:** The grid currently has context menu support via `useUiStore`'s `contextMenu` state. Find where the grid item context menu is rendered and add a folder submenu.

**Step 1: Locate the grid context menu**

Search for the context menu rendering in `src/components/Grid/`. It may be in `VirtualGrid.tsx` or a separate `ItemContextMenu.tsx`.

**Step 2: Add "Add to Folder" submenu**

Add a submenu item that:
1. Lists all folders from `useFolderStore`
2. Calls `addItems(folderId, selectedItemIds)` on click
3. Includes a "New Folder..." option at the bottom

The submenu should appear on hover of the "Add to Folder" row. Use absolute positioning for the submenu.

**Step 3: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add src/components/Grid/
git commit -m "feat: add 'Add to Folder' submenu to grid item context menu"
```

---

## Task 9: Wire up drag-from-grid to sidebar folder

**Files:**
- Modify: `src/components/Grid/` — add `draggable` + `onDragStart` to grid item elements that sets `application/x-item-ids` data
- Verify: `src/components/Sidebar/FolderList.tsx` — the `handleDrop` already handles `application/x-item-ids` data

**Step 1: Make grid items draggable**

In the grid item rendering component, add `draggable` attribute and `onDragStart` handler that serializes selected item IDs:

```tsx
onDragStart={(e) => {
  const selectedIds = useItemStore.getState().selectedItemIds;
  const ids = selectedIds.length > 0 ? selectedIds : [item.id];
  e.dataTransfer.setData('application/x-item-ids', JSON.stringify(ids));
  e.dataTransfer.effectAllowed = 'copy';
}}
```

**Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/components/Grid/
git commit -m "feat: enable drag items from grid to sidebar folders"
```

---

## Task 10: End-to-end manual verification

**Step 1: Start dev server**

Run: `pnpm tauri dev`

**Step 2: Test the following flows**

1. Create a top-level folder via + button
2. Create a sub-folder via right-click -> New Sub-folder
3. Rename a folder via right-click -> Rename (or double-click)
4. See item count display
5. Delete a folder
6. Drag a folder into another folder
7. Drag a folder to reorder between siblings
8. Right-click a grid item -> Add to Folder -> select a folder
9. Drag items from grid onto a folder in sidebar
10. Click a folder to filter items

**Step 3: Final commit**

Fix any issues found during testing, then commit all fixes.
