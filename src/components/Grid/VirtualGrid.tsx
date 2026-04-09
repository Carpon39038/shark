import { useRef, useEffect, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useItemStore } from '@/stores/itemStore';
import { useViewStore } from '@/stores/viewStore';
import { useUiStore } from '@/stores/uiStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { AssetCard } from './AssetCard';
import { ChevronDown } from 'lucide-react';

export function VirtualGrid() {
  const { items, selectedIds, thumbnailPaths, toggleSelect, selectRange, clearSelection } = useItemStore();
  const gridSize = useViewStore((s) => s.gridSize);
  const openViewer = useUiStore((s) => s.openViewer);
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const [columnCount, setColumnCount] = useState(4);
  const lastClickedId = useRef<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

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
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
