import { convertFileSrc } from '@tauri-apps/api/core';
import { useItemStore } from '@/stores/itemStore';
import { Plus } from 'lucide-react';
import { TextInput, TextArea } from '@/components/ui/TextInput';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function getExt(fileName: string): string {
  return fileName.split('.').pop()?.toUpperCase() || '';
}

export function Inspector() {
  const { items, selectedIds, thumbnailPaths } = useItemStore();

  // Get the first selected item
  const selectedItemId = selectedIds.values().next().value as string | undefined;
  const item = selectedItemId ? items.find((i) => i.id === selectedItemId) ?? null : null;
  const thumbnailPath = selectedItemId ? thumbnailPaths[selectedItemId] : undefined;

  if (!item) {
    return (
      <div className="w-72 bg-[#F6F6F6] border-l border-gray-200 shrink-0 flex items-center justify-center text-[#999999] text-[13px]">
        Select an item to inspect
      </div>
    );
  }

  const src = thumbnailPath
    ? (thumbnailPath.startsWith('data:') ? thumbnailPath : convertFileSrc(thumbnailPath))
    : item.file_path.startsWith('data:') ? item.file_path : convertFileSrc(item.file_path);
  const ext = getExt(item.file_name);
  const dim = item.width && item.height ? `${item.width}x${item.height}` : 'N/A';
  const size = formatFileSize(item.file_size);
  const tags = item.tags ? item.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];

  return (
    <div className="w-72 bg-[#F6F6F6] border-l border-gray-200 flex flex-col overflow-y-auto shrink-0 text-[13px]">
      {/* Preview */}
      <div className="p-4 border-b border-gray-200 flex flex-col items-center justify-center bg-gray-50/50">
        <div className="w-full aspect-square rounded-lg overflow-hidden bg-white border border-gray-200 shadow-sm mb-3">
          <img src={src} alt={item.file_name} className="w-full h-full object-contain" />
        </div>
        <div className="font-medium text-[#1D1D1F] text-center break-words w-full">
          {item.file_name}
        </div>
        <div className="text-[11px] text-[#666666] mt-1">{size} &bull; {dim}</div>
      </div>

      {/* Properties */}
      <div className="p-4 space-y-5">
        {/* Title */}
        <div>
          <div className="text-[11px] font-semibold text-[#999999] uppercase tracking-wider mb-1.5">Title</div>
          <TextInput
            type="text"
            defaultValue={item.file_name.replace(/\.[^.]+$/, '')}
          />
        </div>

        {/* Notes */}
        <div>
          <div className="text-[11px] font-semibold text-[#999999] uppercase tracking-wider mb-1.5">Notes</div>
          <TextArea
            defaultValue={item.notes || ''}
            placeholder="Add a note..."
            className="min-h-[60px]"
          />
        </div>

        {/* Tags */}
        <div>
          <div className="text-[11px] font-semibold text-[#999999] uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span>Tags</span>
            <Plus size={12} className="cursor-pointer text-[#999999] hover:text-[#666666]" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="bg-[#F0F0F0] text-[#333333] px-2 py-0.5 rounded-full text-[11px] font-medium">
                {tag}
              </span>
            ))}
            <span className="border border-dashed border-[#E5E5E5] text-[#999999] px-2 py-0.5 rounded-full text-[11px] cursor-pointer hover:bg-[#ECECEC]">
              Add Tag...
            </span>
          </div>
        </div>

        {/* Information */}
        <div>
          <div className="text-[11px] font-semibold text-[#999999] uppercase tracking-wider mb-1.5">Information</div>
          <div className="space-y-2 text-[12px]">
            <div className="flex justify-between">
              <span className="text-[#666666]">Format</span>
              <span className="text-[#333333]">{ext} Image</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#666666]">Dimensions</span>
              <span className="text-[#333333]">{dim}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#666666]">Size</span>
              <span className="text-[#333333]">{size}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#666666]">Date Added</span>
              <span className="text-[#333333]">{formatDate(item.created_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#666666]">Modified</span>
              <span className="text-[#333333]">{formatDate(item.modified_at)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
