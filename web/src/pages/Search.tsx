import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Nav';
import { EmptyState, Skeleton, Avatar } from '../components/ui';
import { PhotoGrid } from '../components/PhotoGrid';
import { EntryCard } from './Diary';
import { useApi, useDebounced } from '../lib/hooks';
import { query } from '../lib/api';
import type { SearchResults } from '../lib/types';
import { longDate, pluralise } from '../lib/format';

export function SearchPage() {
  const [raw, setRaw] = useState('');
  const debounced = useDebounced(raw, 280);
  const navigate = useNavigate();

  const hasQuery = debounced.trim().length > 0;
  const { data, loading } = useApi<SearchResults>(
    hasQuery ? `/search${query({ q: debounced.trim(), limit: 20 })}` : null,
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        document.getElementById('global-search')?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="page max-w-4xl">
      <PageHeader eyebrow="🔍 Search" title="Find anything you've saved" />

      <div className="sticky top-0 z-20 -mx-4 mb-6 bg-canvas/90 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <input
          id="global-search"
          className="field text-base"
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          placeholder="Search messages, diary, photos, collections, tags…"
          autoComplete="off"
          aria-label="Search everything"
        />
        {raw.length > 0 && (
          <button
            type="button"
            onClick={() => setRaw('')}
            className="btn-ghost mt-2 h-8 px-3 text-xs"
          >
            Clear
          </button>
        )}
      </div>

      {!hasQuery ? (
        <EmptyState
          emoji="🔍"
          title="Search your whole space"
          body="Try a word like “birthday”, a tag like #travel, or a phrase from a message."
        />
      ) : loading && !data ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !data || data.total === 0 ? (
        <EmptyState
          emoji="🌙"
          title={`Nothing found for “${debounced}”`}
          body="Try a different word, or check the spelling."
        />
      ) : (
        <div className="space-y-9">
          {data.collections.length > 0 && (
            <section>
              <h2 className="mb-3 px-1 font-sans text-lg text-ink">📁 Collections</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {data.collections.map((collection) => (
                  <li key={collection.id}>
                    <Link to={`/collections/${collection.id}`} className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-lift">
                      {collection.coverThumbnailUrl ? (
                        <img src={collection.coverThumbnailUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
                      ) : (
                        <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-surface-sunk text-2xl">📁</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-sans text-ink">{collection.name}</p>
                        <p className="truncate text-xs text-ink-faint">
                          {pluralise(collection.photoCount, 'photo')} · {pluralise(collection.diaryCount, 'entry', 'entries')}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.tags.length > 0 && (
            <section>
              <h2 className="mb-3 px-1 font-sans text-lg text-ink">🏷️ Tags</h2>
              <div className="flex flex-wrap gap-2">
                {data.tags.map((tag) => (
                  <Link
                    key={tag.name}
                    to={`/search?q=${encodeURIComponent(tag.name)}`}
                    onClick={() => setRaw(tag.name)}
                    className="chip hover:border-rose-300 hover:bg-rose-50"
                  >
                    #{tag.name}
                    <span className="text-ink-faint">{tag.photoCount + tag.entryCount}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {data.diaryEntries.length > 0 && (
            <section>
              <h2 className="mb-3 px-1 font-sans text-lg text-ink">📖 Diary</h2>
              <ul className="space-y-3">
                {data.diaryEntries.map((entry, index) => (
                  <li key={entry.id}>
                    <EntryCard entry={entry} index={index} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.photos.length > 0 && (
            <section>
              <h2 className="mb-3 px-1 font-sans text-lg text-ink">📸 Photos</h2>
              <PhotoGrid
                photos={data.photos}
                onOpen={(photo) => navigate(`/memories?photo=${photo.id}`)}
                columns={5}
              />
            </section>
          )}

          {data.messages.length > 0 && (
            <section>
              <h2 className="mb-3 px-1 font-sans text-lg text-ink">💬 Messages</h2>
              <ul className="space-y-2">
                {data.messages.map((message) => (
                  <li key={message.id}>
                    <button
                      type="button"
                      onClick={() => navigate('/messages')}
                      className="card flex w-full items-start gap-3 p-4 text-left transition-shadow hover:shadow-lift"
                    >
                      <Avatar name={message.sender.name} src={message.sender.profileImage} id={message.sender.id} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-ink-faint">
                          {message.sender.name} · {longDate(message.createdAt)}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{message.content}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
