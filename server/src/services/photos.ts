import { db } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { nowIso, toDayKey } from '../lib/time.js';
import { deleteStoredFile } from '../lib/image.js';
import { hub, RealtimeEvents } from '../realtime/hub.js';
import { notify } from './notifications.js';
import { assertCollectionInSpace, partnerIdOf } from './diary.js';
import { requireMembership } from './space.js';
import { addTagToPhoto, parseTagInput, removeTagFromPhoto, setTagsForPhoto } from './tags.js';
import { serializePhotos } from './serialize.js';
import type { PhotoDto } from './serialize.js';
import type { PhotoRow, Principal } from '../types.js';

export interface ListPhotosOptions {
  limit: number;
  offset: number;
  collectionId?: string;
  diaryEntryId?: string;
  tag?: string;
  favoritesOnly?: boolean;
  search?: string;
  ownerId?: string;
}

export function listPhotos(principal: Principal, options: ListPhotosOptions): { items: PhotoDto[]; total: number } {
  requireMembership(principal.userId, principal.spaceId);

  const where: string[] = ['space_id = ?'];
  const params: Array<string | number> = [principal.spaceId];

  if (options.collectionId) {
    where.push('collection_id = ?');
    params.push(options.collectionId);
  }
  if (options.diaryEntryId) {
    where.push('diary_entry_id = ?');
    params.push(options.diaryEntryId);
  }
  if (options.favoritesOnly) {
    where.push('is_favorite = 1');
  }
  if (options.ownerId) {
    where.push('owner_id = ?');
    params.push(options.ownerId);
  }
  if (options.search) {
    where.push('(caption LIKE ? OR description LIKE ?)');
    params.push(`%${options.search}%`, `%${options.search}%`);
  }
  if (options.tag) {
    where.push('id IN (SELECT mt.photo_id FROM memory_tags mt JOIN tags t ON t.id = mt.tag_id WHERE t.name = ?)');
    params.push(options.tag);
  }

  const clause = where.join(' AND ');
  const total = db.count(`SELECT COUNT(*) AS value FROM photos WHERE ${clause}`, ...params);
  const rows = db.all<PhotoRow>(
    `SELECT * FROM photos WHERE ${clause}
     ORDER BY photo_date DESC, created_at DESC
     LIMIT ? OFFSET ?`,
    ...params,
    options.limit,
    options.offset,
  );

  return { items: serializePhotos(rows, principal), total };
}

export function getPhotoOrThrow(principal: Principal, id: string): PhotoRow {
  const photo = db.get<PhotoRow>('SELECT * FROM photos WHERE id = ?', id);
  if (!photo || photo.space_id !== principal.spaceId) {
    throw notFound('That photo is not available.');
  }
  return photo;
}

export interface CreatePhotoInput {
  url: string;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  sizeBytes: number;
  caption?: string | null;
  description?: string | null;
  photoDate?: string;
  collectionId?: string | null;
  diaryEntryId?: string | null;
  tags?: string[];
}

