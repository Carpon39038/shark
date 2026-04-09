import { open, message } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useLibraryStore } from '@/stores/libraryStore';
import { useUiStore } from '@/stores/uiStore';
import { useItemStore } from '@/stores/itemStore';
import { Plus } from 'lucide-react';
import type { ImportPrepResult, ImportResult, Item } from '@/lib/types';


interface ImportProgressPayload {
  current: number;
  total: number;
  item: Item | null;
  thumbnailPath: string | null;
}

export function ImportButton() {
  const { libraries, activeLibraryId } = useLibraryStore();
  const { setImporting, setImportProgress, showDedupDialog } = useUiStore();
  const addItem = useItemStore((s) => s.addItem);
  const loadItems = useItemStore((s) => s.loadItems);

  const handleImport = async () => {
    const lib = libraries.find((l) => l.id === activeLibraryId);
    if (!lib) return;

    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;

    setImporting(true);
    try {
      // Phase 1: prepare and check duplicates
      const prep = await invoke<ImportPrepResult>('import_prepare', {
        libraryId: lib.id,
        sourcePath: selected,
      });

      if (prep.duplicates.length > 0) {
        // Show dedup dialog — import continues from DedupDialog
        setImporting(false);
        showDedupDialog(prep.duplicates, selected);
        return;
      }

      // No duplicates — proceed with direct import
      const unlisten = await listen<ImportProgressPayload>('import-progress', (event) => {
        const { current, total, item } = event.payload;
        setImportProgress({ current, total });
        if (item) {
          addItem(item);
        }
      });

      try {
        await invoke<ImportResult>('import_files', {
          libraryId: lib.id,
          sourcePath: selected,
        });
        if (activeLibraryId) {
          loadItems(activeLibraryId, {}, { field: 'created_at', direction: 'desc' }, { page: 0, page_size: 100 });
        }
      } finally {
        unlisten();
      }
    } catch (err) {
      message(`Import failed: ${err}`, { title: 'Import Error', kind: 'error' });
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <button
      onClick={handleImport}
      disabled={!activeLibraryId}
      className="p-1.5 text-[#0063E1] hover:bg-[#EBF5FF] rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
      title="Import"
    >
      <Plus size={18} />
    </button>
  );
}
