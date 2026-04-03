import { useEffect, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useUiStore } from '@/stores/uiStore';
import { useItemStore } from '@/stores/itemStore';

export function ImageViewer() {
  const { viewerOpen, viewerItemId, closeViewer } = useUiStore();
  const items = useItemStore((s) => s.items);

  const currentIndex = items.findIndex((item) => item.id === viewerItemId);
  const item = currentIndex >= 0 ? items[currentIndex] : null;

  const navigate = useCallback(
    (direction: 1 | -1) => {
      const nextIndex = currentIndex + direction;
      if (nextIndex >= 0 && nextIndex < items.length) {
        useUiStore.getState().openViewer(items[nextIndex].id);
      }
    },
    [currentIndex, items],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!viewerOpen) return;
      if (e.key === 'Escape') closeViewer();
      if (e.key === 'ArrowLeft') navigate(-1);
      if (e.key === 'ArrowRight') navigate(1);
    },
    [viewerOpen, closeViewer, navigate],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!viewerOpen || !item) return null;

  const src = convertFileSrc(item.file_path);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center"
      onClick={closeViewer}
    >
      <img
        src={src}
        alt={item.file_name}
        className="max-w-[90vw] max-h-[85vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between">
        <span className="text-sm text-neutral-300 truncate">{item.file_name}</span>
        <span className="text-xs text-neutral-500">
          {item.width && item.height ? `${item.width} x ${item.height}` : ''}
          {currentIndex >= 0 && ` | ${currentIndex + 1} / ${items.length}`}
        </span>
      </div>
      {currentIndex > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(-1);
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="white">
            <path d="M12 4l-6 6 6 6" stroke="white" strokeWidth="2" fill="none" />
          </svg>
        </button>
      )}
      {currentIndex < items.length - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(1);
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="white">
            <path d="M8 4l6 6-6 6" stroke="white" strokeWidth="2" fill="none" />
          </svg>
        </button>
      )}
    </div>
  );
}
