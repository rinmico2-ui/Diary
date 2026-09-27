import { useState } from 'react';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { Sheet } from './Sheet';
import { Spinner } from './ui';
import type { Collection, Photo } from '../lib/types';
import { toasts } from '../lib/toast';

/** Rename, re-describe, or pick a cover photo for a collection. */
export function CollectionEditor({
  collection,
  onClose,
  onSaved,
}: {
  collection: Collection;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description ?? '');
  const [coverPhotoId, setCoverPhotoId] = useState<string | null>(collection.coverPhotoId);
  const [busy, setBusy] = useState(false);

  const photos = useApi<{ items: Photo[] }>(`/photos?limit=40&collectionId=${collection.id}`);

  const save = async () => {
    if (!name.trim()) {
      toasts.warn('Give your collection a name.');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/collections/${collection.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        coverPhotoId,
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
    <Sheet open onClose={onClose} title="Edit collection" size="tall">
      <div className="space-y-4">
        <div>
          <label htmlFor="collection-name" className="mb-1.5 block text-xs font-medium text-ink-soft">
            Name
          </label>
          <input
            id="collection-name"
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
          />
        </div>

        <div>
          <label htmlFor="collection-description" className="mb-1.5 block text-xs font-medium text-ink-soft">
            Description
          </label>
          <textarea
            id="collection-description"
            className="field min-h-20 resize-y"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="All the places we've been together."
            maxLength={400}
          />
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-ink-soft">Cover photo</p>
          {photos.data && photos.data.items.length > 0 ? (
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setCoverPhotoId(null)}
                className={`flex aspect-square items-center justify-center rounded-xl border-2 text-xl transition-colors ${
                  coverPhotoId === null ? 'border-rose-400 bg-rose-50' : 'border-line bg-surface-sunk'
                }`}
                aria-label="No cover"
              >
                ∅
              </button>
              {photos.data.items.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => setCoverPhotoId(photo.id)}
                  className={`aspect-square overflow-hidden rounded-xl border-2 transition-all ${
                    coverPhotoId === photo.id ? 'border-rose-400' : 'border-transparent'
                  }`}
                >
                  <img src={photo.thumbnailUrl ?? photo.imageUrl} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-line px-4 py-5 text-center text-sm text-ink-faint">
              Add photos to this collection and you can pick a cover.
            </p>
          )}
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
