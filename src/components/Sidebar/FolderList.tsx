import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '@/stores/libraryStore';
import { useItemStore } from '@/stores/itemStore';
import { useFilterStore } from '@/stores/filterStore';
import { useSmartFolderStore } from '@/stores/smartFolderStore';
import { useUiStore } from '@/stores/uiStore';
import { Folder, Image as ImageIcon, Tag, Star, Trash2 } from 'lucide-react';
import type { Folder as FolderType } from '@/lib/types';

export function FolderList() {
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const loadItems = useItemStore((s) => s.loadItems);
  const setSmartFolderId = useFilterStore((s) => s.setSmartFolderId);
  const setSelectedSmartFolder = useSmartFolderStore((s) => s.setSelectedId);
  const [folders, setFolders] = useState<FolderType[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  const smartFolderId = useFilterStore((s) => s.smartFolderId);

  useEffect(() => {
    if (smartFolderId) {
      setSelectedFolder(null);
    }
  }, [smartFolderId]);

  useEffect(() => {
    if (!activeLibraryId) {
      setFolders([]);
      return;
    }
    invoke<FolderType[]>('get_folders', { libraryId: activeLibraryId })
      .then(setFolders)
      .catch((e) => useUiStore.getState().setError(String(e)));
  }, [activeLibraryId]);

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

  const NavItem = ({ id, icon: Icon, label, color = 'text-gray-600' }: {
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
          isActive ? 'bg-[#0063E1] text-white' : 'hover:bg-gray-200/50 text-gray-700'
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
        <NavItem id={null} icon={ImageIcon} label="All Items" color="text-blue-500" />
        <NavItem id="__uncategorized" icon={Folder} label="Uncategorized" color="text-gray-400" />
        <NavItem id="__untagged" icon={Tag} label="Untagged" color="text-gray-400" />
        <NavItem id="__random" icon={Star} label="Random" color="text-yellow-500" />
        <NavItem id="__trash" icon={Trash2} label="Trash" color="text-gray-400" />
      </div>

      {folders.length > 0 && (
        <>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Folders</span>
          </div>
          <div>
            {folders.map((folder) => (
              <div
                key={folder.id}
                onClick={() => handleSelectFolder(folder.id)}
                className={`flex items-center justify-between px-3 py-1.5 rounded-md cursor-pointer text-[13px] mb-0.5 ${
                  selectedFolder === folder.id
                    ? 'bg-[#0063E1] text-white'
                    : 'hover:bg-gray-200/50 text-gray-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Folder size={16} className={selectedFolder === folder.id ? 'text-white' : 'text-blue-500'} />
                  <span className="truncate">{folder.name}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
