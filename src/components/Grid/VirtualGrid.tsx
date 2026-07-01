import { useRef, useEffect, useCallback, useState } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useItemStore } from '@/stores/itemStore';
import { useViewStore } from '@/stores/viewStore';
import { useUiStore } from '@/stores/uiStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useFolderStore } from '@/stores/folderStore';
import { AssetCard } from './AssetCard';
import { useFilterStore } from '@/stores/filterStore';
import { ChevronDown, FolderPlus, Plus, Trash2, RotateCcw } from 'lucide-react';

export function VirtualGrid() {
  const { items, selectedIds, thumbnailPaths, toggleSelect, selectRange, clearSelection } = useItemStore();
  const deleteItems = useItemStore((s) => s.deleteItems);
  const restoreItems = useItemStore((s) => s.restoreItems);
  const gridSize = useViewStore((s) => s.gridSize);
  const openViewer = useUiStore((s) => s.openViewer);
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const activeView = useFilterStore((s) => s.activeView);
  const { folders, addItems, create: createFolder, nextDefaultFolderName } = useFolderStore();
  const [columnCount, setColumnCount] = useState(4);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId: string } | null>(null);
  const [folderSubmenuOpen, setFolderSubmenuOpen] = useState(false);
  const lastClickedId = useRef<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  // Close context menu on click anywhere
  useEffect(() => {
    const handler = () => {
      setContextMenu(null);
      setFolderSubmenuOpen(false);
    };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  // Calculate columns based on container width
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const gap = 16;
        const cols = Math.max(1, Math.floor((width + gap) / (gridSize + gap)));
        setColumnCount(cols);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [gridSize]);

  const rowCount = Math.ceil(items.length / columnCount);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => gridSize + 50, // thumbnail + filename + padding
    overscan: 5,
  });

  const handleClick = useCallback(
    (e: React.MouseEvent, itemId: string) => {
      if (e.shiftKey && lastClickedId.current) {
        selectRange(lastClickedId.current, itemId);
      } else if (e.ctrlKey || e.metaKey) {
        toggleSelect(itemId);
        lastClickedId.current = itemId;
      } else {
        clearSelection();
        toggleSelect(itemId);
        lastClickedId.current = itemId;
      }
    },
    [toggleSelect, selectRange, clearSelection],
  );

  const handleDoubleClick = useCallback(
    (itemId: string) => {
      openViewer(itemId);
    },
    [openViewer],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, itemId: string) => {
      e.preventDefault();
      // If item not selected, select it
      if (!selectedIds.has(itemId)) {
        clearSelection();
        toggleSelect(itemId);
        lastClickedId.current = itemId;
      }
      setContextMenu({ x: e.clientX, y: e.clientY, itemId });
    },
    [selectedIds, clearSelection, toggleSelect],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, itemId: string) => {
      const ids = selectedIds.size > 0 ? Array.from(selectedIds) : [itemId];
      e.dataTransfer.setData('application/x-item-ids', JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'copy';
    },
    [selectedIds],
  );

  const handleAddToFolder = async (folderId: string) => {
    const ids = contextMenu
      ? (selectedIds.size > 0 ? Array.from(selectedIds) : [contextMenu.itemId])
      : [];
    if (ids.length > 0) {
      await addItems(folderId, ids);
    }
    setContextMenu(null);
    setFolderSubmenuOpen(false);
  };

  const handleCreateAndAdd = async () => {
    const folder = await createFolder(nextDefaultFolderName());
    const ids = contextMenu
      ? (selectedIds.size > 0 ? Array.from(selectedIds) : [contextMenu.itemId])
      : [];
    if (ids.length > 0) {
      await addItems(folder.id, ids);
    }
    setContextMenu(null);
    setFolderSubmenuOpen(false);
  };

  // Items targeted by the current context-menu action.
  const contextTargetIds = (): string[] =>
    contextMenu ? (selectedIds.size > 0 ? Array.from(selectedIds) : [contextMenu.itemId]) : [];

  const handleMoveToTrash = async () => {
    const ids = contextTargetIds();
    setContextMenu(null);
    if (activeLibraryId && ids.length > 0) {
      await deleteItems(activeLibraryId, ids, false);
    }
  };

  const handleRestore = async () => {
    const ids = contextTargetIds();
    setContextMenu(null);
    if (activeLibraryId && ids.length > 0) {
      await restoreItems(activeLibraryId, ids);
    }
  };

  const handleDeletePermanently = async () => {
    const ids = contextTargetIds();
    setContextMenu(null);
    if (!activeLibraryId || ids.length === 0) return;
    const ok = await ask(
      `Permanently delete ${ids.length} item${ids.length > 1 ? 's' : ''}? This cannot be undone.`,
      { title: 'Delete Permanently', kind: 'warning' },
    );
    if (ok) {
      await deleteItems(activeLibraryId, ids, true);
    }
  };

  if (!activeLibraryId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-[#999999] gap-2">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#E5E5E5] mb-2">
          <rect x="4" y="8" width="40" height="32" rx="3" />
          <circle cx="16" cy="22" r="4" />
          <path d="M4 32l10-8 8 6 8-10 14 12" />
        </svg>
        <span className="text-[17px] font-semibold text-[#1D1D1F]">Welcome to Shark</span>
        <span className="text-[13px] text-[#999999]">Create a library in the sidebar to get started.</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-white">
        <div className="h-10 border-b border-[#F0F0F0] flex items-center px-4 gap-4 text-[12px] text-[#666666] shrink-0">
          <div className="flex items-center gap-1 hover:text-[#1D1D1F] cursor-pointer">
            <span>Date Added</span>
            <ChevronDown size={14} />
          </div>
          <div className="flex items-center gap-1 hover:text-[#1D1D1F] cursor-pointer">
            <span>Types</span>
            <ChevronDown size={14} />
          </div>
          <div className="flex items-center gap-1 hover:text-[#1D1D1F] cursor-pointer">
            <span>Tags</span>
            <ChevronDown size={14} />
          </div>
        </div>
        <div ref={parentRef} className="flex-1 flex items-center justify-center text-[#999999] text-[13px]">
          No items yet. Click + to import files.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Filter Bar */}
      <div className="h-10 border-b border-[#F0F0F0] flex items-center px-4 gap-4 text-[12px] text-[#666666] shrink-0">
        <div className="flex items-center gap-1 hover:text-[#1D1D1F] cursor-pointer">
          <span>Date Added</span>
          <ChevronDown size={14} />
        </div>
        <div className="flex items-center gap-1 hover:text-[#1D1D1F] cursor-pointer">
          <span>Types</span>
          <ChevronDown size={14} />
        </div>
        <div className="flex items-center gap-1 hover:text-[#1D1D1F] cursor-pointer">
          <span>Tags</span>
          <ChevronDown size={14} />
        </div>
      </div>

      {/* Grid */}
      <div ref={parentRef} className="flex-1 overflow-y-auto p-4">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const startIdx = virtualRow.index * columnCount;
            const rowItems = items.slice(startIdx, startIdx + columnCount);

            return (
              <div
                key={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="flex gap-4 px-0"
              >
                {rowItems.map((item) => (
                  <AssetCard
                    key={item.id}
                    item={item}
                    size={gridSize}
                    selected={selectedIds.has(item.id)}
                    thumbnailPath={thumbnailPaths[item.id]}
                    onClick={(e) => handleClick(e, item.id)}
                    onDoubleClick={() => handleDoubleClick(item.id)}
                    onContextMenu={(e) => handleContextMenu(e, item.id)}
                    onDragStart={(e) => handleDragStart(e, item.id)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Grid item context menu */}
      {contextMenu && (
        <div
          className="fixed bg-white border border-[#E5E5E5] rounded-lg shadow-lg z-50 py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="relative"
            onMouseEnter={() => setFolderSubmenuOpen(true)}
            onMouseLeave={() => setFolderSubmenuOpen(false)}
          >
            <button className="flex items-center justify-between w-full text-left px-3 py-1.5 text-[13px] text-[#333333] hover:bg-[#F0F0F0]">
              <span className="flex items-center gap-2">
                <FolderPlus size={14} />
                Add to Folder
              </span>
              <span className="text-[#999999] text-[11px]">&#9654;</span>
            </button>
            {folderSubmenuOpen && (
              <div className="absolute left-full top-0 bg-white border border-[#E5E5E5] rounded-lg shadow-lg z-50 py-1 min-w-[150px]">
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => handleAddToFolder(folder.id)}
                    className="block w-full text-left px-3 py-1 text-[13px] text-[#333333] hover:bg-[#F0F0F0]"
                  >
                    {folder.name}
                  </button>
                ))}
                {folders.length > 0 && <div className="border-t border-[#E5E5E5] my-1" />}
                <button
                  onClick={handleCreateAndAdd}
                  className="flex items-center gap-2 w-full text-left px-3 py-1 text-[13px] text-[#0063E1] hover:bg-[#F0F0F0]"
                >
                  <Plus size={14} />
                  New Folder...
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-[#E5E5E5] my-1" />

          {activeView === 'trash' ? (
            <>
              <button
                onClick={handleRestore}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[13px] text-[#333333] hover:bg-[#F0F0F0]"
              >
                <RotateCcw size={14} />
                Restore
              </button>
              <button
                onClick={handleDeletePermanently}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[13px] text-[#FF3B30] hover:bg-[#F0F0F0]"
              >
                <Trash2 size={14} />
                Delete Permanently
              </button>
            </>
          ) : (
            <button
              onClick={handleMoveToTrash}
              className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[13px] text-[#FF3B30] hover:bg-[#F0F0F0]"
            >
              <Trash2 size={14} />
              Move to Trash
            </button>
          )}
        </div>
      )}
    </div>
  );
}
