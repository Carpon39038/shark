import { create } from 'zustand';
import type { DuplicateInfo, DedupAction } from '@/lib/types';

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
  dedupActive: boolean;
  dedupItems: DuplicateInfo[];
  dedupCurrentIndex: number;
  dedupApplyAll: boolean;
  dedupApplyAllAction: DedupAction | null;
  dedupDecisions: Record<string, DedupAction>;
  dedupSourcePath: string | null;
}

interface UiActions {
  openViewer: (itemId: string) => void;
  closeViewer: () => void;
  setContextMenu: (menu: ContextMenu) => void;
  clearContextMenu: () => void;
  setImporting: (importing: boolean) => void;
  setImportProgress: (progress: ImportProgress | null) => void;
  setError: (msg: string | null) => void;
  showDedupDialog: (items: DuplicateInfo[], sourcePath: string) => void;
  dismissDedupDialog: () => void;
  nextDedupItem: () => void;
  setDedupApplyAll: (action: DedupAction) => void;
  setDedupDecision: (sourcePath: string, action: DedupAction) => void;
}

export const useUiStore = create<UiState & UiActions>()((set) => ({
  viewerOpen: false,
  viewerItemId: null,
  contextMenu: null,
  importing: false,
  importProgress: null,
  error: null,
  dedupActive: false,
  dedupItems: [],
  dedupCurrentIndex: 0,
  dedupApplyAll: false,
  dedupApplyAllAction: null,
  dedupDecisions: {},
  dedupSourcePath: null,

  openViewer: (itemId) =>
    set({ viewerOpen: true, viewerItemId: itemId }),

  closeViewer: () =>
    set({ viewerOpen: false, viewerItemId: null }),

  setContextMenu: (menu) => set({ contextMenu: menu }),

  clearContextMenu: () => set({ contextMenu: null }),

  setImporting: (importing) => set({ importing }),

  setImportProgress: (progress) => set({ importProgress: progress }),

  setError: (msg) => set({ error: msg }),

  showDedupDialog: (items, sourcePath) =>
    set({
      dedupActive: true,
      dedupItems: items,
      dedupCurrentIndex: 0,
      dedupApplyAll: false,
      dedupApplyAllAction: null,
      dedupDecisions: {},
      dedupSourcePath: sourcePath,
    }),

  dismissDedupDialog: () =>
    set({
      dedupActive: false,
      dedupItems: [],
      dedupCurrentIndex: 0,
      dedupApplyAll: false,
      dedupApplyAllAction: null,
      dedupDecisions: {},
      dedupSourcePath: null,
    }),

  nextDedupItem: () =>
    set((state) => ({
      dedupCurrentIndex: state.dedupCurrentIndex + 1,
    })),

  setDedupApplyAll: (action) =>
    set({ dedupApplyAll: true, dedupApplyAllAction: action }),

  setDedupDecision: (sourcePath, action) =>
    set((state) => ({
      dedupDecisions: { ...state.dedupDecisions, [sourcePath]: action },
    })),
}));
