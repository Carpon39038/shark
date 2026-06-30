import { ask } from '@tauri-apps/plugin-dialog';
import { Trash2, RotateCcw } from 'lucide-react';
import { useFilterStore } from '@/stores/filterStore';
import { useItemStore } from '@/stores/itemStore';
import { useLibraryStore } from '@/stores/libraryStore';

/**
 * Action bar shown above the grid only while the Trash view is active.
 * Offers restoring the current selection and emptying the whole trash.
 */
export function TrashBar() {
  const activeView = useFilterStore((s) => s.activeView);
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const total = useItemStore((s) => s.total);
  const restoreItems = useItemStore((s) => s.restoreItems);
  const emptyTrash = useItemStore((s) => s.emptyTrash);

  if (activeView !== 'trash') return null;

  const selectedCount = selectedIds.size;

  const handleRestoreSelected = () => {
    if (activeLibraryId && selectedCount > 0) {
      restoreItems(activeLibraryId, Array.from(selectedIds));
    }
  };

  const handleEmptyTrash = async () => {
    if (!activeLibraryId || total === 0) return;
    const ok = await ask(
      `Permanently delete all ${total} item${total > 1 ? 's' : ''} in Trash? This cannot be undone.`,
      { title: 'Empty Trash', kind: 'warning' },
    );
    if (ok) {
      emptyTrash(activeLibraryId);
    }
  };

  return (
    <div className="h-9 shrink-0 border-b border-[#F0F0F0] bg-[#FAFAFA] flex items-center justify-between px-4 text-[12px]">
      <span className="text-[#999999]">
        Trash · {total} item{total === 1 ? '' : 's'}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={handleRestoreSelected}
          disabled={selectedCount === 0}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[#333333] hover:bg-[#ECECEC] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RotateCcw size={13} />
          Restore{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </button>
        <button
          onClick={handleEmptyTrash}
          disabled={total === 0}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[#FF3B30] hover:bg-[#FFEAEA] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 size={13} />
          Empty Trash
        </button>
      </div>
    </div>
  );
}
