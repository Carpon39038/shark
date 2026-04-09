import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

interface CreateLibraryModalProps {
  onSubmit: (name: string, path: string) => Promise<void>;
  onClose: () => void;
}

export function CreateLibraryModal({ onSubmit, onClose }: CreateLibraryModalProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChooseFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      setPath(selected);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;

    setCreating(true);
    setError(null);
    try {
      await onSubmit(name.trim(), path.trim());
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={onClose}>
      <form
        className="bg-white rounded-lg p-5 w-96 shadow-xl border border-gray-200"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2 className="text-base font-semibold mb-4 text-gray-800">New Library</h2>

        <label className="block text-sm text-gray-500 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Library"
          autoFocus
          className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded text-sm text-gray-800 focus:border-blue-500 focus:outline-none mb-3"
        />

        <label className="block text-sm text-gray-500 mb-1">Location</label>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/to/library"
            className="flex-1 px-2.5 py-1.5 bg-white border border-gray-200 rounded text-sm text-gray-800 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleChooseFolder}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm border border-gray-200 transition-colors"
          >
            Browse
          </button>
        </div>

        {error && (
          <p className="text-red-500 text-xs mb-3">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || !path.trim() || creating}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-medium text-white transition-colors"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
