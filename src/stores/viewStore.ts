import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface ViewState {
  gridSize: number;
  sidebarOpen: boolean;
  viewMode: 'grid' | 'list';
  inspectorOpen: boolean;
}

interface ViewActions {
  setGridSize: (size: number) => void;
  toggleSidebar: () => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  toggleInspector: () => void;
}

export const useViewStore = create<ViewState & ViewActions>()(
  persist(
    (set) => ({
      gridSize: 200,
      sidebarOpen: true,
      viewMode: 'grid' as const,
      inspectorOpen: true,

      setGridSize: (size) => set({ gridSize: size }),

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      setViewMode: (mode) => set({ viewMode: mode }),

      toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
    }),
    {
      name: 'shark-view-store',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
