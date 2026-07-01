import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Folder, FolderCount } from '@/lib/types';
import { useUiStore } from './uiStore';

interface FolderState {
  folders: Folder[];
  itemCounts: Record<string, number>;
  loading: boolean;
}

interface FolderActions {
  fetchFolders: () => Promise<void>;
  create: (name: string, parentId?: string | null) => Promise<Folder>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  move: (id: string, parentId: string | null, sortOrder?: number) => Promise<void>;
  addItems: (folderId: string, itemIds: string[]) => Promise<void>;
  removeItems: (folderId: string, itemIds: string[]) => Promise<void>;
  getItemCount: (folderId: string) => number;
  /**
   * Default name for a new folder: the lowest "New Folder N" (N >= 1) not
   * already taken. Unlike `length + 1`, this never collides after a delete.
   */
  nextDefaultFolderName: () => string;
}

export const useFolderStore = create<FolderState & FolderActions>()(
  (set, get) => ({
    folders: [],
    itemCounts: {},
    loading: false,

    fetchFolders: async () => {
      set({ loading: true });
      try {
        const [folders, counts] = await Promise.all([
          invoke<Folder[]>('get_folders', { libraryId: '' }),
          invoke<FolderCount[]>('get_folder_item_counts'),
        ]);
        const itemCounts: Record<string, number> = {};
        for (const c of counts) {
          itemCounts[c.folder_id] = c.count;
        }
        set({ folders, itemCounts });
      } catch (e) {
        useUiStore.getState().setError(String(e));
      } finally {
        set({ loading: false });
      }
    },

    create: async (name, parentId = null) => {
      const folder = await invoke<Folder>('create_folder', { name, parentId });
      await get().fetchFolders();
      return folder;
    },

    rename: async (id, name) => {
      await invoke('rename_folder', { id, name });
      await get().fetchFolders();
    },

    remove: async (id) => {
      await invoke('delete_folder', { id });
      await get().fetchFolders();
    },

    move: async (id, parentId, sortOrder) => {
      await invoke('move_folder', { id, parentId, sortOrder });
      await get().fetchFolders();
    },

    addItems: async (folderId, itemIds) => {
      await invoke('add_items_to_folder', { folderId, itemIds });
      await get().fetchFolders();
    },

    removeItems: async (folderId, itemIds) => {
      await invoke('remove_items_from_folder', { folderId, itemIds });
      await get().fetchFolders();
    },

    getItemCount: (folderId: string) => {
      return get().itemCounts[folderId] ?? 0;
    },

    nextDefaultFolderName: () => {
      const taken = new Set(get().folders.map((f) => f.name));
      let n = 1;
      while (taken.has(`New Folder ${n}`)) n += 1;
      return `New Folder ${n}`;
    },
  }),
);
