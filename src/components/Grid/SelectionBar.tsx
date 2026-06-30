import { useState, useRef, useEffect } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import {
  X, FolderPlus, Tag, Star, Trash2, Plus, CheckSquare, FlipHorizontal2,
} from 'lucide-react';
import { useItemStore } from '@/stores/itemStore';
import { useFilterStore } from '@/stores/filterStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useFolderStore } from '@/stores/folderStore';

type Popover = 'folder' | 'tag' | 'rating' | null;

/**
 * Action bar shown above the grid whenever one or more items are selected
 * (outside the Trash view, which has its own TrashBar). Exposes the batch
 * operations: add to folder, add/remove tags, set rating, move to trash.
 */
export function SelectionBar() {
  const activeView = useFilterStore((s) => s.activeView);
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const selectAll = useItemStore((s) => s.selectAll);
  const invertSelection = useItemStore((s) => s.invertSelection);
  const clearSelection = useItemStore((s) => s.clearSelection);
  const deleteItems = useItemStore((s) => s.deleteItems);
  const addTags = useItemStore((s) => s.addTags);
  const removeTags = useItemStore((s) => s.removeTags);
  const setRating = useItemStore((s) => s.setRating);
  const { folders, addItems, create: createFolder } = useFolderStore();

  const [popover, setPopover] = useState<Popover>(null);
  const [tagInput, setTagInput] = useState('');
  const barRef = useRef<HTMLDivElement>(null);

  const count = selectedIds.size;

  // Close any open popover when clicking outside the bar.
  useEffect(() => {
    if (!popover) return;
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [popover]);

  if (activeView === 'trash' || count === 0) return null;

  const ids = () => Array.from(selectedIds);

  const togglePopover = (p: Popover) => {
    setPopover((cur) => (cur === p ? null : p));
    setTagInput('');
  };

  const handleAddToFolder = async (folderId: string) => {
    await addItems(folderId, ids());
    setPopover(null);
  };

  const handleCreateAndAdd = async () => {
    const name = `New Folder ${folders.length + 1}`;
    const folder = await createFolder(name);
    await addItems(folder.id, ids());
    setPopover(null);
  };

  const handleAddTag = async () => {
    const tag = tagInput.trim();
    if (!tag || !activeLibraryId) return;
    await addTags(activeLibraryId, ids(), [tag]);
    setTagInput('');
  };

  const handleRemoveTag = async () => {
    const tag = tagInput.trim();
    if (!tag || !activeLibraryId) return;
    await removeTags(activeLibraryId, ids(), [tag]);
    setTagInput('');
  };

  const handleRating = async (rating: number) => {
    if (!activeLibraryId) return;
    await setRating(activeLibraryId, ids(), rating);
    setPopover(null);
  };

  const handleMoveToTrash = async () => {
    if (!activeLibraryId) return;
    const ok = await ask(
      `Move ${count} item${count > 1 ? 's' : ''} to Trash?`,
      { title: 'Move to Trash', kind: 'warning' },
    );
    if (ok) await deleteItems(activeLibraryId, ids(), false);
  };

  const btn =
    'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[#333333] hover:bg-[#ECECEC] transition-colors';

  return (
    <div
      ref={barRef}
      className="relative h-9 shrink-0 border-b border-[#F0F0F0] bg-[#EBF5FF] flex items-center justify-between px-4 text-[12px]"
    >
      <div className="flex items-center gap-2">
        <button
          onClick={clearSelection}
          className="flex items-center justify-center w-5 h-5 rounded-md text-[#0063E1] hover:bg-[#D6E9FF]"
          title="Clear selection (Esc)"
        >
          <X size={14} />
        </button>
        <span className="font-medium text-[#0063E1]">{count} selected</span>
        <div className="w-px h-4 bg-[#C9DDF5] mx-1" />
        <button onClick={selectAll} className={btn} title="Select all (Cmd/Ctrl+A)">
          <CheckSquare size={13} />
          All
        </button>
        <button onClick={invertSelection} className={btn} title="Invert selection">
          <FlipHorizontal2 size={13} />
          Invert
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button onClick={() => togglePopover('folder')} className={btn}>
          <FolderPlus size={13} />
          Add to Folder
        </button>
        <button onClick={() => togglePopover('tag')} className={btn}>
          <Tag size={13} />
          Tags
        </button>
        <button onClick={() => togglePopover('rating')} className={btn}>
          <Star size={13} />
          Rating
        </button>
        <div className="w-px h-4 bg-[#C9DDF5] mx-1" />
        <button
          onClick={handleMoveToTrash}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[#FF3B30] hover:bg-[#FFEAEA] transition-colors"
        >
          <Trash2 size={13} />
          Move to Trash
        </button>
      </div>

      {/* Add-to-folder popover */}
      {popover === 'folder' && (
        <div className="absolute right-4 top-9 z-50 bg-white border border-[#E5E5E5] rounded-lg shadow-md py-1 min-w-[170px] max-h-72 overflow-y-auto">
          {folders.length === 0 && (
            <div className="px-3 py-1.5 text-[12px] text-[#999999]">No folders yet</div>
          )}
          {folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => handleAddToFolder(folder.id)}
              className="block w-full text-left px-3 py-1.5 text-[13px] text-[#333333] hover:bg-[#F0F0F0]"
            >
              {folder.name}
            </button>
          ))}
          {folders.length > 0 && <div className="border-t border-[#E5E5E5] my-1" />}
          <button
            onClick={handleCreateAndAdd}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[13px] text-[#0063E1] hover:bg-[#F0F0F0]"
          >
            <Plus size={14} />
            New Folder...
          </button>
        </div>
      )}

      {/* Tag popover */}
      {popover === 'tag' && (
        <div className="absolute right-4 top-9 z-50 bg-white border border-[#E5E5E5] rounded-lg shadow-md p-3 w-60">
          <div className="text-[11px] font-semibold text-[#999999] uppercase tracking-wider mb-1.5">
            Tag {count} item{count > 1 ? 's' : ''}
          </div>
          <input
            autoFocus
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddTag();
              if (e.key === 'Escape') setPopover(null);
            }}
            placeholder="Tag name..."
            className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-md text-[13px] focus:border-[#0063E1] focus:ring-2 focus:ring-[#0063E1]/20 focus:outline-none placeholder:text-[#999999]"
          />
          <div className="flex items-center gap-2 mt-2.5">
            <button
              onClick={handleAddTag}
              disabled={!tagInput.trim()}
              className="flex-1 bg-[#0063E1] text-white rounded-md px-3 py-1.5 text-[12px] font-medium hover:bg-[#0052CC] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Add
            </button>
            <button
              onClick={handleRemoveTag}
              disabled={!tagInput.trim()}
              className="flex-1 bg-gray-100 text-gray-700 rounded-md px-3 py-1.5 text-[12px] font-medium hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Rating popover */}
      {popover === 'rating' && (
        <div className="absolute right-4 top-9 z-50 bg-white border border-[#E5E5E5] rounded-lg shadow-md p-3">
          <div className="text-[11px] font-semibold text-[#999999] uppercase tracking-wider mb-1.5">
            Set rating
          </div>
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => handleRating(star)}
                className="p-0.5 hover:scale-110 transition-transform"
                title={`${star} star${star > 1 ? 's' : ''}`}
              >
                <Star size={18} className="text-[#D9D9D9] hover:text-[#FFBD2E]" />
              </button>
            ))}
            <button
              onClick={() => handleRating(0)}
              className="ml-2 text-[11px] text-[#999999] hover:text-[#666666]"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
