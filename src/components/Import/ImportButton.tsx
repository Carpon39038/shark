import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '@/stores/libraryStore';
import { useUiStore } from '@/stores/uiStore';
import { useItemStore } from '@/stores/itemStore';
import type { ImportResult } from '@/lib/types';

export function ImportButton() {
  const { libraries, activeLibraryId } = useLibraryStore();
  const setImporting = useUiStore((s) => s.setImporting);
  const loadItems = useItemStore((s) => s.loadItems);

  const handleImport = async () => {
    const lib = libraries.find((l) => l.id === activeLibraryId);
    if (!lib) return;

    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;

    setImporting(true);
    try {
      const result = await invoke<ImportResult>('import_files', {
        libraryId: lib.id,
        sourcePath: selected,
      });

      // Refresh grid
      await loadItems(
        lib.id,
        {},
        { field: 'created_at', direction: 'desc' },
        { page: 0, page_size: 100 },
      );

      alert(`Imported: ${result.imported}, Skipped: ${result.skipped}, Duplicates: ${result.duplicates}`);
    } catch (err) {
      alert(`Import failed: ${err}`);
    } finally {
      setImporting(false);
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
