import { useUiStore } from '@/stores/uiStore';

export function ImportProgress() {
  const importing = useUiStore((s) => s.importing);

  if (!importing) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-neutral-800 rounded-lg px-6 py-4 flex items-center gap-3 shadow-xl">
        <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Importing files...</span>
      </div>
    </div>
  );
}
