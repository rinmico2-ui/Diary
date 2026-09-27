import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApi, useDebouncedCallback } from '../lib/hooks';
import { api } from '../lib/api';
import { useRealtime } from '../lib/socket';
import { useAddMemory } from '../lib/addMemory';
import { PageHeader } from '../components/Nav';
import { EmptyState, Skeleton } from '../components/ui';
import { PhotoGrid, PhotoViewer } from '../components/PhotoGrid';
import { MessageThread } from '../components/MessageThread';
import { FavoriteButton } from '../components/Memory';
import type { Collection, FavoritesFeed, Photo, Session } from '../lib/types';
import { friendlyDay, plainText } from '../lib/format';
import { toasts } from '../lib/toast';

export function FavoritesPage({ session }: { session: Session }) {
  const { data, loading, reload, setData } = useApi<FavoritesFeed>('/favorites?limit=80');
  const collections = useApi<{ collections: Collection[] }>('/collections');
  const { open } = useAddMemory();
  const navigate = useNavigate();
  const [viewer, setViewer] = useState<string | null>(null);

  const reloadSoon = useDebouncedCallback(() => reload(), 400);
  useRealtime('memory:updated', () => reloadSoon());
  useRealtime('message:updated', () => reloadSoon());

  const toggleFavorite = async (photo: Photo) => {
    const next = !photo.isFavorite;
    setData((current) =>
      next
        ? { ...current!, photos: current!.photos.filter((p) => p.id !== photo.id) }
        : current,
    );
    try {
      await api.patch(`/photos/${photo.id}/favorite`, { favorite: next });
      if (next) setViewer(null);
    } catch {
      reload();
    }
  };

  const total = (data?.photos.length ?? 0) + (data?.diaryEntries.length ?? 0) + (data?.messages.length ?? 0);

  if (loading && !data) {
    return (
      <div className="page space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="aspect-square" />
          ))}
        </div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="page">
        <PageHeader eyebrow="❤️ Favorites" title="The ones you keep" />
        <EmptyState
          emoji="🤍"
          title="Nothing kept just yet"
          body="Tap the heart on any photo, diary entry or message and it will live here."
          action={
            <button type="button" className="btn-primary" onClick={() => open('photos')}>
              Browse memories
            </button>
          }
        />
      </div>
    );
  }

  const viewerPhoto = viewer ? data?.photos.find((p) => p.id === viewer) ?? null : null;

  return (
    <div className="page">
      <PageHeader eyebrow="❤️ Favorites" title="The ones you keep">
        <p className="mt-1.5 text-sm text-ink-soft">
          {total} favourite{total === 1 ? '' : 's'} across your photos, diary and conversations.
        </p>
      </PageHeader>

      <div className="space-y-10">
        {data && data.photos.length > 0 && (
          <section>
            <h2 className="mb-3 px-1 font-sans text-lg text-ink">📸 Photos</h2>
            <PhotoGrid photos={data.photos} onOpen={(photo) => setViewer(photo.id)} columns={5} />
          </section>
        )}

        {data && data.diaryEntries.length > 0 && (
          <section>
            <h2 className="mb-3 px-1 font-sans text-lg text-ink">📖 Diary</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {data.diaryEntries.map((entry, index) => (
                <motion.li
                  key={entry.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.32, delay: index * 0.04 }}
                >
                  <div className="card group relative p-5 transition-shadow hover:shadow-lift">
                    <button
                      type="button"
                      onClick={() => navigate(`/diary/${entry.id}`)}
                      className="block w-full pr-9 text-left"
                    >
                      <p className="muted">{friendlyDay(entry.entryDate)}</p>
                      <h3 className="mt-1.5 font-sans text-lg leading-snug text-ink">{entry.title}</h3>
                      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-soft">
                        {plainText(entry.content)}
                      </p>
                    </button>
                    <div className="absolute right-3 top-3">
                      <FavoriteButton
                        isFavorite={entry.isFavorite}
                        size="sm"
                        onToggle={async () => {
                          await api
                            .patch(`/diary/${entry.id}/favorite`, { favorite: false })
                            .then(() => reload())
                            .catch(() => undefined);
                        }}
                      />
                    </div>
                  </div>
                </motion.li>
              ))}
            </ul>
          </section>
        )}

        {data && data.messages.length > 0 && (
          <section>
            <h2 className="mb-3 px-1 font-sans text-lg text-ink">💬 Messages</h2>
            <div className="card p-4 sm:p-5">
              <MessageThread
                messages={data.messages}
                session={session}
                compact
                onOpenMemory={(kind, id) => {
                  if (kind === 'collection') navigate(`/collections/${id}`);
                  else if (kind === 'diary') navigate(`/diary/${id}`);
                  else navigate(`/memories?photo=${id}`);
                }}
              />
            </div>
          </section>
        )}
      </div>

      {viewerPhoto && data && (
        <PhotoViewer
          photos={data.photos}
          index={data.photos.findIndex((p) => p.id === viewerPhoto.id)}
          collections={collections.data?.collections ?? []}
          onIndexChange={(index) => setViewer(data.photos[index]?.id ?? null)}
          onClose={() => setViewer(null)}
          onToggleFavorite={toggleFavorite}
          onEdit={() => {
            setViewer(null);
            navigate(`/memories?photo=${viewerPhoto.id}&edit=1`);
          }}
          onShare={async (photo) => {
            await api.post('/messages', { type: 'MEMORY', sharedPhotoId: photo.id }).catch(() => undefined);
            toasts.success('Shared in your chat 💬');
          }}
          onDelete={() => setViewer(null)}
          onMove={() => {
            setViewer(null);
            navigate('/memories');
          }}
        />
      )}
    </div>
  );
}
