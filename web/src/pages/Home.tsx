import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApi, useDebouncedCallback } from '../lib/hooks';
import { api } from '../lib/api';
import { useRealtime } from '../lib/socket';
import { useAddMemory } from '../lib/addMemory';
import type { HomeSummary, Session } from '../lib/types';
import { Avatar, EmptyState, Section, Skeleton } from '../components/ui';
import { PhotoGrid, PhotoViewer } from '../components/PhotoGrid';
import { Chip, TagRow, VisibilityPill } from '../components/Memory';
import { MessageThread } from '../components/MessageThread';
import { moodMeta, type Collection, type Photo } from '../lib/types';
import { friendlyDay, longDate, plainText, relativeTime } from '../lib/format';
import { toasts } from '../lib/toast';

interface HomeProps {
  session: Session;
}

export function HomePage({ session }: HomeProps) {
  const { data, loading, reload, setData } = useApi<HomeSummary>('/home');
  const { open } = useAddMemory();
  const navigate = useNavigate();
  const [viewer, setViewer] = useState<string | null>(null);

  // A new message or memory should quietly refresh the dashboard.
  const refreshSoon = useDebouncedCallback(() => reload(), 500);
  useRealtime('message:created', () => refreshSoon());
  useRealtime('memory:created', () => refreshSoon());
  useRealtime('collection:updated', () => refreshSoon());

  const collections: Collection[] = useApi<{ collections: Collection[] }>('/collections').data?.collections ?? [];

  const toggleFavorite = async (photo: Photo) => {
    const next = !photo.isFavorite;
    setData((current) =>
      current
        ? {
            ...current,
            recentPhotos: current.recentPhotos.map((p) => (p.id === photo.id ? { ...p, isFavorite: next } : p)),
            favoriteMemories: {
              ...current.favoriteMemories,
              photos: next
                ? [photo, ...current.favoriteMemories.photos.filter((p) => p.id !== photo.id)]
                : current.favoriteMemories.photos.filter((p) => p.id !== photo.id),
            },
          }
        : current,
    );

    try {
      await api.patch(`/photos/${photo.id}/favorite`, { favorite: next });
    } catch {
      reload();
    }
  };

  if (loading && !data) {
    return (
      <div className="page space-y-6">
        <Skeleton className="h-40 w-full" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <EmptyState emoji="🌙" title="We could not load your space" body="Please try again in a moment." />
      </div>
    );
  }

  const viewerPhoto = viewer ? data.recentPhotos.find((p) => p.id === viewer) ?? null : null;

  return (
    <div className="page">
      <header className="mb-7">
        <p className="muted">{longDate(data.today)}</p>
        <h1 className="heading-xl mt-1">
          Our little corner of the internet <span aria-hidden>❤️</span>
        </h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          {data.greeting}. {data.partner ? `You and ${data.partner.name} have ${formatMemories(data.counts)} saved here.` : 'Your memories live here.'}
        </p>
      </header>

      <QuickActions onPhotos={() => open('photos')} onDiary={() => open('diary')} onCollection={() => open('collection')} onMessage={() => navigate('/messages')} />

      <PartnerStrip
        name={data.partner?.name ?? 'Your other half'}
        avatar={data.partner?.profileImage ?? null}
        avatarId={data.partner?.id}
        isOnline={data.partner?.isOnline ?? false}
        lastSeenAt={data.partner?.lastSeenAt ?? null}
        lastMessage={data.lastMessage}
        myId={session.user.id}
        unread={data.unreadMessages}
      />

      <div className="mt-10 space-y-10">
        <Section
          title="Recent photos"
          subtitle={data.counts.photos > 0 ? `${data.counts.photos} in the library` : undefined}
          action={
            <Link to="/memories" className="btn-ghost text-sm">
              See all →
            </Link>
          }
        >
          {data.recentPhotos.length === 0 ? (
            <EmptyState
              emoji="📸"
              title="No memories here yet"
              body="The first photo you add will start the album."
              action={
                <button type="button" className="btn-primary" onClick={() => open('photos')}>
                  Add Photos
                </button>
              }
            />
          ) : (
            <PhotoGrid photos={data.recentPhotos} onOpen={(photo) => setViewer(photo.id)} columns={4} />
          )}
        </Section>

        <Section
          title="Recent diary"
          subtitle={data.counts.diary > 0 ? `${data.counts.diary} entries` : undefined}
          action={
            <Link to="/diary" className="btn-ghost text-sm">
              See all →
            </Link>
          }
        >
          {data.recentDiary.length === 0 ? (
            <EmptyState
              emoji="✨"
              title="Your story starts here"
              body="Write down a small moment before it slips away."
              action={
                <button type="button" className="btn-primary" onClick={() => open('diary')}>
                  Write Something
                </button>
              }
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {data.recentDiary.map((entry) => (
                <DiaryCard key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </Section>

        {data.recentMessages.length > 0 && (
          <Section
            title="Your conversation"
            action={
              <Link to="/messages" className="btn-ghost text-sm">
                Open chat →
              </Link>
            }
          >
            <div className="card overflow-hidden p-4 sm:p-5">
              <MessageThread
                messages={data.recentMessages}
                session={session}
                compact
                onOpenMemory={(kind, id) =>
                  kind === 'collection' ? navigate(`/collections/${id}`) : kind === 'diary' ? navigate(`/diary/${id}`) : navigate(`/memories?photo=${id}`)
                }
              />
            </div>
          </Section>
        )}

        <Section
          title="Collections"
          action={
            <Link to="/collections" className="btn-ghost text-sm">
              See all →
            </Link>
          }
        >
          {data.collections.length === 0 ? (
            <EmptyState
              emoji="📁"
              title="Give your memories a home"
              body="Group the good days together — trips, birthdays, just because."
              action={
                <button type="button" className="btn-primary" onClick={() => open('collection')}>
                  Create Collection
                </button>
              }
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.collections.map((collection) => (
                <li key={collection.id}>
                  <CollectionCard collection={collection} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        {(data.favoriteMemories.photos.length > 0 || data.favoriteMemories.diaryEntries.length > 0) && (
          <Section
            title="Favourites"
            subtitle={`${data.counts.favorites} kept close`}
            action={
              <Link to="/favorites" className="btn-ghost text-sm">
                See all →
              </Link>
            }
          >
            <div className="space-y-3">
              {data.favoriteMemories.photos.length > 0 && (
                <PhotoGrid
                  photos={data.favoriteMemories.photos}
                  onOpen={(photo) => setViewer(photo.id)}
                  columns={6}
                />
              )}
              {data.favoriteMemories.diaryEntries.slice(0, 2).map((entry) => (
                <DiaryCard key={entry.id} entry={entry} />
              ))}
            </div>
          </Section>
        )}

        <Section
          title="Your timeline"
          action={
            <Link to="/timeline" className="btn-ghost text-sm">
              Open →
            </Link>
          }
        >
          <Link
            to="/timeline"
            className="card flex items-center justify-between gap-4 p-5 transition-shadow hover:shadow-lift"
          >
            <div>
              <p className="font-sans text-ink">Every day, in order</p>
              <p className="muted mt-0.5">See how your story has been unfolding.</p>
            </div>
            <span className="text-2xl text-ink-faint" aria-hidden>
              →
            </span>
          </Link>
        </Section>
      </div>

      {viewerPhoto && (
        <PhotoViewer
          photos={data.recentPhotos}
          index={data.recentPhotos.findIndex((p) => p.id === viewerPhoto.id)}
          collections={collections}
          onIndexChange={(index) => setViewer(data.recentPhotos[index]?.id ?? null)}
          onClose={() => setViewer(null)}
          onToggleFavorite={toggleFavorite}
          onEdit={() => {
            setViewer(null);
            navigate(`/memories?photo=${viewerPhoto.id}&edit=1`);
          }}
          onShare={() => {
            toasts.success('Open Messages to share this memory. 💬');
            setViewer(null);
            navigate('/messages');
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

function formatMemories(counts: HomeSummary['counts']): string {
  const parts: string[] = [];
  if (counts.photos) parts.push(`${counts.photos} photo${counts.photos === 1 ? '' : 's'}`);
  if (counts.diary) parts.push(`${counts.diary} diary entr${counts.diary === 1 ? 'y' : 'ies'}`);
  if (parts.length === 0) return 'not much yet';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function QuickActions({
  onPhotos,
  onDiary,
  onCollection,
  onMessage,
}: {
  onPhotos: () => void;
  onDiary: () => void;
  onCollection: () => void;
  onMessage: () => void;
}) {
  const actions = [
    { label: 'Send a Message', emoji: '💬', onClick: onMessage, tint: 'bg-rose-100/70 text-rose-700' },
    { label: 'Write a Diary', emoji: '📝', onClick: onDiary, tint: 'bg-sand-100 text-sand-500' },
    { label: 'Add Photos', emoji: '📸', onClick: onPhotos, tint: 'bg-sage-100 text-sage-600' },
    { label: 'Create Collection', emoji: '📁', onClick: onCollection, tint: 'bg-rose-50 text-rose-600' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
      {actions.map((action, index) => (
        <motion.button
          key={action.label}
          type="button"
          onClick={action.onClick}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
          whileTap={{ scale: 0.97 }}
          className="card flex flex-col items-start gap-2.5 p-4 text-left transition-shadow hover:shadow-lift sm:p-5"
        >
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg ${action.tint}`}>
            {action.emoji}
          </span>
          <span className="text-sm font-medium leading-snug text-ink">{action.label}</span>
        </motion.button>
      ))}
    </div>
  );
}

function PartnerStrip({
  name,
  avatar,
  avatarId,
  isOnline,
  lastSeenAt,
  lastMessage,
  myId,
  unread,
}: {
  name: string;
  avatar: string | null;
  avatarId?: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  lastMessage: HomeSummary['lastMessage'];
  myId: string;
  unread: number;
}) {
  const [typing, setTyping] = useState(false);
  const [wasTyping, setWasTyping] = useState(false);

  useRealtime('typing:start', () => {
    setTyping(true);
    setWasTyping(true);
  });
  useRealtime('typing:stop', () => setTyping(false));

  useEffect(() => {
    if (!typing) return;
    const timer = window.setTimeout(() => setTyping(false), 4000);
    return () => window.clearTimeout(timer);
  }, [typing, wasTyping]);

  const preview = typing
    ? 'typing…'
    : lastMessage
      ? `${lastMessage.senderId === myId ? 'You' : name.split(' ')[0]}: ${plainText(lastMessage.content ?? lastMessage.content ?? '') || 'Sent a memory'}`
      : 'This is where your conversations begin ❤️';

  return (
    <div className="card mt-4 flex items-center gap-4 p-4 sm:p-5">
      <div className="relative">
        <Avatar name={name} src={avatar} id={avatarId ?? name} size="lg" showPresence online={isOnline} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white ring-2 ring-surface">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-sans text-ink">{name}</p>
        <p className={`truncate text-sm ${typing ? 'text-rose-600' : 'text-ink-faint'}`}>
          {typing ? 'typing…' : isOnline ? 'Online now' : lastSeenAt ? `Last seen ${relativeTime(lastSeenAt)}` : 'Away'}
        </p>
        <p className="mt-1 truncate text-xs text-ink-faint">{preview}</p>
      </div>

      <Link to="/messages" className="btn-secondary shrink-0">
        💬
      </Link>
    </div>
  );
}

function DiaryCard({ entry }: { entry: HomeSummary['recentDiary'][number] }) {
  const mood = moodMeta(entry.mood);
  const preview = plainText(entry.content).slice(0, 130);

  return (
    <li>
      <Link
        to={`/diary/${entry.id}`}
        className="card block h-full p-5 transition-shadow hover:shadow-lift"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="muted">{friendlyDay(entry.entryDate)}</p>
          {entry.isFavorite && <span aria-hidden>❤️</span>}
        </div>

        <h3 className="mt-1.5 font-sans text-[1.05rem] leading-snug text-ink">{entry.title}</h3>

        {preview && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-soft">{preview}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {mood && (
            <span className="chip">
              {mood.emoji} {mood.label}
            </span>
          )}
          <VisibilityPill visibility={entry.visibility} />
          {entry.collection && <Chip>{entry.collection.name}</Chip>}
        </div>

        {entry.tags.length > 0 && (
          <div className="mt-3">
            <TagRow tags={entry.tags} />
          </div>
        )}
      </Link>
    </li>
  );
}

function CollectionCard({ collection }: { collection: Collection }) {
  return (
    <Link
      to={`/collections/${collection.id}`}
      className="group card block overflow-hidden transition-shadow hover:shadow-lift"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-surface-sunk">
        {collection.coverThumbnailUrl ? (
          <img
            src={collection.coverThumbnailUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl opacity-40" aria-hidden>
            📁
          </div>
        )}
      </div>

      <div className="p-4">
        <h3 className="font-sans text-ink">{collection.name}</h3>
        {collection.description && (
          <p className="mt-1 line-clamp-2 text-sm text-ink-faint">{collection.description}</p>
        )}
        <p className="mt-2.5 text-xs text-ink-faint">
          {collection.photoCount} photo{collection.photoCount === 1 ? '' : 's'} · {collection.diaryCount} diary entr
          {collection.diaryCount === 1 ? 'y' : 'ies'}
        </p>
      </div>
    </Link>
  );
}

