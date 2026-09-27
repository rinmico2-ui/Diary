import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Avatar, Backdrop } from './ui';
import { FavoriteButton, TagRow } from './Memory';
import type { Collection, Photo } from '../lib/types';
import { longDate } from '../lib/format';

interface PhotoGridProps {
  photos: Photo[];
  onOpen: (photo: Photo) => void;
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}

const COLUMN_CLASSES = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6',
} as const;

/**
 * A calm, album-like grid. Tiles keep their aspect ratio so the page reads as
 * photographs rather than a dashboard of rectangles.
 */
export function PhotoGrid({ photos, onOpen, columns = 4, className = '' }: PhotoGridProps) {
  return (
    <div className={`grid gap-2 sm:gap-3 ${COLUMN_CLASSES[columns]} ${className}`}>
      {photos.map((photo, index) => (
        <PhotoTile key={photo.id} photo={photo} index={index} onOpen={onOpen} />
      ))}
    </div>
  );
}

function PhotoTile({ photo, index, onOpen }: { photo: Photo; index: number; onOpen: (photo: Photo) => void }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <motion.button
      type="button"
      onClick={() => onOpen(photo)}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.02, 0.3), ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      className="group relative block aspect-square overflow-hidden rounded-2xl bg-surface-sunk"
    >
      {!loaded && <span className="absolute inset-0 animate-pulse bg-surface-sunk" aria-hidden />}

      <img
        src={photo.thumbnailUrl ?? photo.imageUrl}
        alt={photo.caption ?? ''}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`h-full w-full object-cover transition-all duration-500 group-hover:scale-[1.06] ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {photo.isFavorite && (
        <span aria-hidden className="absolute left-2 top-2 text-sm drop-shadow-sm">
          ❤️
        </span>
      )}

      {photo.collection && (
        <span className="absolute bottom-2 left-2 max-w-[70%] truncate rounded-pill bg-ink/55 px-2 py-0.5 text-[10px] text-white/95 backdrop-blur-sm">
          📁 {photo.collection.name}
        </span>
      )}

      {photo.caption && (
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-2 bg-gradient-to-t from-ink/75 to-transparent
                     px-3 pb-2.5 pt-8 text-left text-[11px] leading-snug text-white opacity-0 transition-all duration-300
                     group-hover:translate-y-0 group-hover:opacity-100"
        >
          {photo.caption}
        </span>
      )}
    </motion.button>
  );
}

interface PhotoViewerProps {
  photos: Photo[];
  index: number;
  collections: Collection[];
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onToggleFavorite: (photo: Photo) => void;
  onEdit: (photo: Photo) => void;
  onShare: (photo: Photo) => void;
  onDelete: (photo: Photo) => void;
  onMove: (photo: Photo) => void;
}

export function PhotoViewer({
  photos,
  index,
  collections,
  onIndexChange,
  onClose,
  onToggleFavorite,
  onEdit,
  onShare,
  onDelete,
  onMove,
}: PhotoViewerProps) {
  const photo = photos[index];

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= 0 && next < photos.length) onIndexChange(next);
    },
    [index, photos.length, onIndexChange],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') go(1);
      if (event.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  if (!photo) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex flex-col">
        <Backdrop onClick={onClose} className="!bg-ink/95" />

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="relative z-10 flex h-full flex-col"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-white/90 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-white/10"
            >
              ← Close
            </button>
            <span className="text-xs tabular-nums text-white/50">
              {index + 1} / {photos.length}
            </span>
          </header>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
            <motion.img
              key={photo.id}
              src={photo.imageUrl}
              alt={photo.caption ?? ''}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="max-h-full max-w-full rounded-2xl object-contain shadow-float"
            />

            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label="Previous photo"
                  className="absolute left-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20 sm:left-3"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label="Next photo"
                  className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20 sm:right-3"
                >
                  ›
                </button>
              </>
            )}
          </div>

          <motion.footer
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
            className="shrink-0 px-4 pb-safe pt-2 sm:px-6"
          >
            <div className="mx-auto max-h-[38dvh] max-w-3xl overflow-y-auto rounded-t-[1.5rem] bg-canvas/97 px-5 py-5 backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {photo.caption ? (
                    <h2 className="font-sans text-lg leading-snug text-ink">{photo.caption}</h2>
                  ) : (
                    <h2 className="font-sans text-lg text-ink-soft">Untitled memory</h2>
                  )}
                  <p className="mt-1 text-xs text-ink-faint">{longDate(photo.photoDate)}</p>
                </div>
                <FavoriteButton isFavorite={photo.isFavorite} onToggle={() => onToggleFavorite(photo)} size="lg" />
              </div>

              {photo.description && (
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">{photo.description}</p>
              )}

              <div className="mt-4 space-y-2 text-xs text-ink-faint">
                <div className="flex items-center gap-2">
                  <Avatar name={photo.owner.name} src={photo.owner.profileImage} id={photo.owner.id} size="sm" />
                  <span>Added by {photo.owner.name}</span>
                </div>
                {photo.collection && (
                  <div>📁 {photo.collection.name}</div>
                )}
                {photo.diaryEntry && (
                  <div>📝 Part of “{photo.diaryEntry.title}”</div>
                )}
                {photo.tags.length > 0 && <TagRow tags={photo.tags} />}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" className="btn-primary" onClick={() => onShare(photo)}>
                  💬 Share in chat
                </button>
                <button type="button" className="btn-secondary" onClick={() => onEdit(photo)}>
                  ✏️ Edit
                </button>
                <button type="button" className="btn-secondary" onClick={() => onMove(photo)}>
                  📁 Move
                </button>
                <button type="button" className="btn-ghost text-ink-faint" onClick={() => onDelete(photo)}>
                  🗑️
                </button>
              </div>

              {collections.length > 0 && (
                <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
                  Tip: swiping or using ← → moves through this album.
                </p>
              )}
            </div>
          </motion.footer>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

/** Small helper for building an album around a photo that may not be loaded. */
export function useAlbum(photos: Photo[], currentId: string | null): { album: Photo[]; index: number } {
  return useMemo(() => {
    const index = currentId ? photos.findIndex((p) => p.id === currentId) : -1;
    return { album: index >= 0 ? photos : [], index: Math.max(index, 0) };
  }, [photos, currentId]);
}
