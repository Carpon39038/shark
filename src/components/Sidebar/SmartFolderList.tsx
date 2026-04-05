import { useEffect, useState } from 'react';
import { useLibraryStore } from '@/stores/libraryStore';
import { useSmartFolderStore } from '@/stores/smartFolderStore';
import { useItemStore } from '@/stores/itemStore';
import { useFilterStore } from '@/stores/filterStore';
import type { SmartFolder } from '@/lib/types';

interface SmartFolderListProps {
  onEdit: (folder: SmartFolder) => void;
  onCreate: () => void;
}

export function SmartFolderList({ onEdit, onCreate }: SmartFolderListProps) {
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const { folders, selectedId, fetchFolders, setSelectedId, remove } =
    useSmartFolderStore();
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
        <button
          onClick={onCreate}
          className="text-neutral-500 hover:text-neutral-300 text-xs"
          title="New Smart Folder"
        >
          +
        </button>
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
