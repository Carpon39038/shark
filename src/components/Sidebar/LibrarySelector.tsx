import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '@/stores/libraryStore';
import { useItemStore } from '@/stores/itemStore';
import { useUiStore } from '@/stores/uiStore';
import { CreateLibraryModal } from './CreateLibraryModal';
import type { Library } from '@/lib/types';

export function LibrarySelector() {
  const { libraries, activeLibraryId, setLibraries, setActiveLibrary, addLibrary } = useLibraryStore();
  const loadItems = useItemStore((s) => s.loadItems);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleSelect = async (id: string) => {
    setActiveLibrary(id);
    try {
      await invoke('open_library', { path: libraries.find((l) => l.id === id)?.path });
    } catch (e) {
      useUiStore.getState().setError(String(e));
      return;
    }
    loadItems(id, {}, { field: 'created_at', direction: 'desc' }, { page: 0, page_size: 100 });
  };

  useEffect(() => {
    invoke<Library[]>('list_libraries').then((libs) => {
      setLibraries(libs);
      const activeId = useLibraryStore.getState().activeLibraryId;
      if (activeId && libs.some((l) => l.id === activeId)) {
        handleSelect(activeId);
      }
    }).catch((e) => useUiStore.getState().setError(String(e)));
  }, [setLibraries]);

  const handleCreate = async (name: string, path: string) => {
    const lib = await addLibrary(name, path);
    setActiveLibrary(lib.id);
    setShowCreateModal(false);
  };

  return (
    <div className="p-2 border-b border-neutral-700">
      <select
        value={activeLibraryId ?? ''}
        onChange={(e) => handleSelect(e.target.value)}
        className="w-full bg-neutral-700 rounded px-2 py-1.5 text-sm border border-neutral-600 focus:border-blue-500 focus:outline-none"
      >
        <option value="" disabled>
          Select library
        </option>
        {libraries.map((lib) => (
          <option key={lib.id} value={lib.id}>
            {lib.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => setShowCreateModal(true)}
        className="mt-1.5 w-full text-xs text-blue-400 hover:text-blue-300 text-left px-1"
      >
        + New Library
      </button>

      {showCreateModal && (
        <CreateLibraryModal
          onSubmit={handleCreate}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
