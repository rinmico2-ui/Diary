import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi, useDebouncedCallback } from '../lib/hooks';
import { api, query } from '../lib/api';
import { useRealtime } from '../lib/socket';
import { useAddMemory } from '../lib/addMemory';
import { PageHeader } from '../components/Nav';
import { EmptyState, Skeleton } from '../components/ui';
import { PhotoGrid, PhotoViewer } from '../components/PhotoGrid';
import { Sheet, ConfirmDialog } from '../components/Sheet';
import { TagInput } from '../components/AddMemorySheet';
import type { Collection, Photo, Session, TagSummary } from '../lib/types';
import { longDate } from '../lib/format';
import { toasts } from '../lib/toast';

export function MemoriesPage({ session }: { session: Session }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { open } = useAddMemory();

  const [search, setSearch] = useState('');
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState<Photo | null>(null);
  const [moving, setMoving] = useState<Photo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Photo | null>(null);

  const collections = useApi<{ collections: Collection[] }>('/collections');
  const tags = useApi<{ tags: TagSummary[] }>('/diary/tags');
  const [tag, setTag] = useState<string | null>(null);

  const path = `/photos${query({
    limit: 120,
    collectionId: collectionId ?? undefined,
    favoritesOnly: favoritesOnly ? 'true' : undefined,
    tag: tag ?? undefined,
    search: search || undefined,
  })}`;

  const { data, loading, reload, setData } = useApi<{ items: Photo[]; total: number }>(path);
  const photos = data?.items ?? [];

  // Deep link: /memories?photo=id opens the viewer straight away.
  useEffect(() => {
    const photoId = searchParams.get('photo');
    if (!photoId || photos.length === 0) return;
    const index = photos.findIndex((p) => p.id === photoId);
    if (index >= 0) setViewerIndex(index);
    setSearchParams({}, { replace: true });
  }, [searchParams, photos, setSearchParams]);

  const reloadSoon = useDebouncedCallback(() => reload(), 400);
  useRealtime('memory:created', () => reloadSoon());
  useRealtime('memory:updated', () => reloadSoon());
  useRealtime('memory:deleted', () => reloadSoon());
  useRealtime('collection:updated', () => reloadSoon());

  const toggleFavorite = async (photo: Photo) => {
    const next = !photo.isFavorite;
    setData((current) =>
      current
        ? { ...current, items: current.items.map((p) => (p.id === photo.id ? { ...p, isFavorite: next } : p)) }
        : current,
    );
    try {
      await api.patch(`/photos/${photo.id}/favorite`, { favorite: next });
    } catch {
      reload();
    }
  };

  const share = async (photo: Photo) => {
    try {
      await api.post(`/photos/${photo.id}/share`);
      await api.post('/messages', { type: 'MEMORY', sharedPhotoId: photo.id });
      toasts.success('Shared in your chat 💬');
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'Could not share that.');
    }
  };

  const remove = async (photo: Photo) => {
    try {
      await api.delete(`/photos/${photo.id}`);
      toasts.success('Photo removed.');
      reload();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'Could not remove that photo.');
    }
  };

  const activeCollection = collections.data?.collections.find((c) => c.id === collectionId) ?? null;

  return (
    <div className="page">
      <PageHeader
        eyebrow="📸 Memories"
        title={activeCollection ? activeCollection.name : 'The photo library'}
        action={
          <button type="button" className="btn-primary" onClick={() => open('photos')}>
            📸 Add
          </button>
        }
      >
        {data && (
          <p className="mt-1.5 text-sm text-ink-soft">
            {data.total} photo{data.total === 1 ? '' : 's'}
            {activeCollection ? ` in ${activeCollection.name}` : ' saved together'}
          </p>
        )}
      </PageHeader>

      <div className="mb-5 space-y-3">
        <input
          className="field"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search captions and descriptions…"
          aria-label="Search photos"
        />

        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <FilterChip active={!collectionId && !favoritesOnly && !tag && !search} onClick={() => { setCollectionId(null); setFavoritesOnly(false); setTag(null); setSearch(''); }}>
            Everything
          </FilterChip>
          <FilterChip active={favoritesOnly} onClick={() => setFavoritesOnly((v) => !v)}>
            ❤️ Favourites
          </FilterChip>
          {collections.data?.collections.map((collection) => (
            <FilterChip key={collection.id} active={collectionId === collection.id} onClick={() => setCollectionId(collectionId === collection.id ? null : collection.id)}>
              📁 {collection.name}
            </FilterChip>
          ))}
        </div>

        {tags.data && tags.data.tags.length > 0 && (
          <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {tags.data.tags.slice(0, 14).map((item) => (
              <FilterChip key={item.name} active={tag === item.name} onClick={() => setTag(tag === item.name ? null : item.name)}>
                #{item.name}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 12 }).map((_, index) => (
            <Skeleton key={index} className="aspect-square" />
          ))}
        </div>
      ) : photos.length === 0 ? (
        search || tag || favoritesOnly || collectionId ? (
          <EmptyState emoji="🔍" title="Nothing matched" body="Try clearing a filter or searching for something else." />
        ) : (
          <EmptyState
            emoji="📸"
            title="No memories here yet"
            body="Add the first photo and this becomes your album."
            action={
              <button type="button" className="btn-primary" onClick={() => open('photos')}>
                Add Photos
              </button>
            }
          />
        )
      ) : (
        <PhotoGrid photos={photos} onOpen={(photo) => setViewerIndex(photos.findIndex((p) => p.id === photo.id))} columns={4} />
      )}

      {viewerIndex !== null && photos[viewerIndex] && (
        <PhotoViewer
          photos={photos}
          index={viewerIndex}
          collections={collections.data?.collections ?? []}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          onToggleFavorite={toggleFavorite}
          onEdit={(photo) => {
            setViewerIndex(null);
            setEditing(photo);
          }}
          onShare={share}
          onDelete={(photo) => {
            setViewerIndex(null);
            setConfirmDelete(photo);
          }}
          onMove={(photo) => {
            setViewerIndex(null);
            setMoving(photo);
          }}
        />
      )}

      {editing && (
        <PhotoEditSheet
          photo={editing}
          suggestions={(tags.data?.tags ?? []).map((t) => t.name)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      <Sheet open={Boolean(moving)} onClose={() => setMoving(null)} title="Move to a collection">
        {moving && (
          <div className="space-y-2">
            <p className="text-sm text-ink-faint">Filing this photo keeps it safe in your library either way.</p>
            <button
              type="button"
              className="card flex w-full items-center gap-3 p-3.5 text-left"
              onClick={async () => {
                await api.post('/photos/move', { photoIds: [moving.id], collectionId: null });
                toasts.success('Photo removed from the collection.');
                setMoving(null);
                reload();
              }}
            >
              <span className="text-xl">🗂</span>
              <span className="text-sm text-ink">No collection</span>
            </button>
            {collections.data?.collections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                className={`card flex w-full items-center gap-3 p-3.5 text-left transition-shadow hover:shadow-lift ${
                  moving.collection?.id === collection.id ? 'ring-2 ring-rose-300' : ''
                }`}
                onClick={async () => {
                  await api.post('/photos/move', { photoIds: [moving.id], collectionId: collection.id });
                  toasts.success(`Moved to ${collection.name}.`);
                  setMoving(null);
                  reload();
                }}
              >
                {collection.coverThumbnailUrl ? (
                  <img src={collection.coverThumbnailUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-sunk text-lg">📁</span>
                )}
                <span className="text-sm text-ink">{collection.name}</span>
              </button>
            ))}
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Remove this photo?"
        body="It will be deleted for both of you. This cannot be undone."
        confirmLabel="Remove it"
        tone="danger"
        onConfirm={() => {
          if (confirmDelete) void remove(confirmDelete);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <p className="mt-10 text-center text-xs text-ink-faint">
        Signed in as {session.user.name} · everything here is private to your space
      </p>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-pill border px-3 py-1.5 text-xs transition-colors ${
        active ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-line bg-surface text-ink-faint hover:text-ink-soft'
      }`}
    >
      {children}
    </button>
  );
}

function PhotoEditSheet({
  photo,
  suggestions,
  onClose,
  onSaved,
}: {
  photo: Photo;
  suggestions: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [description, setDescription] = useState(photo.description ?? '');
  const [photoDate, setPhotoDate] = useState(photo.photoDate);
  const [tags, setTags] = useState<string[]>(photo.tags);
  const [collectionId, setCollectionId] = useState(photo.collection?.id ?? '');
  const [busy, setBusy] = useState(false);

  const collections = useApi<{ collections: Collection[] }>('/collections');

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/photos/${photo.id}`, {
        caption: caption.trim() || null,
        description: description.trim() || null,
        photoDate,
        collectionId: collectionId || null,
        tags,
      });
      toasts.success('Saved. ✨');
      onSaved();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Edit photo" size="tall">
      <div className="space-y-4">
        <img
          src={photo.thumbnailUrl ?? photo.imageUrl}
          alt=""
          className="max-h-56 w-full rounded-2xl object-cover"
        />

        <div>
          <label htmlFor="photo-caption" className="mb-1.5 block text-xs font-medium text-ink-soft">
            Caption
          </label>
          <input
            id="photo-caption"
            className="field"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Our beach trip"
            maxLength={300}
          />
        </div>

        <div>
          <label htmlFor="photo-description" className="mb-1.5 block text-xs font-medium text-ink-soft">
            Description
          </label>
          <textarea
            id="photo-description"
            className="field min-h-24 resize-y"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="The story behind this moment…"
            maxLength={2000}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="photo-date" className="mb-1.5 block text-xs font-medium text-ink-soft">
              Date
            </label>
            <input
              id="photo-date"
              type="date"
              className="field"
              value={photoDate}
              onChange={(event) => setPhotoDate(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="photo-collection" className="mb-1.5 block text-xs font-medium text-ink-soft">
              Collection
            </label>
            <select
              id="photo-collection"
              className="field"
              value={collectionId}
              onChange={(event) => setCollectionId(event.target.value)}
            >
              <option value="">No collection</option>
              {collections.data?.collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-ink-soft">Tags</p>
          <TagInput value={tags} onChange={setTags} suggestions={suggestions} />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={busy} className="btn-primary flex-1">
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export { longDate };
