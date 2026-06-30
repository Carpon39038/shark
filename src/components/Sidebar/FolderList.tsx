import { useEffect, useState, useRef } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { useLibraryStore } from '@/stores/libraryStore';
import { useItemStore } from '@/stores/itemStore';
import { useFilterStore } from '@/stores/filterStore';
import { useSmartFolderStore } from '@/stores/smartFolderStore';
import { useFolderStore } from '@/stores/folderStore';
import { Folder as FolderIcon, Image as ImageIcon, Tag, Trash2, Plus } from 'lucide-react';
import type { Folder as FolderType } from '@/lib/types';

type DropPosition = 'before' | 'inside' | 'after';

interface DragState {
  folderId: string;
  targetId: string;
  position: DropPosition;
}

export function FolderList() {
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const reloadCurrentView = useItemStore((s) => s.reloadCurrentView);
  const selectFolder = useFilterStore((s) => s.selectFolder);
  const selectSpecialView = useFilterStore((s) => s.selectSpecialView);
  const activeView = useFilterStore((s) => s.activeView);
  const selectedFolderId = useFilterStore((s) => s.selectedFolderId);
  const setSelectedSmartFolder = useSmartFolderStore((s) => s.setSelectedId);
  const { folders, fetchFolders, create, rename: renameFolder, remove: removeFolder, move, getItemCount } = useFolderStore();
  const selectedFolder = activeView === 'folder' ? selectedFolderId : null;
  const [contextMenu, setContextMenu] = useState<{ folder: FolderType; x: number; y: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [bgContextMenu, setBgContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined); // undefined = not creating
  const [newFolderName, setNewFolderName] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

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
    selectFolder(folderId);
    setSelectedSmartFolder(null);
    if (activeLibraryId) {
      reloadCurrentView(activeLibraryId);
    }
  };

  const handleSelectSpecialView = (view: Parameters<typeof selectSpecialView>[0]) => {
    selectSpecialView(view);
    setSelectedSmartFolder(null);
    if (activeLibraryId) {
      reloadCurrentView(activeLibraryId);
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

  const handleCreateFolder = (parentId?: string | null) => {
    setCreatingParentId(parentId ?? null);
    setNewFolderName('');
    setContextMenu(null);
    setBgContextMenu(null);
  };

  const handleFinishCreate = async () => {
    if (!newFolderName.trim()) {
      setCreatingParentId(undefined);
      return;
    }
    const folder = await create(newFolderName.trim(), creatingParentId ?? null);
    setCreatingParentId(undefined);
    setNewFolderName('');
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
    const ok = await ask(`Delete folder "${folder.name}"? Items will not be deleted.`, { title: 'Delete Folder', kind: 'warning' });
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
          } ${isDragTarget && ds?.position === 'inside' ? 'bg-[#E0ECFF]' : ''}`}
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
        {/* Inline new sub-folder input */}
        {creatingParentId === folder.id && (
          <div className="flex items-center gap-2 px-3 py-1.5 mb-0.5" style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}>
            <FolderIcon size={16} className="text-[#0063E1]" />
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onBlur={handleFinishCreate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFinishCreate();
                if (e.key === 'Escape') setCreatingParentId(undefined);
              }}
              placeholder="Folder name"
              className="bg-white text-[#333333] text-[13px] px-1 py-0 border border-[#0063E1] rounded outline-none w-full"
            />
          </div>
        )}
      </div>
    );
  };

  // Nav items (All Items, Uncategorized, etc.) — each maps to a special view.
  const NavItem = ({ view, icon: Icon, label, color = 'text-[#666666]' }: {
    view: Parameters<typeof selectSpecialView>[0];
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
    color?: string;
  }) => {
    const isActive = activeView === view;
    return (
      <div
        onClick={() => handleSelectSpecialView(view)}
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
        <NavItem view="all" icon={ImageIcon} label="All Items" color="text-[#0063E1]" />
        <NavItem view="uncategorized" icon={FolderIcon} label="Uncategorized" color="text-[#999999]" />
        <NavItem view="untagged" icon={Tag} label="Untagged" color="text-[#999999]" />
        <NavItem view="trash" icon={Trash2} label="Trash" color="text-[#999999]" />
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
        {folders.length === 0 && creatingParentId === undefined ? (
          <p className="text-[12px] text-[#999999] px-3">None yet</p>
        ) : (
          topLevel.map((folder) => renderFolder(folder))
        )}
        {/* Inline new folder input at root level */}
        {creatingParentId === null && (
          <div className="flex items-center gap-2 px-3 py-1.5 mb-0.5" style={{ paddingLeft: '12px' }}>
            <FolderIcon size={16} className="text-[#0063E1]" />
            <input
              ref={newFolderInputRef}
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onBlur={handleFinishCreate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFinishCreate();
                if (e.key === 'Escape') setCreatingParentId(undefined);
              }}
              placeholder="Folder name"
              className="bg-white text-[#333333] text-[13px] px-1 py-0 border border-[#0063E1] rounded outline-none w-full"
            />
          </div>
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
