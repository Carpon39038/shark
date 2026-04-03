import { LibrarySelector } from './LibrarySelector';
import { FolderList } from './FolderList';

export function Sidebar() {
  return (
    <div className="w-56 shrink-0 bg-neutral-800 border-r border-neutral-700 flex flex-col overflow-hidden">
      <LibrarySelector />
      <FolderList />
    </div>
  );
}
