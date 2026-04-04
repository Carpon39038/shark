import { open, message } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useLibraryStore } from '@/stores/libraryStore';
import { useUiStore } from '@/stores/uiStore';
import { useItemStore } from '@/stores/itemStore';
import type { ImportResult, Item } from '@/lib/types';

interface ImportProgressPayload {
  current: number;
  total: number;
  item: Item | null;
  thumbnailPath: string | null;
}

export function ImportButton() {
  const { libraries, activeLibraryId } = useLibraryStore();
  const { setImporting, setImportProgress } = useUiStore();
  const addItem = useItemStore((s) => s.addItem);

  const handleImport = async () => {
    const lib = libraries.find((l) => l.id === activeLibraryId);
    if (!lib) return;

    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;

    // Listen for progress events before starting import
    const unlisten = await listen<ImportProgressPayload>('import-progress', (event) => {
      const { current, total, item, thumbnailPath } = event.payload;
      setImportProgress({ current, total });
      if (item) {
        addItem(item, thumbnailPath ?? undefined);
      }
    });

    setImporting(true);
    try {
      await invoke<ImportResult>('import_files', {
        libraryId: lib.id,
        sourcePath: selected,
      });
    } catch (err) {
      message(`Import failed: ${err}`, { title: 'Import Error', kind: 'error' });
    } finally {
      unlisten();
      setImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <button
      onClick={handleImport}
      disabled={!activeLibraryId}
      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors"
    >
      Import
    </button>
  );
}
