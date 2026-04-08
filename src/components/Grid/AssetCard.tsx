import React, { useState, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Item } from '@/lib/types';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AssetCardProps {
  item: Item;
  size: number;
  selected: boolean;
  thumbnailPath?: string;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

export const AssetCard = React.memo(function AssetCard({
  item,
  size,
  selected,
  thumbnailPath,
  onClick,
  onDoubleClick,
}: AssetCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  // Reset loading state when the image source changes
  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [thumbnailPath, item.file_path]);

  // Use generated thumbnail if available, otherwise fall back to original file
  const source = thumbnailPath ?? item.file_path;
  // If source is already a data URL, use it directly; otherwise convert file path
  const thumbSrc = !error
    ? source.startsWith('data:') ? source : convertFileSrc(source)
    : undefined;

  const ext = item.file_name.split('.').pop()?.toUpperCase() || '';
  const dim = item.width && item.height ? `${item.width}x${item.height}` : '';
  const sizeStr = item.file_size ? formatFileSize(item.file_size) : '';

  return (
    <div
      className={`group relative flex flex-col rounded-lg p-2 cursor-pointer transition-colors ${
        selected ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
      style={{ width: size }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div
        className={`relative aspect-square rounded-md overflow-hidden bg-gray-100 mb-2 border ${
          selected
            ? 'border-blue-500 ring-2 ring-blue-500/20'
            : 'border-gray-200 group-hover:border-gray-300'
        }`}
      >
        {thumbSrc && (
          <img
            src={thumbSrc}
            alt={item.file_name}
            className={`w-full h-full object-cover transition-opacity ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            loading="lazy"
          />
        )}
        {!loaded && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs">
            No preview
          </div>
        )}
        {ext && (
          <div className="absolute bottom-1 right-1 bg-black/60 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 rounded">
            {ext}
          </div>
        )}
      </div>
      <div className="px-1">
        <div className={`text-[12px] font-medium truncate ${selected ? 'text-blue-700' : 'text-gray-800'}`}>
          {item.file_name}
        </div>
        <div className="text-[11px] text-gray-400 flex items-center justify-between mt-0.5">
          <span>{dim}</span>
          <span>{sizeStr}</span>
        </div>
      </div>
    </div>
  );
});
