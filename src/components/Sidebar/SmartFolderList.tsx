import { useEffect, useState } from 'react';
import { useLibraryStore } from '@/stores/libraryStore';
import { useSmartFolderStore } from '@/stores/smartFolderStore';
import { useItemStore } from '@/stores/itemStore';
import { useFilterStore } from '@/stores/filterStore';
import { Plus, Search, Clock, FileImage, Image as ImageIcon } from 'lucide-react';
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
        <div
          onClick={() => handleSelect(folder)}
          onContextMenu={(e) => handleContextMenu(e, folder)}
          className={`flex items-center justify-between px-3 py-1.5 rounded-md cursor-pointer text-[13px] mb-0.5 ${
            selectedId === folder.id
              ? 'bg-[#0063E1] text-white'
              : 'hover:bg-gray-200/50 text-gray-700'
          }`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          <div className="flex items-center gap-2">
            <Clock size={16} className={selectedId === folder.id ? 'text-white' : 'text-blue-400'} />
            <span className="truncate">{folder.name}</span>
          </div>
        </div>
        {children.map((child) => renderFolder(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Smart Folders</span>
        <Plus size={14} className="text-gray-400 hover:text-gray-600 cursor-pointer" onClick={onCreate} />
      </div>
      {topLevel.length === 0 ? (
        <p className="text-[12px] text-gray-400 px-3">None yet</p>
      ) : (
        topLevel.map((folder) => renderFolder(folder))
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={handleEdit}
            className="block w-full text-left px-3 py-1 text-[13px] text-gray-700 hover:bg-gray-100"
          >
            Edit
          </button>
          <button
            onClick={handleDelete}
            className="block w-full text-left px-3 py-1 text-[13px] text-red-500 hover:bg-gray-100"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
