import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '@/stores/libraryStore';
import { useItemStore } from '@/stores/itemStore';
import type { Folder } from '@/lib/types';

export function FolderList() {
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const loadItems = useItemStore((s) => s.loadItems);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  useEffect(() => {
    if (!activeLibraryId) {
      setFolders([]);
      return;
    }
    invoke<Folder[]>('get_folders', { libraryId: activeLibraryId })
      .then(setFolders)
      .catch(() => {});
  }, [activeLibraryId]);

  const handleSelectFolder = (folderId: string | null) => {
    setSelectedFolder(folderId);
    if (activeLibraryId) {
      loadItems(
        activeLibraryId,
        { folder_id: folderId },
        { field: 'created_at', direction: 'desc' },
        { page: 0, page_size: 100 },
      );
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <button
        onClick={() => handleSelectFolder(null)}
        className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
          selectedFolder === null
            ? 'bg-blue-600/20 text-blue-300'
            : 'hover:bg-neutral-700 text-neutral-300'
        }`}
      >
        All Items
      </button>
      {folders.map((folder) => (
        <button
          key={folder.id}
          onClick={() => handleSelectFolder(folder.id)}
          className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
            selectedFolder === folder.id
              ? 'bg-blue-600/20 text-blue-300'
              : 'hover:bg-neutral-700 text-neutral-300'
          }`}
        >
          {folder.name}
        </button>
      ))}
    </div>
  );
}
