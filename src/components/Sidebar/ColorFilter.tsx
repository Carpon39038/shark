import { Check } from 'lucide-react';
import { useFilterStore } from '@/stores/filterStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useItemStore } from '@/stores/itemStore';
import { COLOR_BUCKETS } from '@/lib/types';

/** Eagle-style fixed palette: click a swatch to filter the grid by that color. */
export function ColorFilter() {
  const { selectedColor, setSelectedColor } = useFilterStore();
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const reloadCurrentView = useItemStore((s) => s.reloadCurrentView);

  const apply = (next: string | null) => {
    setSelectedColor(next);
    if (activeLibraryId) reloadCurrentView(activeLibraryId);
  };

  const handleClick = (key: string) => {
    apply(selectedColor === key ? null : key);
  };

  return (
    <div className="py-3 px-1">
      <div className="flex items-center justify-between px-2 mb-2">
        <div className="text-[11px] font-semibold text-[#999999] uppercase tracking-wider">
          Colors
        </div>
        {selectedColor && (
          <button
            onClick={() => apply(null)}
            className="text-[10px] text-[#0063E1] hover:underline"
          >
            Clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-6 gap-2 px-2">
        {COLOR_BUCKETS.map(({ key, label, swatch }) => {
          const isSelected = selectedColor === key;
          // White needs a visible border on the light background.
          const needsBorder = key === 'white';
          return (
            <button
              key={key}
              onClick={() => handleClick(key)}
              title={label}
              aria-label={label}
              aria-pressed={isSelected}
              className={`relative w-6 h-6 rounded-full transition-transform hover:scale-110 ${
                isSelected ? 'ring-2 ring-[#0063E1] ring-offset-1 ring-offset-[#F6F6F6]' : ''
              } ${needsBorder ? 'border border-[#E5E5E5]' : ''}`}
              style={{ backgroundColor: swatch }}
            >
              {isSelected && (
                <Check
                  size={12}
                  strokeWidth={3}
                  className="absolute inset-0 m-auto"
                  color={key === 'white' || key === 'yellow' ? '#1D1D1F' : '#FFFFFF'}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
