import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApi, useDebouncedCallback } from '../lib/hooks';
import { api, query } from '../lib/api';
import { useRealtime } from '../lib/socket';
import { useAddMemory } from '../lib/addMemory';
import { PageHeader } from '../components/Nav';
import { EmptyState, Skeleton } from '../components/ui';
import { TagRow, VisibilityPill, FavoriteButton } from '../components/Memory';
import { moodMeta, MOODS, type DiaryEntry, type Mood, type Session, type TagSummary } from '../lib/types';
import { longDate, plainText } from '../lib/format';

export function DiaryPage({ session }: { session: Session }) {
  const [mood, setMood] = useState<Mood | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const { open } = useAddMemory();

  const path = `/diary${query({
    limit: 40,
    mood: mood ?? undefined,
    favoritesOnly: favoritesOnly ? 'true' : undefined,
    // Always the real id from the session — the server rejects anyone else's.
    authorId: mineOnly ? session.user.id : undefined,
    search: search || undefined,
    tag: tag ?? undefined,
  })}`;

  const { data, loading, reload, setData } = useApi<{ items: DiaryEntry[]; total: number }>(path);
  const tags = useApi<{ tags: TagSummary[] }>('/diary/tags');

  const reloadSoon = useDebouncedCallback(() => reload(), 400);
  useRealtime('memory:created', () => reloadSoon());
  useRealtime('memory:updated', () => reloadSoon());
  useRealtime('memory:deleted', () => reloadSoon());

  const toggleFavorite = async (entry: DiaryEntry) => {
    const next = !entry.isFavorite;
    setData((current) =>
      current
        ? { ...current, items: current.items.map((e) => (e.id === entry.id ? { ...e, isFavorite: next } : e)) }
        : current,
    );
    try {
      await api.patch(`/diary/${entry.id}/favorite`, { favorite: next });
    } catch {
      reload();
    }
  };

  const filtersActive = Boolean(mood || favoritesOnly || tag || search);

  return (
    <div className="page">
      <PageHeader
        eyebrow="📖 Diary"
        title="Your story, in your words"
        action={
          <button type="button" className="btn-primary" onClick={() => open('diary')}>
            📝 Write
          </button>
        }
      />

      <div className="mb-6 space-y-3">
        <input
          className="field"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search your entries…"
          aria-label="Search diary"
        />

        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <FilterChip active={!filtersActive} onClick={() => { setMood(null); setFavoritesOnly(false); setTag(null); setSearch(''); }}>
            All
          </FilterChip>
          <FilterChip active={favoritesOnly} onClick={() => setFavoritesOnly((v) => !v)}>
            ❤️ Favourites
          </FilterChip>
          <FilterChip active={mineOnly} onClick={() => setMineOnly((v) => !v)}>
            ✍️ Written by me
          </FilterChip>
          {MOODS.map((item) => (
            <FilterChip key={item.value} active={mood === item.value} onClick={() => setMood(mood === item.value ? null : item.value)}>
              {item.emoji} {item.label}
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
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-36 w-full" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        filtersActive ? (
          <EmptyState emoji="🔍" title="Nothing matched" body="Try a different mood, tag or phrase." />
        ) : (
          <EmptyState
            emoji="✨"
            title="Your story starts here"
            body="The smallest day is worth writing down. Future you will be glad you did."
            action={
              <button type="button" className="btn-primary" onClick={() => open('diary')}>
                Write Something
              </button>
            }
          />
        )
      ) : (
        <ul className="space-y-3">
          {data.items.map((entry, index) => (
            <EntryCard key={entry.id} entry={entry} index={index} onToggleFavorite={toggleFavorite} />
          ))}
        </ul>
      )}
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

export function EntryCard({
  entry,
  index = 0,
  onToggleFavorite,
}: {
  entry: DiaryEntry;
  index?: number;
  onToggleFavorite?: (entry: DiaryEntry) => void;
}) {
  const mood = moodMeta(entry.mood);
  const preview = plainText(entry.content);

  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: Math.min(index * 0.03, 0.25), ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="card group relative p-5 transition-shadow hover:shadow-lift">
        <Link to={`/diary/${entry.id}`} className="block pr-10">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
            <span>{longDate(entry.entryDate)}</span>
            <span aria-hidden>·</span>
            <span>{entry.isOwn ? 'You' : entry.author.name}</span>
            <VisibilityPill visibility={entry.visibility} />
          </div>

          <h3 className="mt-2 font-sans text-xl leading-snug text-ink">{entry.title}</h3>

          {preview && <p className="mt-2 line-clamp-3 text-[15px] leading-relaxed text-ink-soft">{preview}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {mood && (
              <span className="chip">
                {mood.emoji} {mood.label}
              </span>
            )}
            {entry.collection && <span className="chip">📁 {entry.collection.name}</span>}
            {entry.photoCount > 0 && (
              <span className="chip">
                📸 {entry.photoCount}
              </span>
            )}
          </div>

          {entry.tags.length > 0 && (
            <div className="mt-3">
              <TagRow tags={entry.tags} />
            </div>
          )}
        </Link>

        <div className="absolute right-3 top-3">
          <FavoriteButton
            isFavorite={entry.isFavorite}
            size="sm"
            onToggle={() => onToggleFavorite?.(entry)}
            className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
          />
        </div>
      </div>
    </motion.li>
  );
}
