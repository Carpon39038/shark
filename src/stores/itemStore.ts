import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Item, ItemFilter, SortSpec, Pagination, ItemPage } from '@/lib/types';

interface ItemState {
  items: Item[];
  selectedIds: Set<string>;
  loading: boolean;
  total: number;
  thumbnailPaths: Record<string, string>;
}

interface ItemActions {
  setItems: (items: Item[], total: number) => void;
  addItem: (item: Item, thumbnailPath?: string) => void;
  toggleSelect: (id: string) => void;
  selectRange: (fromId: string, toId: string, append?: boolean) => void;
  clearSelection: () => void;
  setLoading: (loading: boolean) => void;
  loadItems: (
    libraryId: string,
    filter: ItemFilter,
    sort: SortSpec,
    page: Pagination,
  ) => Promise<void>;
  loadThumbnails: (itemIds: string[]) => Promise<void>;
}

export const useItemStore = create<ItemState & ItemActions>()((set, get) => ({
  items: [],
  selectedIds: new Set<string>(),
  loading: false,
  total: 0,
  thumbnailPaths: {},

  setItems: (items, total) =>
    set({ items, total, selectedIds: new Set<string>() }),

  addItem: (item, thumbnailPath) =>
    set((state) => ({
      items: [item, ...state.items],
      total: state.total + 1,
      thumbnailPaths: thumbnailPath
        ? { ...state.thumbnailPaths, [item.id]: thumbnailPath }
        : state.thumbnailPaths,
    })),

  toggleSelect: (id) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedIds: next };
    }),

  selectRange: (fromId, toId, append = false) => {
    const { items, selectedIds } = get();
    const fromIndex = items.findIndex((item) => item.id === fromId);
    const toIndex = items.findIndex((item) => item.id === toId);
    if (fromIndex === -1 || toIndex === -1) return;

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const rangeIds = items.slice(start, end + 1).map((item) => item.id);

    if (append) {
      const next = new Set(selectedIds);
      for (const id of rangeIds) {
        next.add(id);
      }
      set({ selectedIds: next });
    } else {
      set({ selectedIds: new Set(rangeIds) });
    }
  },

  clearSelection: () => set({ selectedIds: new Set<string>() }),

  setLoading: (loading) => set({ loading }),

  loadItems: async (libraryId, filter, sort, page) => {
    set({ loading: true });
    try {
      const result = await invoke<ItemPage>('query_items', {
        libraryId,
        filter,
        sort,
        page,
      });
      set({
        items: result.items,
        total: result.total,
        selectedIds: new Set<string>(),
      });
      // Load thumbnails for the new items
      const ids = result.items.map((i) => i.id);
      if (ids.length > 0) {
        get().loadThumbnails(ids);
      }
    } finally {
      set({ loading: false });
    }
  },

  loadThumbnails: async (itemIds) => {
    const { activeLibraryId } = await import('./libraryStore').then((m) => m.useLibraryStore.getState());
    if (!activeLibraryId) return;
    try {
      const map = await invoke<Record<string, string>>('get_thumbnails_batch', {
        itemIds,
        size: 'S256',
      });
      set((state) => ({ thumbnailPaths: { ...state.thumbnailPaths, ...map } }));
    } catch {
      // Thumbnails not yet generated — fall back to original file
    }
  },
}));
