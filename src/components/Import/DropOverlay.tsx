import { useUiStore } from '@/stores/uiStore';

export function DropOverlay() {
  const isDragOver = useUiStore((s) => s.isDragOver);

  if (!isDragOver) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-[#0063E1]/5 border-4 border-dashed border-[#0063E1]/60">
      <div className="bg-white/90 backdrop-blur-sm rounded-xl px-8 py-6 flex flex-col items-center gap-3 shadow-lg border border-[#0063E1]/30">
        <svg
          className="w-12 h-12 text-[#0063E1]"
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
        <span className="text-lg font-medium text-[#0052CC]">
          Drop to Import
        </span>
      </div>
    </div>
  );
}
