import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Item, ItemFilter, SortSpec, Pagination, ItemPage } from '@/lib/types';
import { useUiStore } from './uiStore';
import { useFilterStore } from './filterStore';

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
  /**
   * Select every item in the active view — the whole result set, not just the
   * loaded page. Falls back to the loaded page if the id query fails.
   */
  selectAll: () => Promise<void>;
  invertSelection: () => void;
  clearSelection: () => void;
  setLoading: (loading: boolean) => void;
  loadItems: (
    libraryId: string,
    filter: ItemFilter,
    sort: SortSpec,
    page: Pagination,
    preserveSelection?: boolean,
  ) => Promise<void>;
  loadSmartFolderItems: (
    libraryId: string,
    smartFolderId: string,
    sort: SortSpec,
    page: Pagination,
    preserveSelection?: boolean,
  ) => Promise<void>;
  loadThumbnails: (itemIds: string[]) => Promise<void>;
  updateItem: (id: string, updates: { tags?: string; rating?: number; notes?: string }) => Promise<Item | null>;
  /**
   * Reload the main grid for whatever view is currently active in filterStore.
   * With preserveSelection, selected ids that survive the reload stay selected.
   */
  reloadCurrentView: (libraryId: string, preserveSelection?: boolean) => Promise<void>;
  /** Soft-delete (to Trash) or, with permanent=true, hard-delete the given items. */
  deleteItems: (libraryId: string, ids: string[], permanent: boolean) => Promise<void>;
  /** Restore items from Trash back to active. */
  restoreItems: (libraryId: string, ids: string[]) => Promise<void>;
  /** Permanently remove every item in Trash. */
  emptyTrash: (libraryId: string) => Promise<void>;
  /** Add the given tags to every item in ids. */
  addTags: (libraryId: string, ids: string[], tags: string[]) => Promise<void>;
  /** Remove the given tags from every item in ids. */
  removeTags: (libraryId: string, ids: string[], tags: string[]) => Promise<void>;
  /** Set the rating (0-5) on every item in ids. */
  setRating: (libraryId: string, ids: string[], rating: number) => Promise<void>;
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

  selectAll: async () => {
    const filter = useFilterStore.getState();
    const sort: SortSpec = { field: filter.sortBy, direction: filter.sortOrder };
    const { activeLibraryId } = await import('./libraryStore').then((m) => m.useLibraryStore.getState());
    try {
      let ids: string[];
      if (filter.smartFolderId) {
        // Smart folders have no dedicated id-only query; pull a large page.
        const result = await invoke<ItemPage>('query_smart_folder_items', {
          id: filter.smartFolderId,
          sort,
          page: { page: 0, page_size: 100_000 } as Pagination,
        });
        ids = result.items.map((i) => i.id);
      } else {
        ids = await invoke<string[]>('query_item_ids', {
          libraryId: activeLibraryId ?? '',
          filter: filter.buildItemFilter(),
          sort,
        });
      }
      set({ selectedIds: new Set(ids) });
    } catch (e) {
      console.error('Failed to select all:', e);
      // Fall back to the loaded page so the action still does something.
      set((state) => ({ selectedIds: new Set(state.items.map((i) => i.id)) }));
    }
  },

  invertSelection: () =>
    set((state) => {
      const next = new Set<string>();
      for (const item of state.items) {
        if (!state.selectedIds.has(item.id)) next.add(item.id);
      }
      return { selectedIds: next };
    }),

  clearSelection: () => set({ selectedIds: new Set<string>() }),

  setLoading: (loading) => set({ loading }),

  loadItems: async (libraryId, filter, sort, page, preserveSelection = false) => {
    set({ loading: true });
    const prevSelected = get().selectedIds;
    try {
      const result = await invoke<ItemPage>('query_items', {
        libraryId,
        filter,
        sort,
        page,
      });
      const ids = result.items.map((i) => i.id);
      set({
        items: result.items,
        total: result.total,
        selectedIds: preserveSelection
          ? new Set(ids.filter((id) => prevSelected.has(id)))
          : new Set<string>(),
      });
      // Load thumbnails for the new items
      if (ids.length > 0) {
        get().loadThumbnails(ids);
      }
    } catch (e) {
      console.error('Failed to load items:', e);
      useUiStore.getState().setError(String(e));
    } finally {
      set({ loading: false });
    }
  },

  loadSmartFolderItems: async (_libraryId, smartFolderId, sort, page, preserveSelection = false) => {
    set({ loading: true });
    const prevSelected = get().selectedIds;
    try {
      const result = await invoke<ItemPage>('query_smart_folder_items', {
        id: smartFolderId,
        sort,
        page,
      });
      const ids = result.items.map((i) => i.id);
      set({
        items: result.items,
        total: result.total,
        selectedIds: preserveSelection
          ? new Set(ids.filter((id) => prevSelected.has(id)))
          : new Set<string>(),
      });
      if (ids.length > 0) {
        get().loadThumbnails(ids);
      }
    } catch (e) {
      console.error('Failed to load smart folder items:', e);
      useUiStore.getState().setError(String(e));
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
    } catch (e) {
      console.error('Failed to load thumbnails:', e);
    }
  },

  updateItem: async (id, updates) => {
    try {
      const updated = await invoke<Item>('update_item', {
        itemId: id,
        tags: updates.tags,
        rating: updates.rating,
        notes: updates.notes,
      });
      set((state) => ({
        items: state.items.map((i) => (i.id === id ? updated : i)),
      }));
      return updated;
    } catch (e) {
      console.error('Failed to update item:', e);
      useUiStore.getState().setError(String(e));
      return null;
    }
  },

  reloadCurrentView: async (libraryId, preserveSelection = false) => {
    const filter = useFilterStore.getState();
    const sort: SortSpec = { field: filter.sortBy, direction: filter.sortOrder };
    const page: Pagination = { page: 0, page_size: 100 };
    if (filter.smartFolderId) {
      await get().loadSmartFolderItems(libraryId, filter.smartFolderId, sort, page, preserveSelection);
    } else {
      await get().loadItems(libraryId, filter.buildItemFilter(), sort, page, preserveSelection);
    }
  },

  deleteItems: async (libraryId, ids, permanent) => {
    if (ids.length === 0) return;
    try {
      await invoke('delete_items', { itemIds: ids, permanent });
      await get().reloadCurrentView(libraryId);
    } catch (e) {
      console.error('Failed to delete items:', e);
      useUiStore.getState().setError(String(e));
    }
  },

  restoreItems: async (libraryId, ids) => {
    if (ids.length === 0) return;
    try {
      await invoke('restore_items', { itemIds: ids });
      await get().reloadCurrentView(libraryId);
    } catch (e) {
      console.error('Failed to restore items:', e);
      useUiStore.getState().setError(String(e));
    }
  },

  emptyTrash: async (libraryId) => {
    try {
      await invoke('empty_trash');
      await get().reloadCurrentView(libraryId);
    } catch (e) {
      console.error('Failed to empty trash:', e);
      useUiStore.getState().setError(String(e));
    }
  },

  addTags: async (libraryId, ids, tags) => {
    if (ids.length === 0 || tags.length === 0) return;
    try {
      await invoke('add_tags_to_items', { itemIds: ids, tags });
      // Reload rather than patch in place: in a tag/rating-filtered or Untagged
      // view the mutated items may no longer match, so patching would leave
      // stale rows on screen. preserveSelection keeps whatever still matches.
      await get().reloadCurrentView(libraryId, true);
    } catch (e) {
      console.error('Failed to add tags:', e);
      useUiStore.getState().setError(String(e));
    }
  },

  removeTags: async (libraryId, ids, tags) => {
    if (ids.length === 0 || tags.length === 0) return;
    try {
      await invoke('remove_tags_from_items', { itemIds: ids, tags });
      await get().reloadCurrentView(libraryId, true);
    } catch (e) {
      console.error('Failed to remove tags:', e);
      useUiStore.getState().setError(String(e));
    }
  },

  setRating: async (libraryId, ids, rating) => {
    if (ids.length === 0) return;
    try {
      await invoke('set_items_rating', { itemIds: ids, rating });
      await get().reloadCurrentView(libraryId, true);
    } catch (e) {
      console.error('Failed to set rating:', e);
      useUiStore.getState().setError(String(e));
    }
  },
}));
