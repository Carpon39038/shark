import { useRef, useEffect, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useItemStore } from '@/stores/itemStore';
import { useViewStore } from '@/stores/viewStore';
import { useUiStore } from '@/stores/uiStore';
import { AssetCard } from './AssetCard';

export function VirtualGrid() {
  const { items, selectedIds, toggleSelect, selectRange, clearSelection } = useItemStore();
  const gridSize = useViewStore((s) => s.gridSize);
  const openViewer = useUiStore((s) => s.openViewer);
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
        const gap = 8;
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
    estimateSize: () => gridSize + 32, // thumbnail + filename
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

  if (items.length === 0) {
    return (
      <div ref={parentRef} className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
        No items. Import a folder to get started.
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto">
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
              className="flex gap-2 px-3"
            >
              {rowItems.map((item) => (
                <AssetCard
                  key={item.id}
                  item={item}
                  size={gridSize}
                  selected={selectedIds.has(item.id)}
                  onClick={(e) => handleClick(e, item.id)}
                  onDoubleClick={() => handleDoubleClick(item.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
