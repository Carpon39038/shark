import { useEffect } from 'react';
import { useViewStore } from '@/stores/viewStore';
import { useUiStore } from '@/stores/uiStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useItemStore } from '@/stores/itemStore';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Toolbar } from '@/components/Toolbar/Toolbar';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { VirtualGrid } from '@/components/Grid/VirtualGrid';
import { ImageViewer } from '@/components/Viewer/ImageViewer';
import { ImportProgress } from '@/components/Import/ImportProgress';
import { DropOverlay } from '@/components/Import/DropOverlay';
import { DedupDialog } from '@/components/Import/DedupDialog';
import { Inspector } from '@/components/Inspector/Inspector';
import type { ImportPrepResult, ImportResult } from '@/lib/types';

const handleDropImport = async (paths: string[]) => {
  const { libraries, activeLibraryId } = useLibraryStore.getState();
  const { setImporting, setImportProgress, showDedupDialog, setPendingDropPaths } = useUiStore.getState();
  const loadItems = useItemStore.getState().loadItems;

  const lib = libraries.find((l) => l.id === activeLibraryId);
  if (!lib) {
    useUiStore.getState().setError('请先选择或创建一个库');
    return;
  }

  setImporting(true);
  try {
    const prep = await invoke<ImportPrepResult>('import_from_paths', {
      libraryId: lib.id,
      paths,
    });

    if (prep.duplicates.length > 0) {
      setImporting(false);
      setPendingDropPaths(paths);
      showDedupDialog(prep.duplicates, '');
      return;
    }

    // No duplicates — commit directly
    await invoke<ImportResult>('import_commit_paths', {
      libraryId: lib.id,
      paths,
      actions: {},
    });

    if (activeLibraryId) {
      loadItems(activeLibraryId, {}, { field: 'created_at', direction: 'desc' }, { page: 0, page_size: 100 });
    }
  } catch (err) {
    console.error('Drop import failed:', err);
    useUiStore.getState().setError(`导入失败: ${err}`);
  } finally {
    setImporting(false);
    setImportProgress(null);
  }
};

function App() {
  const sidebarOpen = useViewStore((s) => s.sidebarOpen);
  const inspectorOpen = useViewStore((s) => s.inspectorOpen);
  const { error, setError } = useUiStore();

  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      const { importing } = useUiStore.getState();
      switch (event.payload.type) {
        case 'enter':
          useUiStore.getState().setDragOver(true);
          break;
        case 'leave':
          useUiStore.getState().setDragOver(false);
          break;
        case 'drop': {
          useUiStore.getState().setDragOver(false);
          if (importing) return;
          const paths = event.payload.paths;
          if (!paths || paths.length === 0) return;
          handleDropImport(paths);
          break;
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-white text-[#333333] font-sans overflow-hidden select-none">
      {error && (
        <div className="fixed top-4 right-4 z-50 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && <Sidebar />}
        <VirtualGrid />
        {inspectorOpen && <Inspector />}
      </div>
      <ImageViewer />
      <ImportProgress />
      <DropOverlay />
      <DedupDialog />
    </div>
  );
}

export default App;
