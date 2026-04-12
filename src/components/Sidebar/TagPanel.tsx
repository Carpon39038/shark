import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Tag } from 'lucide-react';
import { useFilterStore } from '@/stores/filterStore';
import { useLibraryStore } from '@/stores/libraryStore';
import type { TagCount } from '@/lib/types';

export function TagPanel() {
  const { selectedTag, setSelectedTag } = useFilterStore();
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId);
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTagCounts();
  }, [activeLibraryId]);

  const loadTagCounts = async () => {
    if (!activeLibraryId) return;
    try {
      const counts = await invoke<TagCount[]>('get_tag_counts', {
        libraryId: activeLibraryId,
      });
      setTagCounts(counts);
    } catch (e) {
      console.error('Failed to load tag counts:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleTagClick = (tag: string) => {
    setSelectedTag(selectedTag === tag ? null : tag);
  };

  if (loading) {
    return (
      <div className="py-3 px-1">
        <div className="text-[11px] font-semibold text-[#999999] uppercase tracking-wider mb-2 px-2">
          Tags
        </div>
        <div className="px-2 text-[11px] text-[#999999]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="py-3 px-1">
      <div className="flex items-center justify-between px-2 mb-2">
        <div className="text-[11px] font-semibold text-[#999999] uppercase tracking-wider">
          Tags
        </div>
        {selectedTag && (
          <button
            onClick={() => setSelectedTag(null)}
            className="text-[10px] text-[#0063E1] hover:underline"
          >
            Clear
          </button>
        )}
      </div>
      {tagCounts.length === 0 ? (
        <div className="px-2 text-[11px] text-[#999999]">
          No tags yet. Add tags in the Inspector panel.
        </div>
      ) : (
        <div className="space-y-0.5 max-h-48 overflow-y-auto">
          {tagCounts.map(({ tag, count }) => (
            <button
              key={tag}
              onClick={() => handleTagClick(tag)}
              className={`w-full flex items-center justify-between px-2 py-1 rounded text-[12px] transition-colors ${
                selectedTag === tag
                  ? 'bg-[#EBF5FF] text-[#0063E1]'
                  : 'text-[#333333] hover:bg-[#ECECEC]'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Tag size={11} className="shrink-0" />
                <span className="truncate">{tag}</span>
              </div>
              <span className={`text-[11px] shrink-0 ${selectedTag === tag ? 'text-[#0063E1]/70' : 'text-[#999999]'}`}>
                {count}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
