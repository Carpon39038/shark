import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { AutoImportConfig } from '@/lib/types';
import { useUiStore } from './uiStore';
import { useLibraryStore } from './libraryStore';

interface WatchedFolderState {
  path: string | null;
  enabled: boolean;
  loading: boolean;
}

interface WatchedFolderActions {
  /** Load the active library's auto-import config. */
  fetch: () => Promise<void>;
  /** Set (and enable) the watched folder. Throws on invalid path so the caller
   *  can surface the message inline. */
  setFolder: (path: string) => Promise<void>;
  /** Enable/disable watching without changing the folder. */
  toggle: (enabled: boolean) => Promise<void>;
  /** Clear the watched folder entirely. */
  clear: () => Promise<void>;
}

const activeLibraryId = () => useLibraryStore.getState().activeLibraryId ?? '';

export const useWatchedFolderStore = create<WatchedFolderState & WatchedFolderActions>()(
  (set) => ({
    path: null,
    enabled: false,
    loading: false,

    fetch: async () => {
      set({ loading: true });
      try {
        const cfg = await invoke<AutoImportConfig>('get_auto_import');
        set({ path: cfg.path, enabled: cfg.enabled });
      } catch (e) {
        // No active library yet is a benign case; only surface real errors.
        set({ path: null, enabled: false });
        console.error('Failed to load auto-import config:', e);
      } finally {
        set({ loading: false });
      }
    },

    setFolder: async (path) => {
      const cfg = await invoke<AutoImportConfig>('set_auto_import', {
        path,
        libraryId: activeLibraryId(),
      });
      set({ path: cfg.path, enabled: cfg.enabled });
    },

    toggle: async (enabled) => {
      try {
        const cfg = await invoke<AutoImportConfig>('toggle_auto_import', {
          enabled,
          libraryId: activeLibraryId(),
        });
        set({ path: cfg.path, enabled: cfg.enabled });
      } catch (e) {
        useUiStore.getState().setError(String(e));
      }
    },

    clear: async () => {
      try {
        await invoke('clear_auto_import');
        set({ path: null, enabled: false });
      } catch (e) {
        useUiStore.getState().setError(String(e));
      }
    },
  }),
);