export function createPhoto(principal: Principal, input: CreatePhotoInput): PhotoDto {
  requireMembership(principal.userId, principal.spaceId);

  if (input.collectionId) assertCollectionInSpace(principal, input.collectionId);
  if (input.diaryEntryId) {
    const entry = db.get<{ id: string; space_id: string }>(
      'SELECT id, space_id FROM diary_entries WHERE id = ?',
      input.diaryEntryId,
    );
    if (!entry || entry.space_id !== principal.spaceId) throw badRequest('That diary entry is not available.');
  }

  const id = newId();
  db.run(
    `INSERT INTO photos (
       id, owner_id, space_id, collection_id, diary_entry_id,
       image_url, thumbnail_url, caption, description, photo_date, width, height, size_bytes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    principal.userId,
    principal.spaceId,
    input.collectionId ?? null,
    input.diaryEntryId ?? null,
    input.url,
    input.thumbnailUrl,
    input.caption ?? null,
    input.description ?? null,
    input.photoDate ? normalisePhotoDate(input.photoDate) : toDayKey(new Date()),
    input.width,
    input.height,
    input.sizeBytes,
  );

  if (input.tags?.length) {
    setTagsForPhoto(principal.spaceId, principal.userId, id, parseTagInput(input.tags));
  }

  const row = db.get<PhotoRow>('SELECT * FROM photos WHERE id = ?', id)!;

  hub.emitToSpace(principal.spaceId, RealtimeEvents.MEMORY_CREATED, {
    kind: 'photo',
    id,
    byUserId: principal.userId,
  });

  return serializePhotos([row], principal)[0]!;
}

export interface UpdatePhotoInput {
  caption?: string | null;
  description?: string | null;
  photoDate?: string;
  collectionId?: string | null;
  diaryEntryId?: string | null;
  tags?: string[];
}

export function updatePhoto(principal: Principal, id: string, input: UpdatePhotoInput): PhotoDto {
  const photo = getPhotoOrThrow(principal, id);

  // Either person in the space may annotate or reorganise a shared memory.
  if (input.collectionId) assertCollectionInSpace(principal, input.collectionId);

  db.run(
    `UPDATE photos SET
       caption = ?, description = ?, photo_date = ?, collection_id = ?, diary_entry_id = ?, updated_at = ?
     WHERE id = ?`,
    input.caption === undefined ? photo.caption : input.caption,
    input.description === undefined ? photo.description : input.description,
    input.photoDate ? normalisePhotoDate(input.photoDate) : photo.photo_date,
    input.collectionId === undefined ? photo.collection_id : input.collectionId,
    input.diaryEntryId === undefined ? photo.diary_entry_id : input.diaryEntryId,
    nowIso(),
    id,
  );

  if (input.tags !== undefined) {
    setTagsForPhoto(principal.spaceId, principal.userId, id, parseTagInput(input.tags));
  }

  const updated = db.get<PhotoRow>('SELECT * FROM photos WHERE id = ?', id)!;
  hub.emitToSpace(principal.spaceId, RealtimeEvents.MEMORY_UPDATED, {
    kind: 'photo',
    id,
    byUserId: principal.userId,
  });

  return serializePhotos([updated], principal)[0]!;
}

export function togglePhotoFavorite(principal: Principal, id: string, favorite: boolean): PhotoDto {
  getPhotoOrThrow(principal, id);
  db.run('UPDATE photos SET is_favorite = ?, updated_at = ? WHERE id = ?', favorite ? 1 : 0, nowIso(), id);
  const updated = db.get<PhotoRow>('SELECT * FROM photos WHERE id = ?', id)!;
  return serializePhotos([updated], principal)[0]!;
}

export function addPhotoTag(principal: Principal, id: string, rawTag: string): PhotoDto {
  const photo = getPhotoOrThrow(principal, id);
  const [tag] = parseTagInput([rawTag]);
  if (!tag) throw badRequest('That tag does not look right.');
  addTagToPhoto(principal.spaceId, principal.userId, photo.id, tag);
  return serializePhotos([photo], principal)[0]!;
}

export function removePhotoTag(principal: Principal, id: string, tagName: string): PhotoDto {
  const photo = getPhotoOrThrow(principal, id);
  removeTagFromPhoto(principal.spaceId, principal.userId, photo.id, tagName);
  const fresh = db.get<PhotoRow>('SELECT * FROM photos WHERE id = ?', id)!;
  return serializePhotos([fresh], principal)[0]!;
}

/** Deleting a photo removes the binary files too — including the partner's. */
export function deletePhoto(principal: Principal, id: string): void {
  const photo = getPhotoOrThrow(principal, id);
  if (photo.owner_id !== principal.userId) {
    throw forbidden('Only the person who added this photo can remove it.');
  }

  db.run('DELETE FROM photos WHERE id = ?', id);
  deleteStoredFile(photo.image_url);
  deleteStoredFile(photo.thumbnail_url);

  if (photo.collection_id) {
    // Keep the collection cover pointing at something that still exists.
    const collection = db.get<{ cover_photo_id: string | null }>(
      'SELECT cover_photo_id FROM collections WHERE id = ?',
      photo.collection_id,
    );
    if (collection?.cover_photo_id === id) {
      db.run('UPDATE collections SET cover_photo_id = NULL, updated_at = ? WHERE id = ?', nowIso(), photo.collection_id);
    }
  }

  hub.emitToSpace(principal.spaceId, RealtimeEvents.MEMORY_DELETED, {
    kind: 'photo',
    id,
    byUserId: principal.userId,
  });
}

export function movePhotosToCollection(principal: Principal, photoIds: string[], collectionId: string | null): number {
  requireMembership(principal.userId, principal.spaceId);
  if (collectionId) assertCollectionInSpace(principal, collectionId);

  let moved = 0;
  db.transaction(() => {
    for (const photoId of photoIds) {
      const { changes } = db.run(
        'UPDATE photos SET collection_id = ?, updated_at = ? WHERE id = ? AND space_id = ?',
        collectionId,
        nowIso(),
        photoId,
        principal.spaceId,
      );
      moved += changes;
    }
  });
  return moved;
}

/** Notifies the partner that this photo was shared into the conversation. */
export function sharePhotoToPartner(principal: Principal, id: string): PhotoDto {
  const photo = getPhotoOrThrow(principal, id);
  const partnerId = partnerIdOf(principal);
  if (partnerId) {
    notify({ principal, type: 'MEMORY_SHARED', targetUserId: partnerId, photoId: id });
  }
  return serializePhotos([photo], principal)[0]!;
}

function normalisePhotoDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw badRequest('That date does not look right.');
  return value.length === 10 ? value : toDayKey(parsed);
}
