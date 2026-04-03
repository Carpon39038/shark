import React, { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Item } from '@/lib/types';

interface AssetCardProps {
  item: Item;
  size: number;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

export const AssetCard = React.memo(function AssetCard({
  item,
  size,
  selected,
  onClick,
  onDoubleClick,
}: AssetCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  // Build thumbnail URL — thumb_256_path is stored in DB
  // For Phase 1, use the original file as thumbnail source via convertFileSrc
  const thumbSrc = !error ? convertFileSrc(item.file_path) : undefined;

  return (
    <div
      className={`shrink-0 rounded overflow-hidden cursor-pointer transition-all ${
        selected ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-neutral-900' : 'hover:ring-1 hover:ring-neutral-500'
      }`}
      style={{ width: size }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="bg-neutral-800 flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        {thumbSrc && (
          <img
            src={thumbSrc}
            alt={item.file_name}
            className={`max-w-full max-h-full object-contain transition-opacity ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            loading="lazy"
          />
        )}
        {!loaded && !error && (
          <div className="w-8 h-8 border-2 border-neutral-600 border-t-neutral-400 rounded-full animate-spin" />
        )}
        {error && (
          <span className="text-neutral-600 text-xs">No preview</span>
        )}
      </div>
      <div className="px-1.5 py-1 truncate text-xs text-neutral-400">
        {item.file_name}
      </div>
    </div>
  );
});
