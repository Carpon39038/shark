import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { TextInput } from '@/components/ui/TextInput';

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
        className="bg-white rounded-lg p-5 w-96 shadow-xl border border-[#E5E5E5]"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2 className="text-lg font-semibold mb-4 text-[#1D1D1F]">New Library</h2>

        <label className="block text-[13px] text-[#666666] mb-1">Name</label>
        <TextInput
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Library"
          autoFocus
          className="mb-3"
        />

        <label className="block text-[13px] text-[#666666] mb-1">Location</label>
        <div className="flex gap-2 mb-3">
          <TextInput
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/to/library"
            className="flex-1"
          />
          <button
            type="button"
            onClick={handleChooseFolder}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-md text-[13px] font-medium border border-[#E5E5E5] text-[#333333] transition-colors duration-150"
          >
            Browse
          </button>
        </div>

        {error && (
          <p className="text-[#FF3B30] text-[11px] mb-3">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] text-[#666666] hover:text-[#1D1D1F] transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || !path.trim() || creating}
            className="px-4 py-1.5 bg-[#0063E1] hover:bg-[#0052CC] active:bg-[#003FA3] disabled:opacity-40 disabled:cursor-not-allowed rounded-md text-[13px] font-medium text-white transition-colors duration-150"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
