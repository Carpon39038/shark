import { useEffect } from 'react';
import { useViewStore } from '@/stores/viewStore';
import { useUiStore } from '@/stores/uiStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useItemStore } from '@/stores/itemStore';
import { useFilterStore } from '@/stores/filterStore';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Toolbar } from '@/components/Toolbar/Toolbar';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { VirtualGrid } from '@/components/Grid/VirtualGrid';
import { TrashBar } from '@/components/Grid/TrashBar';
import { SelectionBar } from '@/components/Grid/SelectionBar';
import { ImageViewer } from '@/components/Viewer/ImageViewer';
import { ImportProgress } from '@/components/Import/ImportProgress';
import { DropOverlay } from '@/components/Import/DropOverlay';
import { DedupDialog } from '@/components/Import/DedupDialog';
import { Inspector } from '@/components/Inspector/Inspector';
import { checkForUpdates, runUpdate } from '@/lib/updater';
import type { ImportPrepResult, ImportResult } from '@/lib/types';

const handleDropImport = async (paths: string[]) => {
  const { libraries, activeLibraryId } = useLibraryStore.getState();
  const { setImporting, setImportProgress, showDedupDialog, setPendingDropPaths } = useUiStore.getState();
  const reloadCurrentView = useItemStore.getState().reloadCurrentView;

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
      reloadCurrentView(activeLibraryId);
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
  const updateAvailable = useUiStore((s) => s.updateAvailable);
  const updateDownloading = useUiStore((s) => s.updateDownloading);
  const setUpdateAvailable = useUiStore((s) => s.setUpdateAvailable);

  // Silently check for updates once on startup; only surfaces if one is found.
  useEffect(() => {
    checkForUpdates(true);
  }, []);

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

  // Global keyboard shortcuts for selection / batch delete.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore while typing in a field or when a modal/viewer is open.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const ui = useUiStore.getState();
      if (ui.viewerOpen || ui.dedupActive) return;

      const item = useItemStore.getState();
      const filter = useFilterStore.getState();
      const activeLibraryId = useLibraryStore.getState().activeLibraryId;

      // Cmd/Ctrl+A → select all in the current view.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        if (item.items.length > 0) {
          e.preventDefault();
          item.selectAll();
        }
        return;
      }

      // Esc → clear selection.
      if (e.key === 'Escape') {
        if (item.selectedIds.size > 0) {
          e.preventDefault();
          item.clearSelection();
        }
        return;
      }

      // Delete / Backspace → move selection to Trash (active views only).
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        item.selectedIds.size > 0 &&
        activeLibraryId &&
        filter.activeView !== 'trash'
      ) {
        e.preventDefault();
        item.deleteItems(activeLibraryId, Array.from(item.selectedIds), false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-white text-[#333333] font-sans overflow-hidden select-none">
      {error && (
        <div className="fixed top-4 right-4 z-50 bg-[#FF3B30] text-white px-4 py-2 rounded-lg shadow-lg text-[13px]">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}
      {updateAvailable && (
        <div
          className={`fixed right-4 z-50 flex items-center gap-3 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-2.5 text-[13px] ${
            error ? 'top-16' : 'top-4'
          }`}
        >
          <span className="text-[#333333]">
            新版本 <span className="font-semibold text-[#1D1D1F]">{updateAvailable.version}</span> 可用
          </span>
          <button
            onClick={() => runUpdate()}
            disabled={updateDownloading}
            className="bg-[#0063E1] text-white rounded-md px-3 py-1 text-[13px] font-medium hover:bg-[#0052CC] active:bg-[#003FA3] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
          >
            {updateDownloading ? '更新中…' : '更新'}
          </button>
          <button
            onClick={() => setUpdateAvailable(null)}
            disabled={updateDownloading}
            className="text-[#666666] rounded-md px-2 py-1 text-[13px] font-medium hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
          >
            稍后
          </button>
        </div>
      )}
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && <Sidebar />}
        <div className="flex flex-1 flex-col overflow-hidden">
          <TrashBar />
          <SelectionBar />
          <VirtualGrid />
        </div>
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
