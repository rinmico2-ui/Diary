import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sheet } from './Sheet';
import { Spinner } from './ui';
import { api, upload } from '../lib/api';
import { toasts } from '../lib/toast';
import type { AddMode } from '../lib/addMemory';
import type { Collection, DiaryEntry, Photo } from '../lib/types';
import { todayKey } from '../lib/format';

interface Staged {
  id: string;
  file: File;
  previewUrl: string;
  status: 'staged' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
}

const MAX_FILES = 20;

export interface PickedPhoto {
  photo: Photo;
  previewUrl: string;
}

/**
 * Shared photo picker with drag and drop, camera capture, per-file progress and
 * pre-upload preview. Used by the add sheet, the diary editor and collections.
 */
export function PhotoUploader({
  photos,
  onChange,
  compact = false,
}: {
  photos: Staged[];
  onChange: (next: Staged[]) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const add = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return;
      const incoming = [...files].filter((file) => file.type.startsWith('image/'));
      if (incoming.length === 0) return;

      const room = MAX_FILES - photos.length;
      if (room <= 0) {
        toasts.warn(`You can add up to ${MAX_FILES} photos at once.`);
        return;
      }

      const staged: Staged[] = incoming.slice(0, room).map((file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: 'staged',
        progress: 0,
      }));

      onChange([...photos, ...staged]);
      if (incoming.length > room) toasts.warn(`Only the first ${room} were added.`);
    },
    [photos, onChange],
  );

  // Revoke object URLs so we do not leak memory across many selections.
  useEffect(
    () => () => {
      for (const item of photos) URL.revokeObjectURL(item.previewUrl);
    },
    [photos],
  );

  const remove = (id: string) => {
    const target = photos.find((p) => p.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    onChange(photos.filter((p) => p.id !== id));
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          add(event.dataTransfer.files);
        }}
        className={`rounded-card border-2 border-dashed p-4 text-center transition-colors ${
          dragging ? 'border-rose-300 bg-rose-50' : 'border-line bg-surface/50'
        }`}
      >
        <p className="text-sm text-ink-soft">
          {dragging ? 'Drop them here' : 'Drag photos here, or pick them below'}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button type="button" className="btn-secondary" onClick={() => inputRef.current?.click()}>
            📸 Choose photos
          </button>
          <button type="button" className="btn-secondary" onClick={() => cameraRef.current?.click()}>
            📷 Camera
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            add(event.target.files);
            event.target.value = '';
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => {
            add(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          <AnimatePresence initial={false}>
            {photos.map((item) => (
              <motion.li
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.2 }}
                className="group relative aspect-square overflow-hidden rounded-xl bg-surface-sunk"
              >
                <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />

                {item.status === 'uploading' && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-ink/20">
                    <div
                      className="h-full bg-rose-500 transition-all duration-200"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}

                {item.status === 'done' && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-sage-400/90 p-0.5 text-[10px] text-white">
                    ✓
                  </span>
                )}

                {item.status === 'error' && (
                  <span
                    className="absolute inset-x-1 bottom-1 truncate rounded-md bg-ink/80 px-1.5 py-0.5 text-[10px] text-white"
                    title={item.error}
                  >
                    {item.error ?? 'Failed'}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  aria-label="Remove photo"
                  disabled={item.status === 'uploading'}
                  className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink/70 text-xs text-white opacity-0 transition-opacity hover:bg-ink group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40"
                >
                  ×
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {compact && photos.length > 0 && (
        <p className="text-xs text-ink-faint">
          {photos.length} photo{photos.length === 1 ? '' : 's'} ready
        </p>
      )}
    </div>
  );
}

interface AddMemorySheetProps {
  open: boolean;
  initialMode: AddMode;
  onClose: () => void;
}

type Tab = 'diary' | 'photos' | 'collection';

/**
 * The single "add a memory" surface: write a diary entry, save photos, or make
 * a collection. Anything staged here can be filed into a collection in one go.
 */
export function AddMemorySheet({ open, initialMode, onClose }: AddMemorySheetProps) {
  const [tab, setTab] = useState<Tab>(initialMode === 'collection' ? 'collection' : initialMode);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  // diary
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'SHARED'>('SHARED');
  const [entryDate, setEntryDate] = useState(todayKey());
  const [tagText, setTagText] = useState('');

  // collection
  const [newCollection, setNewCollection] = useState('');

  useEffect(() => {
    if (!open) return;
    setTab(initialMode === 'collection' ? 'collection' : initialMode);
    api
      .get<{ collections: Collection[] }>('/collections')
      .then((data) => setCollections(data.collections))
      .catch(() => setCollections([]));
  }, [open, initialMode]);

  const reset = () => {
    setStaged([]);
    setTitle('');
    setBody('');
    setTagText('');
    setNewCollection('');
    setCollectionId(null);
    setVisibility('SHARED');
    setEntryDate(todayKey());
    setProgress(0);
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  /** Uploads staged files, then attaches the resulting photo rows. */
  const uploadStaged = async (): Promise<Photo[]> => {
    if (staged.length === 0) return [];

    setStaged((current) => current.map((item) => ({ ...item, status: 'uploading', progress: 0 })));

    const form = new FormData();
    for (const item of staged) form.append('photos', item.file, item.file.name);

    const { promise } = upload<{ uploads: Array<{ attachment: { id: string; url: string; thumbnailUrl: string | null; width: number | null; height: number | null; sizeBytes: number; mimeType: string } }>; failed: Array<{ name: string; reason: string }> }>(
      '/uploads/photos',
      form,
      (percent) => setProgress(percent),
    );

    const result = await promise;

    setStaged((current) => current.map((item) => ({ ...item, status: 'done', progress: 100 })));

    for (const failure of result.failed ?? []) {
      toasts.warn(`${failure.name}: ${failure.reason}`);
    }

    const created = await api.post<{ photos: Photo[] }>('/photos/bulk', {
      photos: (result.uploads ?? []).map((item) => ({
        url: item.attachment.url,
        thumbnailUrl: item.attachment.thumbnailUrl,
        width: item.attachment.width ?? 1,
        height: item.attachment.height ?? 1,
        sizeBytes: item.attachment.sizeBytes,
        mimeType: item.attachment.mimeType,
      })),
      collectionId: collectionId || null,
      photoDate: entryDate,
      tags: parseTags(tagText),
    });

    return created.photos;
  };

  const saveDiary = async () => {
    if (!title.trim()) {
      toasts.warn('Your entry needs a title.');
      return;
    }
    setBusy(true);
    try {
      const photos = await uploadStaged();
      await api.post<{ entry: DiaryEntry }>('/diary', {
        title: title.trim(),
        content: `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>`,
        visibility,
        entryDate,
        collectionId: collectionId || null,
        tags: parseTags(tagText),
        photoIds: photos.map((photo) => photo.id),
      });
      toasts.success(visibility === 'PRIVATE' ? 'Saved to your private pages.' : 'Your diary entry is saved. ✨');
      close();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'That did not save.');
      setStaged((current) => current.map((item) => ({ ...item, status: 'staged', progress: 0 })));
    } finally {
      setBusy(false);
    }
  };

  const savePhotos = async () => {
    if (staged.length === 0) {
      toasts.warn('Choose at least one photo first.');
      return;
    }
    setBusy(true);
    try {
      await uploadStaged();
      toasts.success(staged.length === 1 ? 'Photo saved. 📸' : `${staged.length} photos saved. 📸`);
      close();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'That upload did not work.');
      setStaged((current) => current.map((item) => ({ ...item, status: 'staged', progress: 0 })));
    } finally {
      setBusy(false);
    }
  };

  const saveCollection = async () => {
    if (!newCollection.trim()) {
      toasts.warn('Give your collection a name.');
      return;
    }
    setBusy(true);
    try {
      const created = await api.post<{ collection: Collection }>('/collections', { name: newCollection.trim() });
      if (staged.length > 0) {
        setCollectionId(created.collection.id);
        await uploadStaged();
      }
      toasts.success(`📁 ${created.collection.name} is ready for memories.`);
      close();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  };

  const TABS: Array<{ key: Tab; label: string; emoji: string }> = [
    { key: 'diary', label: 'Diary', emoji: '📝' },
    { key: 'photos', label: 'Photos', emoji: '📸' },
    { key: 'collection', label: 'Collection', emoji: '📁' },
  ];

  return (
    <Sheet open={open} onClose={close} title="Add a memory">
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-surface-sunk p-1">
          {TABS.map((item) => (
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

        {tab === 'diary' && (
          <div className="space-y-4">
            <div>
              <label htmlFor="diary-title" className="mb-1.5 block text-xs font-medium text-ink-soft">
                Title
              </label>
              <input
                id="diary-title"
                className="field"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Today was special"
                maxLength={140}
              />
            </div>

            <div>
              <label htmlFor="diary-body" className="mb-1.5 block text-xs font-medium text-ink-soft">
                What happened?
              </label>
              <textarea
                id="diary-body"
                className="field min-h-32 resize-y"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write it the way you would tell them…"
                maxLength={20000}
              />
            </div>

            <VisibilityPicker value={visibility} onChange={setVisibility} />

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="diary-date" className="mb-1.5 block text-xs font-medium text-ink-soft">
                  Date
                </label>
                <input
                  id="diary-date"
                  type="date"
                  className="field"
                  value={entryDate}
                  max={todayKey()}
                  onChange={(e) => setEntryDate(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="diary-collection" className="mb-1.5 block text-xs font-medium text-ink-soft">
                  Collection
                </label>
                <select
                  id="diary-collection"
                  className="field"
                  value={collectionId ?? ''}
                  onChange={(e) => setCollectionId(e.target.value || null)}
                >
                  <option value="">No collection</option>
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="diary-tags" className="mb-1.5 block text-xs font-medium text-ink-soft">
                Tags
              </label>
              <input
                id="diary-tags"
                className="field"
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                placeholder="birthday, travel, 2026"
              />
            </div>

            <PhotoUploader photos={staged} onChange={setStaged} compact />

            {busy && progress > 0 && <UploadProgress percent={progress} />}

            <button type="button" onClick={saveDiary} disabled={busy} className="btn-primary w-full">
              {busy ? <Spinner className="h-4 w-4" /> : '✨ Save entry'}
            </button>
          </div>
        )}

        {tab === 'photos' && (
          <div className="space-y-4">
            <PhotoUploader photos={staged} onChange={setStaged} />

            <div>
              <label htmlFor="photo-collection" className="mb-1.5 block text-xs font-medium text-ink-soft">
                Add to
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCollectionId(null)}
                  className={`chip ${collectionId === null ? 'chip-active' : ''}`}
                >
                  Memories
                </button>
                {collections.map((collection) => (
                  <button
                    key={collection.id}
                    type="button"
                    onClick={() => setCollectionId(collection.id)}
                    className={`chip ${collectionId === collection.id ? 'chip-active' : ''}`}
                  >
                    {collection.name}
                  </button>
                ))}
              </div>
            </div>

            {busy && progress > 0 && <UploadProgress percent={progress} />}

            <button type="button" onClick={savePhotos} disabled={busy} className="btn-primary w-full">
              {busy ? <Spinner className="h-4 w-4" /> : `📸 Save ${staged.length || ''} photo${staged.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )}

        {tab === 'collection' && (
          <div className="space-y-4">
            <div>
              <label htmlFor="collection-name" className="mb-1.5 block text-xs font-medium text-ink-soft">
                Collection name
              </label>
              <input
                id="collection-name"
                className="field"
                value={newCollection}
                onChange={(e) => setNewCollection(e.target.value)}
                placeholder="Our Adventures"
                maxLength={60}
              />
            </div>

            <p className="text-sm leading-relaxed text-ink-faint">
              Collections are just homes for memories. You can always rename one later, and deleting one never deletes
              what is inside.
            </p>

            <PhotoUploader photos={staged} onChange={setStaged} compact />

            {busy && progress > 0 && <UploadProgress percent={progress} />}

            <button type="button" onClick={saveCollection} disabled={busy} className="btn-primary w-full">
              {busy ? <Spinner className="h-4 w-4" /> : '📁 Create collection'}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function UploadProgress({ percent }: { percent: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-ink-faint">
        <span>Uploading…</span>
        <span className="tabular-nums">{percent}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunk">
        <motion.div
          className="h-full rounded-full bg-rose-500"
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.2 }}
        />
      </div>
    </div>
  );
}

export function VisibilityPicker({
  value,
  onChange,
}: {
  value: 'PRIVATE' | 'SHARED';
  onChange: (next: 'PRIVATE' | 'SHARED') => void;
}) {
  const options: Array<{ value: 'PRIVATE' | 'SHARED'; emoji: string; title: string; body: string }> = [
    { value: 'PRIVATE', emoji: '🔒', title: 'Only me', body: 'Nobody else will ever see this.' },
    { value: 'SHARED', emoji: '❤️', title: 'Both of us', body: 'Your other half can read this too.' },
  ];

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-ink-soft">Who can see this?</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-2xl border p-3.5 text-left transition-all ${
              value === option.value
                ? 'border-rose-300 bg-rose-50 shadow-card'
                : 'border-line bg-surface hover:border-rose-200'
            }`}
          >
            <span className="text-lg">{option.emoji}</span>
            <p className="mt-1 text-sm font-medium text-ink">{option.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-faint">{option.body}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export function TagInput({
  value,
  onChange,
  suggestions = [],
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState('');

  const commit = (raw: string) => {
    const tag = raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    if (!tag || value.includes(tag) || value.length >= 12) return;
    onChange([...value, tag]);
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-pill bg-rose-50 px-2.5 py-1 text-xs text-rose-700">
            #{tag}
            <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))} aria-label={`Remove ${tag}`}>
              ×
            </button>
          </span>
        ))}
      </div>

      <input
        className="field"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commit(draft);
          }
        }}
        onBlur={() => commit(draft)}
        placeholder="Add a tag and press Enter"
        maxLength={40}
      />

      {suggestions.filter((s) => !value.includes(s)).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
            {suggestions
              .filter((s) => !value.includes(s))
              .slice(0, 8)
              .map((tag) => (
                <button key={tag} type="button" onClick={() => commit(tag)} className="chip">
                  #{tag}
                </button>
              ))}
        </div>
      )}
    </div>
  );
}

function parseTags(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[,\s]+/)
        .map((tag) => tag.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-'))
        .filter(Boolean),
    ),
  ].slice(0, 12);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
