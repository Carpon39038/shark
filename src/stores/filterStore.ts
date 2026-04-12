import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface FilterState {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  searchQuery: string;
  fileTypes: string[];
  ratingMin: number | null;
  smartFolderId: string | null;
  selectedTag: string | null;
}

interface FilterActions {
  setSortBy: (field: string) => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  setSearchQuery: (query: string) => void;
  setFileTypes: (types: string[]) => void;
  setRatingMin: (rating: number | null) => void;
  setSmartFolderId: (id: string | null) => void;
  setSelectedTag: (tag: string | null) => void;
  resetFilters: () => void;
}

const initialState: FilterState = {
  sortBy: 'created_at',
  sortOrder: 'desc',
  searchQuery: '',
  fileTypes: [],
  ratingMin: null,
  smartFolderId: null,
  selectedTag: null,
};

export const useFilterStore = create<FilterState & FilterActions>()(
  persist(
    (set) => ({
      ...initialState,

      setSortBy: (field) => set({ sortBy: field }),

      setSortOrder: (order) => set({ sortOrder: order }),

      setSearchQuery: (query) => set({ searchQuery: query }),

      setFileTypes: (types) => set({ fileTypes: types }),

      setRatingMin: (rating) => set({ ratingMin: rating }),

      setSmartFolderId: (id) => set({ smartFolderId: id }),

      setSelectedTag: (tag) => set({ selectedTag: tag }),

      resetFilters: () => set(initialState),
    }),
    {
      name: 'shark-filter-store',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
