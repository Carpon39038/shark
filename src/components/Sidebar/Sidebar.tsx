import { useState } from 'react';
import { LibrarySelector } from './LibrarySelector';
import { FolderList } from './FolderList';
import { SmartFolderList } from './SmartFolderList';
import { SmartFolderEditor } from './SmartFolderEditor';
import type { SmartFolder } from '@/lib/types';

export function Sidebar() {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<SmartFolder | null>(null);

  const handleEdit = (folder: SmartFolder) => {
    setEditingFolder(folder);
    setEditorOpen(true);
  };

  const handleCreate = () => {
    setEditingFolder(null);
    setEditorOpen(true);
  };

  return (
    <div className="w-64 bg-[#F6F6F6] border-r border-gray-200 flex flex-col overflow-y-auto pt-4 px-3 pb-4 shrink-0">
      <LibrarySelector />
      <FolderList />
      <SmartFolderList onEdit={handleEdit} onCreate={handleCreate} />
      {editorOpen && (
        <SmartFolderEditor
          folder={editingFolder}
          onClose={() => {
            setEditorOpen(false);
            setEditingFolder(null);
          }}
        />
      )}
    </div>
  );
}
