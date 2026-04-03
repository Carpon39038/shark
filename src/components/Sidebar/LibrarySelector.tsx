import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '@/stores/libraryStore';
import { useItemStore } from '@/stores/itemStore';
import type { Library } from '@/lib/types';

export function LibrarySelector() {
  const { libraries, activeLibraryId, setLibraries, setActiveLibrary } = useLibraryStore();
  const loadItems = useItemStore((s) => s.loadItems);

  useEffect(() => {
    invoke<Library[]>('list_libraries').then(setLibraries).catch(() => {});
  }, [setLibraries]);

  const handleCreate = async () => {
    const name = prompt('Library name:');
    if (!name) return;
    const path = prompt('Library path:');
    if (!path) return;

    const lib = await invoke<Library>('create_library', { name, path });
    setLibraries([...libraries, lib]);
    setActiveLibrary(lib.id);
  };

  const handleSelect = (id: string) => {
    setActiveLibrary(id);
    invoke('open_library', { path: libraries.find((l) => l.id === id)?.path }).catch(() => {});
    loadItems(id, {}, { field: 'created_at', direction: 'desc' }, { page: 0, page_size: 100 });
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
        onClick={handleCreate}
        className="mt-1.5 w-full text-xs text-blue-400 hover:text-blue-300 text-left px-1"
      >
        + New Library
      </button>
    </div>
  );
}
