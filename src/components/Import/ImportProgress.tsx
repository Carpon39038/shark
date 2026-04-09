import { useUiStore } from '@/stores/uiStore';

export function ImportProgress() {
  const { importing, importProgress } = useUiStore();

  if (!importing) return null;

  const current = importProgress?.current ?? 0;
  const total = importProgress?.total ?? 0;
  const pct = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2.5 z-50 shadow-lg">
      <div className="flex items-center gap-3">
        <span className="text-[13px] text-[#333333] whitespace-nowrap">
          Importing…
        </span>
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#0063E1] rounded-full transition-all duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[11px] text-[#999999] tabular-nums whitespace-nowrap">
          {current}/{total}
        </span>
      </div>
    </div>
  );
}
