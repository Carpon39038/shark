import { useUiStore } from '@/stores/uiStore';

export function DropOverlay() {
  const isDragOver = useUiStore((s) => s.isDragOver);

  if (!isDragOver) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-blue-500/10 border-4 border-dashed border-blue-400/60">
      <div className="bg-neutral-800/90 rounded-xl px-8 py-6 flex flex-col items-center gap-3">
        <svg
          className="w-12 h-12 text-blue-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <span className="text-lg font-medium text-blue-300">
          松手导入
        </span>
      </div>
    </div>
  );
}
