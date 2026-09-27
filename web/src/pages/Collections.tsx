import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { useAddMemory } from '../lib/addMemory';
import { PageHeader } from '../components/Nav';
import { EmptyState, Skeleton } from '../components/ui';
import { PhotoGrid, PhotoViewer } from '../components/PhotoGrid';
import { ConfirmDialog, Menu, MenuItem } from '../components/Sheet';
import { CollectionEditor } from '../components/CollectionEditor';
import { EntryCard } from './Diary';
import type { Collection, CollectionDetail as Detail } from '../lib/types';
import { longDate, pluralise, relativeTime } from '../lib/format';
import { toasts } from '../lib/toast';

export function CollectionsPage() {
  const { data, loading, reload } = useApi<{ collections: Collection[] }>('/collections');
  const { open } = useAddMemory();
  const [editing, setEditing] = useState<Collection | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Collection | null>(null);

  const collections = data?.collections ?? [];

  const remove = async (collection: Collection) => {
    try {
      const result = await api.delete<{ keptPhotos: number; keptDiaryEntries: number }>(`/collections/${collection.id}`);
      toasts.success(
        `${collection.name} is gone, but ${result.keptPhotos} photo${result.keptPhotos === 1 ? '' : 's'} and ${
          result.keptDiaryEntries
        } diary entr${result.keptDiaryEntries === 1 ? 'y' : 'ies'} stayed safe in your library.`,
      );
      reload();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'Could not delete that collection.');
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="📁 Collections"
        title="Homes for your memories"
        action={
          <button type="button" className="btn-primary" onClick={() => open('collection')}>
            📁 New
          </button>
        }
      >
        {collections.length > 0 && (
          <p className="mt-1.5 text-sm text-ink-soft">
            {pluralise(collections.length, 'collection')} · deleting one never deletes what is inside
          </p>
        )}
      </PageHeader>

      {loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-56" />
          ))}
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          emoji="📁"
          title="Give your memories a home"
          body="Trips, birthdays, random Tuesdays — grouping them makes them easier to find later."
          action={
            <button type="button" className="btn-primary" onClick={() => open('collection')}>
              Create Collection
            </button>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((collection, index) => (
            <motion.li
              key={collection.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="card group relative overflow-hidden transition-shadow hover:shadow-lift">
                <Link to={`/collections/${collection.id}`} className="block">
                  <div className="relative aspect-[16/10] overflow-hidden bg-surface-sunk">
                    {collection.coverThumbnailUrl ? (
                      <img
                        src={collection.coverThumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-4xl opacity-35" aria-hidden>
                        📁
                      </div>
                    )}
                  </div>

                  <div className="p-4">
                    <h2 className="font-sans text-lg leading-snug text-ink">{collection.name}</h2>
                    {collection.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-ink-faint">{collection.description}</p>
                    )}
                    <p className="mt-2.5 text-xs text-ink-faint">
                      📸 {collection.photoCount} · 📝 {collection.diaryCount} · updated {relativeTime(collection.updatedAt)}
                    </p>
                  </div>
                </Link>

                <div className="absolute right-2.5 top-2.5">
                  <Menu
                    trigger={({ toggle }) => (
                      <button
                        type="button"
                        onClick={toggle}
                        aria-label={`Options for ${collection.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/40 text-white backdrop-blur transition-colors hover:bg-ink/60"
                      >
                        ⋯
                      </button>
                    )}
                  >
                    {(close) => (
                      <>
                        <MenuItem
                          onClick={() => {
                            close();
                            setEditing(collection);
                          }}
                        >
                          ✏️ Rename or describe
                        </MenuItem>
                        <MenuItem
                          onClick={() => {
                            close();
                            void navigator.clipboard?.writeText(collection.name);
                            toasts.info('Collection name copied.');
                          }}
                        >
                          📋 Copy name
                        </MenuItem>
                        <MenuItem
                          danger
                          onClick={() => {
                            close();
                            setConfirmDelete(collection);
                          }}
                        >
                          🗑️ Delete collection
                        </MenuItem>
                      </>
                    )}
                  </Menu>
                </div>
              </div>
            </motion.li>
          ))}
        </ul>
      )}

      {editing && (
        <CollectionEditor
          collection={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={`Delete “${confirmDelete?.name ?? ''}”?`}
        body={
          confirmDelete && (confirmDelete.photoCount > 0 || confirmDelete.diaryCount > 0) ? (
            <>
              The folder goes, but nothing inside is lost.{' '}
              <strong className="text-ink">
                {confirmDelete.photoCount} photo{confirmDelete.photoCount === 1 ? '' : 's'}
              </strong>{' '}
              and{' '}
              <strong className="text-ink">
                {confirmDelete.diaryCount} diary entr{confirmDelete.diaryCount === 1 ? 'y' : 'ies'}
              </strong>{' '}
              will simply become unfiled and stay in your library.
            </>
          ) : (
            'This folder is empty, so nothing to keep.'
          )
        }
        confirmLabel="Delete the folder"
        tone="danger"
        onConfirm={() => {
          if (confirmDelete) void remove(confirmDelete);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

export function CollectionDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { open } = useAddMemory();
  const { data, loading, reload } = useApi<Detail>(`/collections/${id}`);
  const allCollections = useApi<{ collections: Collection[] }>('/collections');

  const [tab, setTab] = useState<'all' | 'photos' | 'diary'>('all');
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState<Collection | null>(null);

  if (loading) {
    return (
      <div className="page space-y-4">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-10 w-40" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <EmptyState emoji="📁" title="That collection is not available" body="It may have been deleted." />
      </div>
    );
  }

  const { collection, photos, diaryEntries, stats } = data;

  const detach = async (kind: 'photo' | 'diary', memoryId: string) => {
    try {
      await api.post(`/collections/${collection.id}/detach`, { kind, memoryId });
      toasts.success('Removed from the folder. The memory itself is safe.');
      reload();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'Could not remove that.');
    }
  };

  const share = async () => {
    try {
      await api.post('/messages', { type: 'MEMORY', sharedCollectionId: collection.id });
      toasts.success(`Shared ${collection.name} in your chat 📁`);
    } catch {
      toasts.error('Could not share that collection.');
    }
  };

  const remove = async () => {
    try {
      const result = await api.delete<{ keptPhotos: number; keptDiaryEntries: number }>(`/collections/${collection.id}`);
      toasts.success(
        `Folder deleted. ${result.keptPhotos} photo${result.keptPhotos === 1 ? '' : 's'} and ${
          result.keptDiaryEntries
        } diary entr${result.keptDiaryEntries === 1 ? 'y' : 'ies'} stayed in your library.`,
      );
      navigate('/collections');
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'Could not delete that collection.');
    }
  };

  return (
    <div className="page">
      <button type="button" onClick={() => navigate('/collections')} className="btn-ghost -ml-2 mb-4">
        ← Collections
      </button>

      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="card overflow-hidden"
      >
        <div className="relative aspect-[21/9] bg-surface-sunk">
          {collection.coverThumbnailUrl ? (
            <img src={collection.coverThumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-6xl opacity-25" aria-hidden>
              📁
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/10 to-transparent" />

          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
            <h1 className="font-sans text-2xl leading-tight text-white sm:text-3xl">{collection.name}</h1>
            {collection.description && <p className="mt-1 max-w-2xl text-sm text-white/85">{collection.description}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-7">
          <div className="flex flex-wrap items-center gap-4 text-sm text-ink-soft">
            <span>📸 {pluralise(stats.photoCount, 'photo')}</span>
            <span>📝 {pluralise(stats.diaryCount, 'diary entry', 'diary entries')}</span>
            {stats.favoriteCount > 0 && <span>❤️ {stats.favoriteCount}</span>}
            {stats.firstMemoryAt && (
              <span className="text-ink-faint">
                {shortSpan(stats.firstMemoryAt, stats.lastMemoryAt)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => open('diary')}>
              📝 Add entry
            </button>
            <button type="button" className="btn-secondary" onClick={() => open('photos')}>
              📸 Add photos
            </button>
            <button type="button" className="btn-primary" onClick={share}>
              💬 Share
            </button>
            <Menu
              trigger={({ toggle }) => (
                <button type="button" onClick={toggle} aria-label="Collection options" className="btn-ghost px-3">
                  ⋯
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem
                    onClick={() => {
                      close();
                      setEditing(collection);
                    }}
                  >
                    ✏️ Rename or edit
                  </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      close();
                      setConfirmDelete(true);
                    }}
                  >
                    🗑️ Delete collection
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>
        </div>
      </motion.header>

      <div className="mt-6 flex gap-1 rounded-2xl bg-surface-sunk p-1">
        {(
          [
            { key: 'all' as const, label: 'All', count: photos.length + diaryEntries.length },
            { key: 'photos' as const, label: 'Photos', count: photos.length },
            { key: 'diary' as const, label: 'Diary', count: diaryEntries.length },
          ]
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`flex-1 rounded-xl px-3 py-2 text-sm transition-all ${
              tab === item.key ? 'bg-surface font-medium text-ink shadow-card' : 'text-ink-faint hover:text-ink-soft'
            }`}
          >
            {item.label}
            <span className="ml-1.5 text-xs opacity-60">{item.count}</span>
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-8">
        {(tab === 'all' || tab === 'photos') && (
          <section>
            {photos.length === 0 ? (
              <EmptyState
                emoji="📸"
                title="No photos in this collection"
                body="Add a few and it will fill up nicely."
                action={
                  <button type="button" className="btn-primary" onClick={() => open('photos')}>
                    Add Photos
                  </button>
                }
              />
            ) : (
              <PhotoGrid photos={photos} onOpen={(photo) => setViewerIndex(photos.findIndex((p) => p.id === photo.id))} columns={4} />
            )}
          </section>
        )}

        {(tab === 'all' || tab === 'diary') && (
          <section>
            {diaryEntries.length === 0 ? (
              tab === 'diary' ? (
                <EmptyState
                  emoji="✨"
                  title="No diary entries here yet"
                  body="Write something and file it in this collection."
                  action={
                    <button type="button" className="btn-primary" onClick={() => open('diary')}>
                      Write Something
                    </button>
                  }
                />
              ) : null
            ) : (
              <ul className="space-y-3">
                {diaryEntries.map((entry, index) => (
                  <li key={entry.id} className="relative">
                    <EntryCard entry={entry} index={index} />
                    <button
                      type="button"
                      onClick={() => detach('diary', entry.id)}
                      className="absolute right-3 top-3 text-xs text-ink-faint opacity-0 transition-opacity hover:text-rose-600 focus-visible:opacity-100 sm:group-hover:opacity-100"
                    >
                      Unfile
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {viewerIndex !== null && photos[viewerIndex] && (
        <PhotoViewer
          photos={photos}
          index={viewerIndex}
          collections={allCollections.data?.collections ?? []}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          onToggleFavorite={async (photo) => {
            await api.patch(`/photos/${photo.id}/favorite`, { favorite: !photo.isFavorite }).catch(() => undefined);
            reload();
          }}
          onEdit={() => setViewerIndex(null)}
          onShare={share}
          onDelete={(photo) => {
            setViewerIndex(null);
            void api.delete(`/photos/${photo.id}`).then(reload).catch(() => undefined);
          }}
          onMove={(photo) => {
            setViewerIndex(null);
            void detach('photo', photo.id);
          }}
        />
      )}

      {editing && (
        <CollectionEditor
          collection={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete “${collection.name}”?`}
        body={
          stats.photoCount > 0 || stats.diaryCount > 0 ? (
            <>
              The folder goes, but nothing inside is lost. {stats.photoCount} photo
              {stats.photoCount === 1 ? '' : 's'} and {stats.diaryCount} diary entr
              {stats.diaryCount === 1 ? 'y' : 'ies'} will simply become unfiled and stay in your library.
            </>
          ) : (
            'This folder is empty, so nothing to keep.'
          )
        }
        confirmLabel="Delete the folder"
        tone="danger"
        onConfirm={() => {
          setConfirmDelete(false);
          void remove();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function shortSpan(first: string, last: string | null): string {
  const start = longDate(first);
  if (!last || last === first) return start;
  return `${new Date(first).getFullYear()} — ${longDate(last).replace(/^\w+,?\s/, '')}`;
}
