import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useApi, useDebouncedCallback } from '../lib/hooks';
import { api, upload } from '../lib/api';
import { useRealtime, useTypingSignal } from '../lib/socket';
import { MessageThread } from '../components/MessageThread';
import { Sheet, ConfirmDialog } from '../components/Sheet';
import { Avatar, EmptyState, Spinner } from '../components/ui';
import type { Collection, DiaryEntry, Message, Photo, Session } from '../lib/types';
import { relativeTime } from '../lib/format';
import { toasts } from '../lib/toast';
import { moodMeta } from '../lib/types';

export function MessagesPage({ session }: { session: Session }) {
  const { data, loading, reload } = useApi<{ messages: Message[] }>('/messages?limit=150');
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const sendTyping = useTypingSignal(session.partner?.id ?? null);
  const listEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const messages = data?.messages ?? [];
  const reloadSoon = useDebouncedCallback(() => reload(), 250);

  useRealtime('message:created', (payload) => {
    const { messageId } = (payload ?? {}) as { messageId: string };
    if (!messageId) return;
    void api
      .get<{ message: Message }>(`/messages/${messageId}`)
      .then(() => reload())
      .catch(() => undefined);
  });
  useRealtime('message:updated', () => reloadSoon());
  useRealtime('message:deleted', () => reloadSoon());
  useRealtime('reaction:added', () => reloadSoon());
  useRealtime('reaction:removed', () => reloadSoon());

  useRealtime('typing:start', () => setPartnerTyping(true));
  useRealtime('typing:stop', () => setPartnerTyping(false));

  useEffect(() => {
    if (!partnerTyping) return;
    const timer = window.setTimeout(() => setPartnerTyping(false), 4000);
    return () => window.clearTimeout(timer);
  }, [partnerTyping]);

  // The reply menu raises a window event; keep the composer in sync.
  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      const found = messages.find((m) => m.id === id);
      if (found) {
        setReplyTo(found);
        composerRef.current?.focus();
      }
    };
    window.addEventListener('reply-to', handler);
    return () => window.removeEventListener('reply-to', handler);
  }, [messages]);

  // Deep link from a notification: /messages?replyTo=id
  useEffect(() => {
    const id = searchParams.get('replyTo');
    if (!id || messages.length === 0) return;
    const found = messages.find((m) => m.id === id);
    if (found) setReplyTo(found);
    setSearchParams({}, { replace: true });
  }, [searchParams, messages, setSearchParams]);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending) return;

    setSending(true);
    setDraft('');
    sendTyping(false);

    try {
      await api.post<{ message: Message }>('/messages', {
        type: 'TEXT',
        content,
        replyToMessageId: replyTo?.id ?? null,
      });
      setReplyTo(null);
      await reload();
      listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
      setDraft(content);
      toasts.error(error instanceof Error ? error.message : 'That message did not send.');
    } finally {
      setSending(false);
    }
  }, [draft, sending, replyTo, sendTyping, reload]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const partner = session.partner;

  return (
    <div className="flex h-[100dvh] flex-col sm:ml-64 lg:ml-72">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-canvas/85 px-4 py-3 backdrop-blur-xl sm:px-6">
        <button type="button" onClick={() => navigate(-1)} className="btn-ghost -ml-2 h-9 w-9 p-0 text-lg sm:hidden" aria-label="Back">
          ‹
        </button>

        {partner && (
          <>
            <Avatar name={partner.name} src={partner.profileImage} id={partner.id} size="md" showPresence online={partner.isOnline} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-sans text-lg leading-tight text-ink">{partner.name}</h1>
              <p className={`truncate text-xs ${partnerTyping ? 'text-rose-600' : 'text-ink-faint'}`}>
                {partnerTyping ? 'typing…' : partner.isOnline ? 'Online now' : partner.lastSeenAt ? `Last seen ${relativeTime(partner.lastSeenAt)}` : 'Away'}
              </p>
            </div>
          </>
        )}

        <button
          type="button"
          onClick={() => setConfirmClear(true)}
          aria-label="Chat options"
          className="btn-ghost h-9 w-9 p-0 text-lg"
        >
          ⋯
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="h-6 w-6 text-rose-400" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6">
            <EmptyState
              emoji="💬"
              title="This is where your conversations begin ❤️"
              body="Say anything. Even just a good morning."
              action={
                <button type="button" className="btn-primary" onClick={() => composerRef.current?.focus()}>
                  Send a Message
                </button>
              }
              className="border-0 bg-transparent"
            />
          </div>
        ) : (
          <div className="h-full overflow-y-auto px-3 py-2 sm:px-6">
            <div className="mx-auto max-w-3xl">
              <MessageThread
                messages={messages}
                session={session}
                onChanged={reload}
                onOpenMemory={(kind, id) => {
                  if (kind === 'collection') navigate(`/collections/${id}`);
                  else if (kind === 'diary') navigate(`/diary/${id}`);
                  else navigate(`/memories?photo=${id}`);
                }}
              />

              <AnimatePresence>
                {partnerTyping && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    className="flex items-center gap-2 px-11 py-2"
                  >
                    <div className="flex gap-1 rounded-full border border-line bg-surface px-3 py-2">
                      {[0, 1, 2].map((index) => (
                        <motion.span
                          key={index}
                          className="h-1.5 w-1.5 rounded-full bg-ink-faint"
                          animate={{ y: [0, -3, 0] }}
                          transition={{ duration: 0.9, repeat: Infinity, delay: index * 0.15 }}
                        />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={listEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* Composer: sticky, camera-first, keyboard safe. */}
      <div className="kb-safe shrink-0 border-t border-line bg-canvas/90 px-3 py-2.5 backdrop-blur-xl sm:px-6">
        <div className="mx-auto max-w-3xl">
          <AnimatePresence>
            {replyTo && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-2 flex items-center gap-2 overflow-hidden rounded-xl border border-line bg-surface px-3 py-2"
              >
                <span className="text-xs text-ink-faint">↩ Replying to {replyTo.sender.name.split(' ')[0]}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">
                  {replyTo.content ?? replyTo.sharedCollection?.name ?? replyTo.sharedDiary?.title ?? 'A memory'}
                </span>
                <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="text-ink-faint hover:text-ink">
                  ×
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-end gap-1.5">
            <button
              type="button"
              onClick={() => setAttachOpen(true)}
              aria-label="Attach"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-rose-50 hover:text-rose-500"
            >
              ＋
            </button>

            <button
              type="button"
              onClick={() => document.getElementById('chat-camera')?.click()}
              aria-label="Take a photo"
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-rose-50 hover:text-rose-500 sm:flex"
            >
              📷
            </button>

            <div className="relative flex-1">
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  sendTyping(event.target.value.length > 0);
                  grow(event.target);
                }}
                onKeyDown={onKeyDown}
                onBlur={() => sendTyping(false)}
                rows={1}
                placeholder="Type a message…"
                aria-label="Message"
                className="max-h-32 w-full resize-none overflow-y-auto rounded-2xl border border-line bg-surface px-4 py-2.5
                           text-[15px] text-ink placeholder:text-ink-faint focus:border-rose-300 focus:outline-none focus:ring-4 focus:ring-rose-100/60"
                style={{ height: 'auto' }}
              />

              <input
                id="chat-camera"
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) await sendPhoto(file);
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => setShowEmoji((v) => !v)}
              aria-label="Emoji"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-rose-50 hover:text-rose-500"
            >
              😊
            </button>

            <VoiceButton onRecorded={(file, seconds) => sendVoice(file, seconds)} />

            <button
              type="button"
              onClick={send}
              disabled={!draft.trim() || sending}
              aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white
                         shadow-card transition-all active:scale-90 disabled:opacity-40"
            >
              {sending ? <Spinner className="h-4 w-4" /> : '↑'}
            </button>
          </div>

          <AnimatePresence>
            {showEmoji && (
              <EmojiPicker
                onPick={(emoji) => {
                  setDraft((current) => current + emoji);
                  composerRef.current?.focus();
                }}
                onClose={() => setShowEmoji(false)}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      <AttachSheet
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        onSharePhoto={async (photo) => {
          await api.post('/messages', { type: 'MEMORY', sharedPhotoId: photo.id });
          setAttachOpen(false);
          await reload();
          toasts.success('Shared a memory 💬');
        }}
        onShareDiary={async (entry) => {
          await api.post('/messages', { type: 'DIARY', sharedDiaryEntryId: entry.id });
          setAttachOpen(false);
          await reload();
          toasts.success('Shared a diary entry 📝');
        }}
        onShareCollection={async (collection) => {
          await api.post('/messages', { type: 'MEMORY', sharedCollectionId: collection.id });
          setAttachOpen(false);
          await reload();
          toasts.success(`Shared ${collection.name} 📁`);
        }}
        onSendPhoto={async (file) => {
          setAttachOpen(false);
          await sendPhoto(file);
        }}
      />

      <ConfirmDialog
        open={confirmClear}
        title="Chat options"
        body="This conversation is just between the two of you. There is nothing to clear or export here — every message lives in your shared space."
        confirmLabel="Got it"
        cancelLabel="Close"
        onConfirm={() => setConfirmClear(false)}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );

  async function sendPhoto(file: File) {
    if (!file.type.startsWith('image/')) {
      toasts.warn('That file is not a photo.');
      return;
    }
    const form = new FormData();
    form.append('photos', file, file.name);

    try {
      const { promise } = upload<{ uploads: Array<{ attachment: { id: string } }> }>('/uploads/photos', form);
      const result = await promise;
      await api.post('/messages', { type: 'IMAGE', attachmentId: result.uploads[0]?.attachment.id });
      await reload();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'That photo did not send.');
    }
  }

  async function sendVoice(file: File, seconds: number) {
    const form = new FormData();
    form.append('audio', file, file.name);
    form.append('durationSeconds', String(seconds));

    try {
      const { promise } = upload<{ attachment: { id: string } }>('/uploads/voice', form);
      const result = await promise;
      await api.post('/messages', { type: 'VOICE', attachmentId: result.attachment.id });
      await reload();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'That voice note did not send.');
    }
  }
}

