import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '@/stores/libraryStore';
import { useViewStore } from '@/stores/viewStore';
import { useFilterStore } from '@/stores/filterStore';
import { useUiStore } from '@/stores/uiStore';
import { useItemStore } from '@/stores/itemStore';
import { ImportButton } from '@/components/Import/ImportButton';
import type { SearchResult } from '@/lib/types';
import {
  Search, LayoutGrid, List, SlidersHorizontal,
  ChevronLeft, ChevronRight, Sidebar as SidebarIcon,
  Image as ImageIcon,
} from 'lucide-react';
import { TextInput } from '@/components/ui/TextInput';

export function Toolbar() {
  const { libraries, activeLibraryId } = useLibraryStore();
  const { toggleSidebar, gridSize, setGridSize, viewMode, setViewMode } = useViewStore();
  const { searchQuery, setSearchQuery, selectedTag, fileTypes, ratingMin } = useFilterStore();
  const { setItems, loadItems } = useItemStore();
  const activeLib = libraries.find((l) => l.id === activeLibraryId);

  // Map gridSize (100-400) to zoom slider (10-100)
  const zoom = Math.round(((gridSize - 100) / 300) * 90 + 10);
  const handleZoomChange = (z: number) => {
    const size = Math.round(((z - 10) / 90) * 300 + 100);
    setGridSize(size);
  };

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
          .catch((e) => useUiStore.getState().setError(String(e)));
      } else {
        loadItems(
          activeLibraryId,
          {
            ...(fileTypes.length > 0 && { file_types: fileTypes }),
            ...(ratingMin != null && { rating_min: ratingMin }),
            ...(selectedTag && { tag: selectedTag }),
          },
          { field: 'created_at', direction: 'desc' },
          { page: 0, page_size: 100 },
        );
      }
    },
    [activeLibraryId, setSearchQuery, setItems, loadItems, selectedTag, fileTypes, ratingMin],
  );

  return (
    <div className="h-14 border-b border-gray-200 bg-[#F6F6F6] flex items-center px-4 justify-between shrink-0">
      {/* Left: Traffic Lights & Nav */}
      <div className="flex items-center gap-6 w-64 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]" />
          <div className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]" />
          <div className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]" />
        </div>
        <div className="flex items-center gap-3 text-[#666666]">
          <SidebarIcon size={18} className="hover:text-[#1D1D1F] cursor-pointer" onClick={toggleSidebar} />
          <div className="flex items-center gap-1">
            <ChevronLeft size={20} className="text-[#999999]" />
            <ChevronRight size={20} className="text-[#999999]" />
          </div>
        </div>
      </div>

      {/* Center: View Controls */}
      <div className="flex items-center justify-center flex-1">
        <div className="flex items-center bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden">
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1 ${viewMode === 'grid' ? 'bg-gray-100 text-[#333333]' : 'text-[#666666] hover:bg-gray-50'}`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1 border-l border-[#E5E5E5] ${viewMode === 'list' ? 'bg-gray-100 text-[#333333]' : 'text-[#666666] hover:bg-gray-50'}`}
          >
            <List size={16} />
          </button>
        </div>
        <div className="mx-4 text-[13px] font-medium text-[#333333]">
          {activeLib ? activeLib.name : 'Shark'}
        </div>
        <div className="flex items-center gap-2 w-32">
          <ImageIcon size={14} className="text-[#999999]" />
          <input
            type="range"
            min="10"
            max="100"
            value={zoom}
            onChange={(e) => handleZoomChange(Number(e.target.value))}
            className="w-full accent-[#0063E1] h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <ImageIcon size={18} className="text-[#999999]" />
        </div>
      </div>

      {/* Right: Search & Actions */}
      <div className="flex items-center gap-3 w-72 justify-end shrink-0">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#999999]" />
          <TextInput
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search..."
            className="pl-8 pr-3 py-1"
          />
        </div>
        <button className="p-1.5 text-[#666666] hover:bg-[#ECECEC] rounded-md transition-colors duration-150">
          <SlidersHorizontal size={16} />
        </button>
        <ImportButton />
      </div>
    </div>
  );
}
