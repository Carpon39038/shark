import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { X } from 'lucide-react';
import { useWatchedFolderStore } from '@/stores/watchedFolderStore';
import { useLibraryStore } from '@/stores/libraryStore';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const { path, enabled, fetch, setFolder, toggle, clear } = useWatchedFolderStore();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const handleChooseFolder = async () => {
    setError(null);
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== 'string') return;
    setBusy(true);
    try {
      await setFolder(selected);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async () => {
    setError(null);
    setBusy(true);
    try {
      await toggle(!enabled);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setError(null);
    setBusy(true);
    try {
      await clear();
    } finally {
      setBusy(false);
    }
  };

  const noLibrary = !activeLibraryId;

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-lg p-5 w-[28rem] shadow-xl border border-[#E5E5E5]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#1D1D1F]">设置</h2>
          <button
            onClick={onClose}
            className="p-1 text-[#999999] hover:text-[#333333] rounded-md hover:bg-gray-100 transition-colors duration-150"
          >
            <X size={16} />
          </button>
        </div>

        <section>
          <h3 className="text-[13px] font-semibold text-[#1D1D1F] mb-1">自动导入</h3>
          <p className="text-[12px] text-[#666666] mb-3 leading-relaxed">
            开启后，Shark 会监视指定文件夹；把文件拖进该文件夹，就会自动导入到当前素材库。
          </p>

          {noLibrary ? (
            <p className="text-[12px] text-[#999999]">请先选择一个素材库。</p>
          ) : (
            <>
              <label className="block text-[13px] text-[#666666] mb-1">监视的文件夹</label>
              <div className="flex gap-2 mb-3">
                <div className="flex-1 min-w-0 px-2.5 py-1.5 bg-[#F6F6F6] border border-[#E5E5E5] rounded-md text-[13px] text-[#333333] truncate">
                  {path || <span className="text-[#999999]">未设置</span>}
                </div>
                <button
                  type="button"
                  onClick={handleChooseFolder}
                  disabled={busy}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-md text-[13px] font-medium border border-[#E5E5E5] text-[#333333] transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  选择…
                </button>
              </div>

              {path && (
                <div className="flex items-center justify-between mb-3">
                  <label className="flex items-center gap-2 text-[13px] text-[#333333] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={handleToggle}
                      disabled={busy}
                      className="accent-[#0063E1] w-4 h-4"
                    />
                    启用自动导入
                  </label>
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={busy}
                    className="text-[12px] text-[#FF3B30] hover:underline transition-colors duration-150 disabled:opacity-40"
                  >
                    清除
                  </button>
                </div>
              )}

              {error && <p className="text-[#FF3B30] text-[11px] mb-1">{error}</p>}
            </>
          )}
        </section>

        <div className="flex justify-end mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#0063E1] hover:bg-[#0052CC] active:bg-[#003FA3] rounded-md text-[13px] font-medium text-white transition-colors duration-150"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
