import { useState } from 'react';
import { LibrarySelector } from './LibrarySelector';
import { FolderList } from './FolderList';
import { SmartFolderList } from './SmartFolderList';
// SmartFolderEditor will be imported in Task 8
import type { SmartFolder } from '@/lib/types';

export function Sidebar() {
  const [_editorOpen, setEditorOpen] = useState(false);
  const [_editingFolder, setEditingFolder] = useState<SmartFolder | null>(null);

  const handleEdit = (folder: SmartFolder) => {
    setEditingFolder(folder);
    setEditorOpen(true);
  };

  const handleCreate = () => {
    setEditingFolder(null);
    setEditorOpen(true);
  };

  return (
    <div className="w-56 shrink-0 bg-neutral-800 border-r border-neutral-700 flex flex-col overflow-hidden">
      <LibrarySelector />
      <FolderList />
      <SmartFolderList onEdit={handleEdit} onCreate={handleCreate} />
      {/* SmartFolderEditor will be wired here in Task 8 */}
    </div>
  );
}
