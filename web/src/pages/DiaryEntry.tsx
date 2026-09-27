import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { useAddMemory } from '../lib/addMemory';
import { PhotoGrid, PhotoViewer } from '../components/PhotoGrid';
import { ConfirmDialog, Sheet } from '../components/Sheet';
import { Avatar, Spinner } from '../components/ui';
import { FavoriteButton, TagRow, VisibilityPill } from '../components/Memory';
import { TagInput, VisibilityPicker } from '../components/AddMemorySheet';
import { moodMeta, MOODS, type Collection, type DiaryEntry, type Mood, type Session, type TagSummary } from '../lib/types';
import { longDate, plainText, relativeTime, todayKey } from '../lib/format';
import { toasts } from '../lib/toast';

export function DiaryEntryPage({ session }: { session: Session }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { open } = useAddMemory();
  const { data, loading, reload } = useApi<{ entry: DiaryEntry }>(`/diary/${id}`);

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const collections = useApi<{ collections: Collection[] }>('/collections');

  const entry = data?.entry;

  const toggleFavorite = async () => {
    if (!entry) return;
    const next = !entry.isFavorite;
    await api.patch(`/diary/${entry.id}/favorite`, { favorite: next }).catch(() => undefined);
    reload();
  };

  const remove = async () => {
    if (!entry) return;
    try {
      await api.delete(`/diary/${entry.id}`);
      toasts.success('Entry removed.');
      navigate('/diary');
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'That could not be removed.');
    }
  };

  const addPhotos = async () => {
    open('photos');
  };

  if (loading) {
    return (
      <div className="page flex justify-center py-20">
        <Spinner className="h-6 w-6 text-rose-400" />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="page">
        <div className="card p-10 text-center">
          <p className="text-3xl">🔒</p>
          <h1 className="mt-3 font-sans text-lg">This entry is not available</h1>
          <p className="mt-2 text-sm text-ink-faint">
            It may be private, or it may have been deleted.
          </p>
          <Link to="/diary" className="btn-secondary mt-5">
            Back to diary
          </Link>
        </div>
      </div>
    );
  }

  const mood = moodMeta(entry.mood);
  const body = plainText(entry.content);
  const viewerPhoto = viewer ? entry.photos.find((p) => p.id === viewer) ?? null : null;

  return (
    <div className="page max-w-3xl">
      <button type="button" onClick={() => navigate('/diary')} className="btn-ghost -ml-2 mb-4">
        ← Diary
      </button>

      <motion.article
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="card overflow-hidden"
      >
        <div className="border-b border-line px-6 py-6 sm:px-8 sm:py-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-faint">{longDate(entry.entryDate)}</p>
              <h1 className="mt-1.5 font-sans text-[1.75rem] leading-tight text-ink sm:text-[2rem]">{entry.title}</h1>
            </div>
            <FavoriteButton isFavorite={entry.isFavorite} onToggle={toggleFavorite} size="lg" />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 text-xs text-ink-faint">
              <Avatar name={entry.author.name} src={entry.author.profileImage} id={entry.author.id} size="sm" />
              {entry.isOwn ? 'You' : entry.author.name} · {relativeTime(entry.updatedAt)}
            </span>
            <VisibilityPill visibility={entry.visibility} />
            {mood && (
              <span className="chip">
                {mood.emoji} {mood.label}
              </span>
            )}
            {entry.collection && (
              <Link to={`/collections/${entry.collection.id}`} className="chip hover:border-rose-300">
                📁 {entry.collection.name}
              </Link>
            )}
          </div>
        </div>

        {entry.photos.length > 0 && (
          <div className="border-b border-line bg-surface-sunk/40 p-4 sm:p-6">
            <PhotoGrid photos={entry.photos} onOpen={(photo) => setViewer(photo.id)} columns={3} />
          </div>
        )}

        <div className="px-6 py-7 sm:px-8">
          {body ? (
            <div className="space-y-4 text-[1.0625rem] leading-[1.75] text-ink-soft">
              {body.split('\n').filter((paragraph) => paragraph.trim()).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          ) : (
            <p className="italic text-ink-faint">No words yet — just the feeling of the day.</p>
          )}

          {entry.tags.length > 0 && (
            <div className="mt-7">
              <TagRow tags={entry.tags} />
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-2 border-t border-line pt-6">
            {entry.isOwn && (
              <>
                <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
                  ✏️ Edit
                </button>
                <button type="button" className="btn-secondary" onClick={addPhotos}>
                  📸 Add photos
                </button>
              </>
            )}
            <button type="button" className="btn-primary" onClick={() => setShareOpen(true)}>
              💬 Share in chat
            </button>
            {entry.isOwn && (
              <button type="button" className="btn-ghost text-ink-faint" onClick={() => setConfirmDelete(true)}>
                🗑️ Delete
              </button>
            )}
          </div>
        </div>
      </motion.article>

      {editing && (
        <EditSheet
          entry={entry}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}

      <Sheet open={shareOpen} onClose={() => setShareOpen(false)} title="Share this entry">
        <p className="text-sm leading-relaxed text-ink-soft">
          Send this entry into your conversation. It will appear as a card you can both open any time.
        </p>
        <button
          type="button"
          className="btn-primary mt-4 w-full"
          onClick={async () => {
            try {
              await api.post('/messages', { type: 'DIARY', sharedDiaryEntryId: entry.id });
              toasts.success('Shared in your chat 📝');
              setShareOpen(false);
            } catch (error) {
              toasts.error(error instanceof Error ? error.message : 'Could not share that.');
            }
          }}
        >
          💬 Share “{entry.title.slice(0, 28)}{entry.title.length > 28 ? '…' : ''}”
        </button>
        <p className="mt-3 text-xs text-ink-faint">
          Signed in as {session.user.name}. Only the two of you can open this.
        </p>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this entry?"
        body="The entry and its words will be gone. The photos inside stay in your library."
        confirmLabel="Delete it"
        tone="danger"
        onConfirm={() => {
          setConfirmDelete(false);
          void remove();
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      {viewerPhoto && (
        <PhotoViewer
          photos={entry.photos}
          index={entry.photos.findIndex((p) => p.id === viewerPhoto.id)}
          collections={collections.data?.collections ?? []}
          onIndexChange={(index) => setViewer(entry.photos[index]?.id ?? null)}
          onClose={() => setViewer(null)}
          onToggleFavorite={async (photo) => {
            await api.patch(`/photos/${photo.id}/favorite`, { favorite: !photo.isFavorite }).catch(() => undefined);
            reload();
          }}
          onEdit={() => setViewer(null)}
          onShare={() => {
            setViewer(null);
            setShareOpen(true);
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

function EditSheet({
  entry,
  onClose,
  onSaved,
}: {
  entry: DiaryEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(plainText(entry.content));
  const [mood, setMood] = useState<Mood | null>(entry.mood);
  const [visibility, setVisibility] = useState<'PRIVATE' | 'SHARED'>(entry.visibility);
  const [entryDate, setEntryDate] = useState(entry.entryDate);
  const [collectionId, setCollectionId] = useState(entry.collection?.id ?? '');
  const [tags, setTags] = useState<string[]>(entry.tags);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<'none' | 'bold' | 'italic' | 'heading' | 'quote' | 'list'>('none');

  const collections = useApi<{ collections: Collection[] }>('/collections');
  const tagSuggestions = useApi<{ tags: TagSummary[] }>('/diary/tags');

  // Wrapping the selection gives real formatting without a heavy editor.
  const wrap = (before: string, after = before) => {
    const textarea = document.getElementById('entry-body') as HTMLTextAreaElement | null;
    if (!textarea) return;
    const { selectionStart, selectionEnd, value } = textarea;
    const selected = value.slice(selectionStart, selectionEnd) || 'your words';
    const next = `${value.slice(0, selectionStart)}${before}${selected}${after}${value.slice(selectionEnd)}`;
    setBody(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart + before.length, selectionStart + before.length + selected.length);
    });
  };

  const prefixLines = (prefix: string) => {
    const textarea = document.getElementById('entry-body') as HTMLTextAreaElement | null;
    if (!textarea) return;
    const { selectionStart, selectionEnd, value } = textarea;
    const next = `${value.slice(0, selectionStart)}${prefix}${value.slice(selectionEnd)}`;
    setBody(next);
    requestAnimationFrame(() => textarea.focus());
  };

  const save = async () => {
    if (!title.trim()) {
      toasts.warn('Your entry needs a title.');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/diary/${entry.id}`, {
        title: title.trim(),
        content: renderBody(body, format),
        mood,
        visibility,
        entryDate,
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

  const FORMATS = [
    { key: 'bold' as const, label: 'B', title: 'Bold', className: 'font-bold' },
    { key: 'italic' as const, label: 'I', title: 'Italic', className: 'italic font-serif' },
    { key: 'heading' as const, label: 'H', title: 'Heading', className: 'font-semibold' },
    { key: 'quote' as const, label: '❝', title: 'Quote', className: '' },
    { key: 'list' as const, label: '•', title: 'List', className: '' },
  ];

  return (
    <Sheet open onClose={onClose} title="Edit entry" size="tall">
      <div className="space-y-4">
        <input
          className="field"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
          maxLength={140}
        />

        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center gap-0.5 border-b border-line bg-surface-sunk/60 px-2 py-1.5">
            {FORMATS.map((item) => (
              <button
                key={item.key}
                type="button"
                title={item.title}
                onClick={() => {
                  setFormat(item.key);
                  if (item.key === 'bold') wrap('**');
                  else if (item.key === 'italic') wrap('_');
                  else if (item.key === 'heading') prefixLines('## ');
                  else if (item.key === 'quote') prefixLines('> ');
                  else if (item.key === 'list') prefixLines('- ');
                }}
                className={`h-8 w-8 rounded-lg text-sm text-ink-soft transition-colors hover:bg-surface hover:text-ink ${item.className}`}
              >
                {item.label}
              </button>
            ))}
            <span className="ml-auto pr-1 text-[11px] text-ink-faint">{body.length} characters</span>
          </div>
          <textarea
            id="entry-body"
            className="min-h-56 w-full resize-y px-4 py-3 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write it the way you would tell them…"
          />
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-ink-soft">Mood</p>
          <div className="flex flex-wrap gap-1.5">
            {MOODS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setMood(mood === item.value ? null : item.value)}
                className={`rounded-pill border px-3 py-1.5 text-xs transition-colors ${
                  mood === item.value ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-line bg-surface text-ink-faint'
                }`}
              >
                {item.emoji} {item.label}
              </button>
            ))}
          </div>
        </div>

        <VisibilityPicker value={visibility} onChange={setVisibility} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-date" className="mb-1.5 block text-xs font-medium text-ink-soft">
              Date
            </label>
            <input
              id="edit-date"
              type="date"
              className="field"
              value={entryDate}
              max={todayKey()}
              onChange={(event) => setEntryDate(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="edit-collection" className="mb-1.5 block text-xs font-medium text-ink-soft">
              Collection
            </label>
            <select
              id="edit-collection"
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
          <TagInput
            value={tags}
            onChange={setTags}
            suggestions={(tagSuggestions.data?.tags ?? []).map((t) => t.name)}
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={busy} className="btn-primary flex-1">
            {busy ? <Spinner className="h-4 w-4" /> : 'Save changes'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * The editor works in plain text with lightweight markers, and converts to the
 * small, safe HTML subset the API accepts (no scripts, no event handlers).
 */
function renderBody(text: string, _format: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const lines = text.split('\n');
  const html: string[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) return;
    html.push(`<ul>${listBuffer.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
    listBuffer = [];
  };

  const inline = (value: string) =>
    escape(value)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/_(.+?)_/g, '<em>$1</em>');

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('- ')) {
      listBuffer.push(trimmed.slice(2));
      continue;
    }
    flushList();

    if (!trimmed) continue;
    if (trimmed.startsWith('## ')) html.push(`<h3>${inline(trimmed.slice(3))}</h3>`);
    else if (trimmed.startsWith('> ')) html.push(`<blockquote>${inline(trimmed.slice(2))}</blockquote>`);
    else html.push(`<p>${inline(trimmed)}</p>`);
  }
  flushList();

  return html.join('');
}
