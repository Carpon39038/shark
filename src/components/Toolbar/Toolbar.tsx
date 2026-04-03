import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '@/stores/libraryStore';
import { useViewStore } from '@/stores/viewStore';
import { useFilterStore } from '@/stores/filterStore';
import { useUiStore } from '@/stores/uiStore';
import { useItemStore } from '@/stores/itemStore';
import { ImportButton } from '@/components/Import/ImportButton';
import type { SearchResult } from '@/lib/types';

export function Toolbar() {
  const { libraries, activeLibraryId } = useLibraryStore();
  const { sidebarOpen, toggleSidebar, gridSize, setGridSize } = useViewStore();
  const { searchQuery, setSearchQuery } = useFilterStore();
  const importing = useUiStore((s) => s.importing);
  const { setItems, loadItems } = useItemStore();
  const activeLib = libraries.find((l) => l.id === activeLibraryId);

  const handleSearch = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (!activeLibraryId) return;

      if (value.trim()) {
        invoke<SearchResult[]>('search_items_cmd', {
          libraryId: activeLibraryId,
          query: value,
          limit: 100,
        })
          .then((results) => setItems(results.map((r) => r.item), results.length))
          .catch(() => {});
      } else {
        loadItems(
          activeLibraryId,
          {},
          { field: 'created_at', direction: 'desc' },
          { page: 0, page_size: 100 },
        );
      }
    },
    [activeLibraryId, setSearchQuery, setItems, loadItems],
  );

  return (
    <div className="flex items-center gap-3 h-12 px-4 bg-neutral-800 border-b border-neutral-700 shrink-0">
      <button
        onClick={toggleSidebar}
        className="p-1.5 hover:bg-neutral-700 rounded transition-colors"
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="3" width="14" height="1.5" rx="0.5" />
          <rect x="1" y="7" width="14" height="1.5" rx="0.5" />
          <rect x="1" y="11" width="14" height="1.5" rx="0.5" />
        </svg>
      </button>

      <span className="text-sm font-semibold truncate max-w-[200px]">
        {activeLib ? activeLib.name : 'Shark'}
      </span>

      <div className="flex-1" />

      <input
        type="text"
        value={searchQuery}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search..."
        className="w-48 px-2.5 py-1 bg-neutral-700 rounded text-sm border border-neutral-600 focus:border-blue-500 focus:outline-none"
      />

      <div className="flex items-center gap-1">
        <button
          onClick={() => setGridSize(Math.max(100, gridSize - 25))}
          className="p-1 hover:bg-neutral-700 rounded transition-colors"
          title="Smaller"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <rect x="1" y="1" width="5" height="5" rx="1" />
            <rect x="8" y="1" width="5" height="5" rx="1" />
            <rect x="1" y="8" width="5" height="5" rx="1" />
            <rect x="8" y="8" width="5" height="5" rx="1" />
          </svg>
        </button>
        <button
          onClick={() => setGridSize(Math.min(400, gridSize + 25))}
          className="p-1 hover:bg-neutral-700 rounded transition-colors"
          title="Larger"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <rect x="1" y="1" width="12" height="12" rx="1" />
          </svg>
        </button>
      </div>

      <ImportButton />

      {importing && (
        <span className="text-xs text-yellow-400 animate-pulse">Importing...</span>
      )}
    </div>
  );
}