/** Records a short voice note; gracefully hidden where recording is unsupported. */
function VoiceButton({ onRecorded }: { onRecorded: (file: File, seconds: number) => void }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [supported, setSupported] = useState(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) setSupported(false);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    if (timerRef.current) window.clearInterval(timerRef.current);
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Prefer a container every modern browser can play back.
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorderRef.current = recorder;
      startedAt.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const elapsed = (Date.now() - startedAt.current) / 1000;

        if (elapsed < 0.6) {
          toasts.warn('Hold a little longer next time.');
        } else {
          const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
          onRecorded(new File([blob], `voice-${Date.now()}.${extension}`, { type: blob.type }), elapsed);
        }

        setRecording(false);
        setSeconds(0);
      };

      recorder.start();
      setRecording(true);
    } catch {
      toasts.warn('Microphone access was not available.');
      setSupported(false);
    }
  }, [onRecorded]);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={recording ? stop : start}
      aria-label={recording ? 'Stop recording' : 'Record a voice message'}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all active:scale-90 ${
        recording ? 'animate-pulse bg-rose-500 text-white' : 'text-ink-faint hover:bg-rose-50 hover:text-rose-500'
      }`}
    >
      {recording ? <span className="text-xs tabular-nums">{seconds}</span> : '🎙'}
    </button>
  );
}

/** Grows the composer with the message, then scrolls it once it hits the cap. */
function grow(element: HTMLTextAreaElement): void {
  element.style.height = 'auto';
  const next = Math.min(element.scrollHeight, 128);
  element.style.height = `${next}px`;
  element.style.overflowY = element.scrollHeight > 128 ? 'auto' : 'hidden';
}

const EMOJI_SET = ['❤️', '🥰', '😍', '😂', '🥹', '😘', '✨', '🌸', '🎉', '🙏', '💪', '🔥', '😴', '🤍', '😌', '😢', '😘', '🌙', '🍿', '☕'];

function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="mt-2 rounded-2xl border border-line bg-surface p-3 shadow-float"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-ink-faint">Tap to add</p>
        <button type="button" onClick={onClose} className="text-xs text-ink-faint hover:text-ink">
          Done
        </button>
      </div>
      <div className="grid grid-cols-10 gap-1">
        {EMOJI_SET.map((emoji, index) => (
          <button
            key={`${emoji}-${index}`}
            type="button"
            onClick={() => onPick(emoji)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-transform hover:scale-125 active:scale-95"
          >
            {emoji}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

/** The ＋ menu: photos, and sharing any existing memory into the chat. */
function AttachSheet({
  open,
  onClose,
  onSharePhoto,
  onShareDiary,
  onShareCollection,
  onSendPhoto,
}: {
  open: boolean;
  onClose: () => void;
  onSharePhoto: (photo: Photo) => void;
  onShareDiary: (entry: DiaryEntry) => void;
  onShareCollection: (collection: Collection) => void;
  onSendPhoto: (file: File) => void;
}) {
  const [tab, setTab] = useState<'memories' | 'diary' | 'collections' | 'camera'>('memories');
  const navigate = useNavigate();

  const photos = useApi<{ items: Photo[] }>(open && tab === 'memories' ? '/photos?limit=40' : null);
  const diary = useApi<{ items: DiaryEntry[] }>(open && tab === 'diary' ? '/diary?limit=30' : null);
  const collections = useApi<{ collections: Collection[] }>(open && tab === 'collections' ? '/collections' : null);

  const tabs = [
    { key: 'memories', label: 'Photo', emoji: '📸' },
    { key: 'diary', label: 'Diary', emoji: '📖' },
    { key: 'collections', label: 'Folder', emoji: '📁' },
  ] as const;

  return (
    <Sheet open={open} onClose={onClose} title="Share something" size="tall">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-surface-sunk p-1">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`rounded-xl px-3 py-2 text-sm transition-all ${
                tab === item.key ? 'bg-surface font-medium text-ink shadow-card' : 'text-ink-faint hover:text-ink-soft'
              }`}
            >
              <span className="mr-1.5">{item.emoji}</span>
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'memories' && (
          <>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              id="attach-camera"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) onSendPhoto(file);
              }}
            />
            <button
              type="button"
              onClick={() => document.getElementById('attach-camera')?.click()}
              className="btn-secondary w-full"
            >
              📷 Take or send a new photo
            </button>

            <div>
              <p className="mb-2 text-xs font-medium text-ink-soft">Or share a memory you already saved</p>
              {photos.data && photos.data.items.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.data.items.map((photo) => (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => onSharePhoto(photo)}
                      className="group relative aspect-square overflow-hidden rounded-xl bg-surface-sunk"
                    >
                      <img
                        src={photo.thumbnailUrl ?? photo.imageUrl}
                        alt={photo.caption ?? ''}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-ink/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
                        Share
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-faint">
                  No photos saved yet.
                </p>
              )}
            </div>
          </>
        )}

        {tab === 'diary' && (
          <div className="space-y-2">
            {diary.data && diary.data.items.length > 0 ? (
              diary.data.items.map((entry) => {
                const mood = moodMeta(entry.mood);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onShareDiary(entry)}
                    className="card flex w-full items-center gap-3 p-3.5 text-left transition-shadow hover:shadow-lift"
                  >
                    <span className="text-xl">{mood?.emoji ?? '📝'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-sans text-sm text-ink">{entry.title}</span>
                      <span className="block truncate text-xs text-ink-faint">
                        {relativeTime(entry.entryDate)}
                        {entry.visibility === 'PRIVATE' ? ' · 🔒 only you' : ''}
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-faint">
                No diary entries yet.
              </p>
            )}
          </div>
        )}

        {tab === 'collections' && (
          <div className="space-y-2">
            {collections.data && collections.data.collections.length > 0 ? (
              collections.data.collections.map((collection) => (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => onShareCollection(collection)}
                  className="card flex w-full items-center gap-3 p-3.5 text-left transition-shadow hover:shadow-lift"
                >
                  {collection.coverThumbnailUrl ? (
                    <img src={collection.coverThumbnailUrl} alt="" className="h-12 w-12 rounded-xl object-cover" />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-sunk text-xl">📁</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-sans text-sm text-ink">{collection.name}</span>
                    <span className="block truncate text-xs text-ink-faint">
                      {collection.photoCount} photos · {collection.diaryCount} entries
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-faint">
                No collections yet.
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            onClose();
            navigate('/collections');
          }}
          className="btn-ghost w-full text-sm"
        >
          Or create a new collection →
        </button>
      </div>
    </Sheet>
  );
}
