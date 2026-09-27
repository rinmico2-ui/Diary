import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Avatar } from './ui';
import { Menu, MenuItem } from './Sheet';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import type { Message, Session } from '../lib/types';
import { clockTime, friendlyDay, messageTime, plainText } from '../lib/format';
import { toasts } from '../lib/toast';

const QUICK_REACTIONS = ['❤️', '🥰', '😂', '🥹', '🔥', '😘'];

interface ThreadProps {
  messages: Message[];
  session: Session;
  onOpenMemory: (kind: 'photo' | 'diary' | 'collection', id: string) => void;
  onChanged?: () => void;
  /** Home shows a short read-only preview. */
  compact?: boolean;
}

export function MessageThread({ messages, session, onOpenMemory, onChanged, compact = false }: ThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);

  // Stick to the newest message unless the reader has scrolled up.
  useEffect(() => {
    if (compact) return;
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, atBottom, compact]);

  useEffect(() => {
    if (compact) return;
    const node = containerRef.current;
    if (!node) return;

    const onScroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      setAtBottom(distance < 120);
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, [compact]);

  // Mark the partner's messages as read as soon as they are on screen.
  useEffect(() => {
    if (compact || messages.length === 0) return;
    const unread = messages.filter((m) => !m.isRead && m.sender.id !== session.user.id).map((m) => m.id);
    if (unread.length === 0) return;

    const timer = window.setTimeout(() => {
      void api.post('/messages/read', { messageIds: unread }).then(() => onChanged?.()).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [messages, session.user.id, compact, onChanged]);

  if (messages.length === 0) return null;

  const groups = groupMessages(messages);

  return (
    <div className={compact ? '' : 'relative'}>
      <div ref={containerRef} className={compact ? 'max-h-96 overflow-y-auto' : 'flex-1 overflow-y-auto'}>
        {groups.map((group) => (
          <div key={group.key}>
            <DaySeparator label={group.dayLabel} />

            {group.items.map((message, index) => {
              const previous = group.items[index - 1];
              const next = group.items[index + 1];
              const mine = message.sender.id === session.user.id;

              // Grouping: consecutive messages from one person within 5 minutes.
              const groupedWithPrevious =
                previous !== undefined &&
                previous.sender.id === message.sender.id &&
                new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
              const groupedWithNext =
                next !== undefined &&
                next.sender.id === message.sender.id &&
                new Date(next.createdAt).getTime() - new Date(message.createdAt).getTime() < 5 * 60_000;

              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  mine={mine}
                  showAvatar={!groupedWithPrevious}
                  tail={!groupedWithNext}
                  session={session}
                  onOpenMemory={onOpenMemory}
                  onChanged={onChanged}
                  compact={compact}
                />
              );
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {!compact && !atBottom && (
        <button
          type="button"
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
          className="absolute bottom-4 left-1/2 flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-xs text-ink-soft shadow-float transition-transform active:scale-95"
        >
          ↓ New messages
        </button>
      )}
    </div>
  );
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-line" />
      <span className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

interface Group {
  key: string;
  dayLabel: string;
  items: Message[];
}

/** Splits a flat message list into day buckets for the date separators. */
function groupMessages(messages: Message[]): Group[] {
  const groups: Group[] = [];

  for (const message of messages) {
    const dayKey = new Date(message.createdAt).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.key === dayKey) last.items.push(message);
    else groups.push({ key: dayKey, dayLabel: friendlyDay(message.createdAt), items: [message] });
  }

  return groups;
}

interface BubbleProps {
  message: Message;
  mine: boolean;
  showAvatar: boolean;
  tail: boolean;
  session: Session;
  onOpenMemory: (kind: 'photo' | 'diary' | 'collection', id: string) => void;
  onChanged?: () => void;
  compact?: boolean;
}

function MessageBubble({
  message,
  mine,
  showAvatar,
  tail,
  session,
  onOpenMemory,
  onChanged,
  compact,
}: BubbleProps) {
  const [showReactions, setShowReactions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content ?? '');

  const react = async (emoji: string) => {
    setShowReactions(false);
    try {
      await api.post(`/messages/${message.id}/reactions`, { emoji });
      onChanged?.();
    } catch {
      toasts.error('That reaction did not stick.');
    }
  };

  const saveEdit = async () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === message.content) return;
    try {
      await api.patch(`/messages/${message.id}`, { content: next });
      onChanged?.();
    } catch {
      toasts.error('That message could not be edited.');
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/messages/${message.id}`);
      onChanged?.();
    } catch {
      toasts.error('That message could not be deleted.');
    }
  };

  const toggleFavorite = async () => {
    try {
      await api.patch(`/messages/${message.id}/favorite`, { favorite: !message.isFavorite });
      onChanged?.();
    } catch {
      toasts.error('Could not update your favourites.');
    }
  };

  if (message.isDeleted) {
    return (
      <div id={`msg-${message.id}`} className={`flex ${mine ? 'justify-end' : 'justify-start'} px-1 py-0.5`}>
        <p className="rounded-2xl bg-surface-sunk px-3.5 py-2 text-xs italic text-ink-faint">This message was deleted</p>
      </div>
    );
  }

  const bubbleTone = mine
    ? 'bg-rose-500 text-white shadow-card'
    : 'border border-line bg-surface text-ink shadow-card';

  return (
    <motion.div
      id={`msg-${message.id}`}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      className={`group/bubble flex items-end gap-2 px-1 ${mine ? 'flex-row-reverse' : ''} ${showAvatar ? 'mt-2.5' : 'mt-0.5'}`}
    >
      <div className="w-8 shrink-0">
        {showAvatar && !mine && (
          <Avatar name={message.sender.name} src={message.sender.profileImage} id={message.sender.id} size="sm" />
        )}
      </div>

      <div className={`relative max-w-[min(78%,26rem)] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
        {message.replyTo && (
          <button
            type="button"
            onClick={() => document.getElementById(`msg-${message.replyTo!.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className={`mb-1 flex max-w-full items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-left text-[11px] transition-colors ${
              mine ? 'bg-rose-600/40 text-white/90 hover:bg-rose-600/60' : 'bg-surface-sunk text-ink-faint hover:bg-rose-50'
            }`}
          >
            <span className="shrink-0 opacity-70">↩</span>
            <span className="truncate">
              <span className="font-medium">{message.replyTo.senderName.split(' ')[0]}:</span> {message.replyTo.preview}
            </span>
          </button>
        )}

        <div className={`relative rounded-2xl px-3.5 py-2 ${bubbleTone} ${tail ? '' : 'rounded-bl-md sm:rounded-bl-md'} ${mine ? 'rounded-br-md' : 'rounded-bl-md'}`}>
          {message.type === 'IMAGE' && message.attachment && (
            <img
              src={message.attachment.thumbnailUrl ?? message.attachment.url}
              alt={message.content ?? 'Shared photo'}
              loading="lazy"
              className="mb-1.5 max-h-72 w-full rounded-xl object-cover"
            />
          )}

          {message.type === 'VOICE' && message.attachment && (
            <VoiceNote url={message.attachment.url} duration={message.attachment.durationSeconds} mine={mine} />
          )}

          {message.sharedPhoto && (
            <MemoryCard
              emoji="📸"
              label="Shared a memory"
              title={message.sharedPhoto.caption ?? 'Untitled memory'}
              imageUrl={message.sharedPhoto.thumbnailUrl ?? message.sharedPhoto.imageUrl}
              meta={
                message.sharedPhoto.collectionName ??
                message.sharedPhoto.diaryTitle ??
                friendlyDay(message.sharedPhoto.photoDate)
              }
              onClick={() => onOpenMemory('photo', message.sharedPhoto!.id)}
              mine={mine}
            />
          )}

          {message.sharedDiary && (
            <MemoryCard
              emoji="📝"
              label="Shared a diary entry"
              title={message.sharedDiary.title}
              preview={message.sharedDiary.preview}
              meta={`${friendlyDay(message.sharedDiary.entryDate)} · ${message.sharedDiary.photoCount} photo${
                message.sharedDiary.photoCount === 1 ? '' : 's'
              }`}
              onClick={() => onOpenMemory('diary', message.sharedDiary!.id)}
              mine={mine}
            />
          )}

          {message.sharedCollection && (
            <MemoryCard
              emoji="📁"
              label="Shared a collection"
              title={message.sharedCollection.name}
              preview={message.sharedCollection.description}
              imageUrl={message.sharedCollection.coverThumbnailUrl}
              meta={`${message.sharedCollection.photoCount} photo${
                message.sharedCollection.photoCount === 1 ? '' : 's'
              } · ${message.sharedCollection.diaryCount} diary entr${
                message.sharedCollection.diaryCount === 1 ? 'y' : 'ies'
              }`}
              onClick={() => onOpenMemory('collection', message.sharedCollection!.id)}
              mine={mine}
            />
          )}

          {message.type === 'TEXT' && editing ? (
            <div className="min-w-48">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void saveEdit();
                  }
                  if (event.key === 'Escape') setEditing(false);
                }}
                className="w-full resize-none rounded-lg bg-white/15 p-2 text-sm text-white outline-none ring-1 ring-white/30"
                rows={2}
                autoFocus
              />
              <div className="mt-1.5 flex justify-end gap-1.5">
                <button type="button" onClick={() => setEditing(false)} className="rounded-full px-2.5 py-1 text-xs text-white/70 hover:bg-white/10">
                  Cancel
                </button>
                <button type="button" onClick={saveEdit} className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/30">
                  Save
                </button>
              </div>
            </div>
          ) : (
            message.content && (
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{message.content}</p>
            )
          )}

          <div className={`mt-0.5 flex items-center gap-1.5 text-[10px] ${mine ? 'text-white/65' : 'text-ink-faint'}`}>
            <span>{compact ? clockTime(message.createdAt) : messageTime(message.createdAt)}</span>
            {message.isEdited && <span>· edited</span>}
            {mine && !compact && (
              <span aria-label={message.isRead ? 'Read' : 'Delivered'}>
                {message.isRead ? '· Read' : '· Delivered'}
              </span>
            )}
          </div>
        </div>

        {message.reactions.length > 0 && (
          <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : ''}`}>
            {message.reactions.map((reaction) => {
              const mineReacted = reaction.userIds.includes(session.user.id);
              return (
                <button
                  key={reaction.emoji}
                  type="button"
                  onClick={() => react(reaction.emoji)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-all active:scale-90 ${
                    mineReacted
                      ? 'border-rose-300 bg-rose-50 text-rose-700'
                      : 'border-line bg-surface text-ink-soft'
                  }`}
                >
                  <span>{reaction.emoji}</span>
                  {reaction.count > 1 && <span className="tabular-nums">{reaction.count}</span>}
                </button>
              );
            })}
          </div>
        )}

        {!compact && (
          <>
            <AnimatePresence>
              {showReactions && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.15 }}
                  className={`absolute -top-9 z-10 flex gap-0.5 rounded-full border border-line bg-surface p-1 shadow-float ${
                    mine ? 'right-0' : 'left-0'
                  }`}
                >
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => react(emoji)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-base transition-transform hover:scale-125 active:scale-95"
                    >
                      {emoji}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Hover actions on desktop, long-press menu handled by the page on mobile. */}
            <div
              className={`absolute -top-3 hidden gap-0.5 opacity-0 transition-opacity group-hover/bubble:opacity-100 sm:flex ${
                mine ? 'left-0' : 'right-0'
              }`}
            >
              <button
                type="button"
                onClick={() => setShowReactions((v) => !v)}
                aria-label="React"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface text-xs shadow-card transition-transform hover:scale-110"
              >
                😊
              </button>

              <Menu
                align={mine ? 'left' : 'right'}
                trigger={({ toggle }) => (
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label="Message options"
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface text-xs shadow-card transition-transform hover:scale-110"
                  >
                    ⋯
                  </button>
                )}
              >
                {(close) => (
                  <>
                    {message.sender.id !== session.user.id && (
                      <MenuItem
                        onClick={() => {
                          close();
                          getSocket().emit('message:reply-request', { messageId: message.id });
                          window.dispatchEvent(new CustomEvent('reply-to', { detail: message.id }));
                        }}
                      >
                        ↩ Reply
                      </MenuItem>
                    )}
                    {message.sender.id === session.user.id && message.type === 'TEXT' && (
                      <MenuItem
                        onClick={() => {
                          close();
                          setDraft(message.content ?? '');
                          setEditing(true);
                        }}
                      >
                        ✏️ Edit
                      </MenuItem>
                    )}
                    <MenuItem
                      onClick={() => {
                        close();
                        void toggleFavorite();
                      }}
                    >
                      {message.isFavorite ? '💔 Unfavourite' : '❤️ Favourite'}
                    </MenuItem>
                    {message.sender.id === session.user.id && (
                      <MenuItem
                        danger
                        onClick={() => {
                          close();
                          void remove();
                        }}
                      >
                        🗑️ Delete
                      </MenuItem>
                    )}
                  </>
                )}
              </Menu>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

function MemoryCard({
  emoji,
  label,
  title,
  preview,
  imageUrl,
  meta,
  onClick,
  mine,
}: {
  emoji: string;
  label: string;
  title: string;
  preview?: string | null;
  imageUrl?: string | null;
  meta?: string;
  onClick: () => void;
  mine: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 block w-full overflow-hidden rounded-xl text-left transition-transform active:scale-[0.98] ${
        mine ? 'bg-white/15' : 'bg-surface-sunk'
      }`}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" loading="lazy" className="max-h-44 w-full object-cover" />
      ) : null}

      <div className="p-3">
        <p className={`text-[11px] ${mine ? 'text-white/75' : 'text-ink-faint'}`}>
          {emoji} {label}
        </p>
        <p className={`mt-0.5 font-sans text-sm leading-snug ${mine ? 'text-white' : 'text-ink'}`}>{title}</p>
        {preview && (
          <p className={`mt-1 line-clamp-2 text-xs leading-relaxed ${mine ? 'text-white/80' : 'text-ink-soft'}`}>
            {preview}
          </p>
        )}
        <p className={`mt-2 text-[11px] ${mine ? 'text-white/70' : 'text-ink-faint'}`}>
          {meta}
          <span className="ml-1.5">View Memory →</span>
        </p>
      </div>
    </button>
  );
}

function VoiceNote({ url, duration, mine }: { url: string; duration: number | null; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const total = duration ?? 0;

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void audio.play();
      setPlaying(true);
    }
  };

  return (
    <div className="flex min-w-44 items-center gap-2.5">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${
          mine ? 'bg-white/25 text-white' : 'bg-rose-100 text-rose-600'
        }`}
      >
        {playing ? '⏸' : '▶'}
      </button>

      <div className="flex-1">
        <div className={`h-1.5 overflow-hidden rounded-full ${mine ? 'bg-white/25' : 'bg-surface-sunk'}`}>
          <div
            className={`h-full rounded-full transition-all ${mine ? 'bg-white' : 'bg-rose-400'}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      <span className={`shrink-0 text-[11px] tabular-nums ${mine ? 'text-white/75' : 'text-ink-faint'}`}>
        {formatElapsed(playing ? elapsed : total)}
      </span>

      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          if (audio.duration > 0) {
            setProgress(audio.currentTime / audio.duration);
            setElapsed(audio.currentTime);
          }
        }}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          setElapsed(0);
        }}
      />
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export { plainText };
