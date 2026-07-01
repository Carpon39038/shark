import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ItemFilter, SpecialView } from '@/lib/types';

interface FilterState {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  searchQuery: string;
  fileTypes: string[];
  ratingMin: number | null;
  smartFolderId: string | null;
  selectedTag: string | null;
  /** Selected palette bucket key (e.g. "red"); null = no color filter. */
  selectedColor: string | null;
  /** Which view drives the main grid. 'folder' uses selectedFolderId. */
  activeView: SpecialView;
  /** Folder id when activeView === 'folder'; null means no folder chosen. */
  selectedFolderId: string | null;
}

interface FilterActions {
  setSortBy: (field: string) => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  setSearchQuery: (query: string) => void;
  setFileTypes: (types: string[]) => void;
  setRatingMin: (rating: number | null) => void;
  setSmartFolderId: (id: string | null) => void;
  setSelectedTag: (tag: string | null) => void;
  setSelectedColor: (color: string | null) => void;
  /** Select a regular folder (sets activeView to 'folder'). */
  selectFolder: (folderId: string | null) => void;
  /** Select one of the special views (All / Uncategorized / Untagged / Trash). */
  selectSpecialView: (view: SpecialView) => void;
  resetFilters: () => void;
  /**
   * Build the complete ItemFilter for the current view — the view dimension
   * plus the secondary filters (tag, color, rating floor, file types). This is
   * what populates the grid, so it's what any reload must reproduce.
   */
  buildItemFilter: () => ItemFilter;
}

const initialState: FilterState = {
  sortBy: 'created_at',
  sortOrder: 'desc',
  searchQuery: '',
  fileTypes: [],
  ratingMin: null,
  smartFolderId: null,
  selectedTag: null,
  selectedColor: null,
  activeView: 'all',
  selectedFolderId: null,
};

export const useFilterStore = create<FilterState & FilterActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      setSortBy: (field) => set({ sortBy: field }),

      setSortOrder: (order) => set({ sortOrder: order }),

      setSearchQuery: (query) => set({ searchQuery: query }),

      setFileTypes: (types) => set({ fileTypes: types }),

      setRatingMin: (rating) => set({ ratingMin: rating }),

      setSmartFolderId: (id) => set({ smartFolderId: id }),

      setSelectedTag: (tag) => set({ selectedTag: tag }),

      setSelectedColor: (color) => set({ selectedColor: color }),

      selectFolder: (folderId) =>
        set({ activeView: 'folder', selectedFolderId: folderId, smartFolderId: null, selectedTag: null, selectedColor: null }),

      selectSpecialView: (view) =>
        set({ activeView: view, selectedFolderId: null, smartFolderId: null, selectedTag: null, selectedColor: null }),

      resetFilters: () => set(initialState),

      buildItemFilter: () => {
        const { activeView, selectedFolderId, selectedTag, selectedColor, fileTypes, ratingMin } = get();

        // View dimension.
        const filter: ItemFilter = (() => {
          switch (activeView) {
            case 'folder':
              return { folder_id: selectedFolderId };
            case 'uncategorized':
              return { no_folder: true };
            case 'untagged':
              return { no_tag: true };
            case 'trash':
              return { status: 'deleted' };
            case 'all':
            default:
              return {};
          }
        })();

        // Secondary filters apply across every view.
        if (selectedTag) filter.tag = selectedTag;
        if (selectedColor) filter.color = selectedColor;
        if (fileTypes.length > 0) filter.file_types = fileTypes;
        if (ratingMin != null) filter.rating_min = ratingMin;

        return filter;
      },
    }),
    {
      name: 'shark-filter-store',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
