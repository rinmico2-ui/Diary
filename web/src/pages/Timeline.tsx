import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApi } from '../lib/hooks';
import { PageHeader } from '../components/Nav';
import { EmptyState, Skeleton } from '../components/ui';
import { PhotoGrid } from '../components/PhotoGrid';
import { moodMeta, type TimelineMonth, type Photo } from '../lib/types';
import { monthLabel, pluralise, shortDay } from '../lib/format';

export function TimelinePage() {
  const [months, setMonths] = useState(6);
  const { data, loading } = useApi<{ months: TimelineMonth[] }>(`/timeline?months=${months}&limit=8`);
  const navigate = useNavigate();

  const totals = (data?.months ?? []).reduce(
    (accumulator, month) => ({
      photos: accumulator.photos + month.totals.photos,
      diary: accumulator.diary + month.totals.diary,
      messages: accumulator.messages + month.totals.messages,
    }),
    { photos: 0, diary: 0, messages: 0 },
  );

  const hasEverything = totals.photos + totals.diary + totals.messages === 0;

  return (
    <div className="page max-w-4xl">
      <PageHeader eyebrow="📅 Timeline" title="How your story unfolded">
        {data && !hasEverything && (
          <p className="mt-1.5 text-sm text-ink-soft">
            {pluralise(totals.photos, 'photo')} · {pluralise(totals.diary, 'diary entry', 'diary entries')} ·{' '}
            {pluralise(totals.messages, 'message')}
          </p>
        )}
      </PageHeader>

      <div className="mb-6 flex gap-1 rounded-2xl bg-surface-sunk p-1">
        {[
          { value: 3, label: '3 months' },
          { value: 6, label: '6 months' },
          { value: 12, label: 'A year' },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setMonths(option.value)}
            className={`flex-1 rounded-xl px-3 py-2 text-sm transition-all ${
              months === option.value ? 'bg-surface font-medium text-ink shadow-card' : 'text-ink-faint hover:text-ink-soft'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-40 w-full" />
          ))}
        </div>
      ) : hasEverything ? (
        <EmptyState
          emoji="📅"
          title="Your timeline is waiting"
          body="As you add photos, write entries and send messages, each day will gather here in order."
        />
      ) : (
        <div className="space-y-10">
          {data?.months.map((month) => (
            <section key={month.month}>
              <h2 className="sticky top-0 z-10 -mx-1 mb-4 bg-canvas/90 px-1 py-2 font-sans text-xl text-ink backdrop-blur">
                {monthLabel(month.month)}
              </h2>

              <div className="relative space-y-6 border-l border-line pl-5 sm:pl-7">
                {month.days.map((day, index) => (
                  <motion.div
                    key={day.date}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.32, delay: Math.min(index * 0.04, 0.3), ease: [0.22, 1, 0.36, 1] }}
                    className="relative"
                  >
                    <span
                      aria-hidden
                      className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-canvas bg-rose-300 sm:-left-[2.1rem]"
                    />

                    <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 className="font-sans text-base text-ink">{shortDay(day.date)}</h3>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                        {day.photos.length > 0 && <span>📸 {day.photos.length} photo{day.photos.length === 1 ? '' : 's'}</span>}
                        {day.diaryEntries.length > 0 && (
                          <span>
                            📝 {day.diaryEntries.length} entr{day.diaryEntries.length === 1 ? 'y' : 'ies'}
                          </span>
                        )}
                        {day.messageCount > 0 && (
                          <span>
                            💬 {day.messageCount} message{day.messageCount === 1 ? '' : 's'}
                          </span>
                        )}
                        {day.favoriteCount > 0 && <span className="text-rose-500">❤️ {day.favoriteCount}</span>}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {day.photos.length > 0 && (
                        <div className="card overflow-hidden p-3">
                          <PhotoGrid
                            photos={day.photos.slice(0, 6) as Photo[]}
                            onOpen={(photo) => navigate(`/memories?photo=${photo.id}`)}
                            columns={6}
                          />
                        </div>
                      )}

                      {day.diaryEntries.map((entry) => {
                        const mood = moodMeta(entry.mood);
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => navigate(`/diary/${entry.id}`)}
                            className="card block w-full p-4 text-left transition-shadow hover:shadow-lift"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="font-sans text-ink">
                                {mood ? <span className="mr-1.5">{mood.emoji}</span> : null}
                                “{entry.title}”
                              </p>
                              {entry.isFavorite && <span aria-hidden>❤️</span>}
                            </div>
                            {entry.photoCount > 0 && (
                              <p className="mt-1.5 text-xs text-ink-faint">📸 {entry.photoCount} photo{entry.photoCount === 1 ? '' : 's'}</p>
                            )}
                          </button>
                        );
                      })}

                      {day.messageCount > 0 && (
                        <button
                          type="button"
                          onClick={() => navigate('/messages')}
                          className="card block w-full p-4 text-left transition-shadow hover:shadow-lift"
                        >
                          <p className="text-sm text-ink-soft">
                            💬 {pluralise(day.messageCount, 'message')}
                            {day.messagePreview ? (
                              <span className="mt-1 block truncate text-xs text-ink-faint">
                                “{day.messagePreview}”
                              </span>
                            ) : null}
                          </p>
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-12 text-center text-xs text-ink-faint">
        Days are grouped from your photos, diary entries and messages together.
      </p>
    </div>
  );
}
