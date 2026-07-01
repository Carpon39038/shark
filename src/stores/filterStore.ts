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
  /** Select a regular folder (sets activeView to 'folder'). */
  selectFolder: (folderId: string | null) => void;
  /** Select one of the special views (All / Uncategorized / Untagged / Trash). */
  selectSpecialView: (view: SpecialView) => void;
  resetFilters: () => void;
  /** Build the ItemFilter for the current activeView (view membership only). */
  buildItemFilter: () => ItemFilter;
  /**
   * Build the complete ItemFilter for the active view, including the
   * cross-view refinements (tag, rating floor, file types). This is what
   * actually populates the grid, so it's what any reload must reproduce.
   */
  buildFullItemFilter: () => ItemFilter;
}

const initialState: FilterState = {
  sortBy: 'created_at',
  sortOrder: 'desc',
  searchQuery: '',
  fileTypes: [],
  ratingMin: null,
  smartFolderId: null,
  selectedTag: null,
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

      selectFolder: (folderId) =>
        set({ activeView: 'folder', selectedFolderId: folderId, smartFolderId: null, selectedTag: null }),

      selectSpecialView: (view) =>
        set({ activeView: view, selectedFolderId: null, smartFolderId: null, selectedTag: null }),

      resetFilters: () => set(initialState),

      buildItemFilter: () => {
        const { activeView, selectedFolderId } = get();
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
      },

      buildFullItemFilter: () => {
        const { fileTypes, ratingMin, selectedTag } = get();
        return {
          ...get().buildItemFilter(),
          ...(fileTypes.length > 0 && { file_types: fileTypes }),
          ...(ratingMin != null && { rating_min: ratingMin }),
          ...(selectedTag && { tag: selectedTag }),
        };
      },
    }),
    {
      name: 'shark-filter-store',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
