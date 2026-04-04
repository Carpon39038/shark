import { create } from 'zustand';

interface ContextMenu {
  x: number;
  y: number;
  itemId: string;
}

export interface ImportProgress {
  current: number;
  total: number;
}

interface UiState {
  viewerOpen: boolean;
  viewerItemId: string | null;
  contextMenu: ContextMenu | null;
  importing: boolean;
  importProgress: ImportProgress | null;
  error: string | null;
}

interface UiActions {
  openViewer: (itemId: string) => void;
  closeViewer: () => void;
  setContextMenu: (menu: ContextMenu) => void;
  clearContextMenu: () => void;
  setImporting: (importing: boolean) => void;
  setImportProgress: (progress: ImportProgress | null) => void;
  setError: (msg: string | null) => void;
}

export const useUiStore = create<UiState & UiActions>()((set) => ({
  viewerOpen: false,
  viewerItemId: null,
  contextMenu: null,
  importing: false,
  importProgress: null,
  error: null,

  openViewer: (itemId) =>
    set({ viewerOpen: true, viewerItemId: itemId }),

  closeViewer: () =>
    set({ viewerOpen: false, viewerItemId: null }),

  setContextMenu: (menu) => set({ contextMenu: menu }),

  clearContextMenu: () => set({ contextMenu: null }),

  setImporting: (importing) => set({ importing }),

  setImportProgress: (progress) => set({ importProgress: progress }),

  setError: (msg) => set({ error: msg }),
}));
