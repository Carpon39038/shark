import { useCallback } from 'react';
import { ArrowDownNarrowWide, ArrowUpWideNarrow } from 'lucide-react';
import { useFilterStore } from '@/stores/filterStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useItemStore } from '@/stores/itemStore';
import { Select } from '@/components/ui/Select';

/** Sort fields supported by the backend query whitelist (db.rs). */
const SORT_FIELDS: { value: string; label: string }[] = [
  { value: 'created_at', label: '导入时间' },
  { value: 'modified_at', label: '修改时间' },
  { value: 'file_name', label: '文件名' },
  { value: 'file_size', label: '文件大小' },
  { value: 'rating', label: '评分' },
];

export function SortControl() {
  const { sortBy, sortOrder, setSortBy, setSortOrder } = useFilterStore();
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const reloadCurrentView = useItemStore((s) => s.reloadCurrentView);

  const reload = useCallback(() => {
    if (activeLibraryId) reloadCurrentView(activeLibraryId);
  }, [activeLibraryId, reloadCurrentView]);

  const handleFieldChange = useCallback(
    (field: string) => {
      setSortBy(field);
      reload();
    },
    [setSortBy, reload],
  );

  const handleToggleOrder = useCallback(() => {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    reload();
  }, [sortOrder, setSortOrder, reload]);

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={sortBy}
        onChange={(e) => handleFieldChange(e.target.value)}
        options={SORT_FIELDS}
        className="w-28 py-1"
        aria-label="排序方式"
      />
      <button
        onClick={handleToggleOrder}
        title={sortOrder === 'asc' ? '升序' : '降序'}
        aria-label={sortOrder === 'asc' ? '升序，点击切换为降序' : '降序，点击切换为升序'}
        className="p-1.5 text-[#666666] hover:bg-[#ECECEC] rounded-md transition-colors duration-150"
      >
        {sortOrder === 'asc' ? (
          <ArrowUpWideNarrow size={16} />
        ) : (
          <ArrowDownNarrowWide size={16} />
        )}
      </button>
    </div>
  );
}
