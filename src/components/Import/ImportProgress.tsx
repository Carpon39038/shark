import { useUiStore } from '@/stores/uiStore';

export function ImportProgress() {
  const { importing, importProgress } = useUiStore();

  if (!importing) return null;

  const current = importProgress?.current ?? 0;
  const total = importProgress?.total ?? 0;
  const pct = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-neutral-800 border-t border-neutral-700 px-4 py-2.5 z-50">
      <div className="flex items-center gap-3">
        <span className="text-sm text-neutral-300 whitespace-nowrap">
          Importing…
        </span>
        <div className="flex-1 h-1.5 bg-neutral-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-neutral-400 tabular-nums whitespace-nowrap">
          {current}/{total}
        </span>
      </div>
    </div>
  );
}
