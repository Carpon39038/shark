import { useUiStore } from '@/stores/uiStore';

export function SidebarDropZone() {
  const isDragOver = useUiStore((s) => s.isDragOver);

  return (
    <div
      className={`mt-auto mx-1 mb-1 rounded-lg border-2 border-dashed p-3 text-center transition-colors ${
        isDragOver
          ? 'border-[#0063E1] bg-[#EBF5FF] text-[#0063E1]'
          : 'border-[#E5E5E5] text-[#999999]'
      }`}
    >
      <svg
        className={`w-5 h-5 mx-auto mb-1 ${isDragOver ? 'text-[#0063E1]' : 'text-[#E5E5E5]'}`}
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
      <span className="text-[11px]">Drop files to import</span>
    </div>
  );
}
