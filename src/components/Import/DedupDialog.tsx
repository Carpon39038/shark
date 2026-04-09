import { invoke } from '@tauri-apps/api/core';
import { useUiStore } from '@/stores/uiStore';
import { useItemStore } from '@/stores/itemStore';
import { useLibraryStore } from '@/stores/libraryStore';
import type { DedupAction, ImportResult } from '@/lib/types';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncatePath(path: string, maxLen = 40): string {
  if (path.length <= maxLen) return path;
  return '...' + path.slice(path.length - maxLen + 1);
}

export function DedupDialog() {
  const {
    dedupActive,
    dedupItems,
    dedupCurrentIndex,
    dedupApplyAll,
    dismissDedupDialog,
    setImporting,
    setImportProgress,
  } = useUiStore();

  const { libraries, activeLibraryId } = useLibraryStore();
  const loadItems = useItemStore((s) => s.loadItems);

  if (!dedupActive || dedupItems.length === 0) return null;

  const current = dedupItems[dedupCurrentIndex] ?? dedupItems[dedupItems.length - 1];
  const isLast = dedupCurrentIndex >= dedupItems.length - 1;
  const remaining = dedupItems.length - dedupCurrentIndex;

  const handleDecision = async (action: DedupAction) => {
    const { setDedupDecision, nextDedupItem } = useUiStore.getState();

    setDedupDecision(current.newFile.sourcePath, action);

    if (dedupApplyAll) {
      // Apply this action to all remaining
      const state = useUiStore.getState();
      for (const item of state.dedupItems.slice(state.dedupCurrentIndex + 1)) {
        setDedupDecision(item.newFile.sourcePath, action);
      }
      await resolveAndImport();
      return;
    }

    if (isLast) {
      await resolveAndImport();
    } else {
      nextDedupItem();
    }
  };

  const resolveAndImport = async () => {
    const state = useUiStore.getState();
    const lib = libraries.find((l) => l.id === activeLibraryId);
    if (!lib) return;

    dismissDedupDialog();
    setImporting(true);

    try {
      if (state.pendingDropPaths && state.pendingDropPaths.length > 0) {
        // Drag-drop import
        await invoke<ImportResult>('import_commit_paths', {
          libraryId: lib.id,
          paths: state.pendingDropPaths,
          actions: state.dedupDecisions,
        });
        useUiStore.getState().setPendingDropPaths(null);
      } else if (state.dedupSourcePath) {
        // Directory import
        await invoke<ImportResult>('import_commit', {
          libraryId: lib.id,
          sourcePath: state.dedupSourcePath,
          actions: state.dedupDecisions,
        });
      }

      if (activeLibraryId) {
        loadItems(activeLibraryId, {}, { field: 'created_at', direction: 'desc' }, { page: 0, page_size: 100 });
      }
    } catch (err) {
      console.error('Import commit failed:', err);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const handleSkipAll = () => {
    const state = useUiStore.getState();
    const { setDedupDecision } = useUiStore.getState();
    for (const item of state.dedupItems.slice(state.dedupCurrentIndex)) {
      setDedupDecision(item.newFile.sourcePath, 'skip');
    }
    resolveAndImport();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center">
      <div className="bg-white rounded-lg p-5 w-[520px] shadow-xl border border-[#E5E5E5]">
        <h2 className="text-lg font-semibold text-[#1D1D1F] mb-4">
          Duplicate Found ({dedupCurrentIndex + 1}/{dedupItems.length})
        </h2>

        <div className="flex gap-4 mb-4">
          {/* Existing file */}
          <div className="flex-1 bg-gray-50 border border-[#E5E5E5] rounded-md p-3">
            <div className="text-[11px] text-[#666666] mb-2">Existing</div>
            {current.existing.thumbnailPath && (
              <img
                src={current.existing.thumbnailPath}
                alt="existing"
                className="w-full aspect-square object-cover rounded mb-2"
              />
            )}
            <div className="text-[13px] text-[#333333] font-medium truncate">
              {current.existing.filename}
            </div>
            <div className="text-[11px] text-[#666666] truncate">
              {truncatePath(current.existing.path)}
            </div>
            <div className="text-[11px] text-[#999999] mt-1">
              {formatFileSize(current.existing.fileSize)}
            </div>
          </div>

          {/* New file */}
          <div className="flex-1 bg-gray-50 border border-[#E5E5E5] rounded-md p-3">
            <div className="text-[11px] text-[#666666] mb-2">New File</div>
            <div className="w-full aspect-square bg-[#F0F0F0] rounded mb-2 flex items-center justify-center text-[#999999] text-[11px]">
              No preview
            </div>
            <div className="text-[13px] text-[#333333] font-medium truncate">
              {current.newFile.filename}
            </div>
            <div className="text-[11px] text-[#666666] truncate">
              {truncatePath(current.newFile.sourcePath)}
            </div>
            <div className="text-[11px] text-[#999999] mt-1">
              {formatFileSize(current.newFile.fileSize)}
            </div>
          </div>
        </div>

        {/* Apply to all checkbox */}
        {remaining > 1 && (
          <label className="flex items-center gap-2 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={dedupApplyAll}
              onChange={(e) => {
                useUiStore.setState({ dedupApplyAll: e.target.checked });
              }}
              className="rounded border-[#E5E5E5]"
            />
            <span className="text-[13px] text-[#666666]">
              Apply to all remaining ({remaining - 1})
            </span>
          </label>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleSkipAll}
            className="px-3 py-1.5 text-[13px] text-[#666666] hover:text-[#1D1D1F] transition-colors duration-150"
          >
            Skip All
          </button>
          <button
            onClick={() => handleDecision('skip')}
            className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-md text-[13px] font-medium text-[#333333] transition-colors duration-150"
          >
            Skip
          </button>
          <button
            onClick={() => handleDecision('keepBoth')}
            className="px-4 py-1.5 bg-[#0063E1] hover:bg-[#0052CC] active:bg-[#003FA3] rounded-md text-[13px] font-medium text-white transition-colors duration-150"
          >
            Keep Both
          </button>
        </div>
      </div>
    </div>
  );
}
