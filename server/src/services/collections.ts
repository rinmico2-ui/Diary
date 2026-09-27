import { db } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { hub, RealtimeEvents } from '../realtime/hub.js';
import { notify } from './notifications.js';
import { partnerIdOf } from './diary.js';
import { requireMembership } from './space.js';
import { serializeCollection, serializeDiaryEntries, serializePhotos } from './serialize.js';
import type { CollectionDto, DiaryEntryDto, PhotoDto } from './serialize.js';
import type { CollectionRow, DiaryEntryRow, PhotoRow, Principal } from '../types.js';

export function listCollections(principal: Principal): CollectionDto[] {
  requireMembership(principal.userId, principal.spaceId);

  const rows = db.all<CollectionRow>(
    'SELECT * FROM collections WHERE space_id = ? ORDER BY updated_at DESC',
    principal.spaceId,
  );

  // Counts respect diary visibility: a collection never reveals the existence of
  // a partner's private entry through its statistics.
  const counts = new Map<string, { photoCount: number; diaryCount: number }>();
  for (const row of rows) {
    counts.set(row.id, {
      photoCount: db.count(
        'SELECT COUNT(*) AS value FROM photos WHERE collection_id = ? AND space_id = ?',
        row.id,
        row.space_id,
      ),
      diaryCount: db.count(
        `SELECT COUNT(*) AS value FROM diary_entries
         WHERE collection_id = ? AND space_id = ? AND (visibility = 'SHARED' OR author_id = ?)`,
        row.id,
        row.space_id,
        principal.userId,
      ),
    });
  }

  return rows.map((row) => serializeCollection(row, counts.get(row.id)));
}

export function getCollectionOrThrow(principal: Principal, id: string): CollectionRow {
  const collection = db.get<CollectionRow>('SELECT * FROM collections WHERE id = ?', id);
  if (!collection || collection.space_id !== principal.spaceId) {
    throw notFound('That collection is not available.');
  }
  return collection;
}

export function createCollection(
  principal: Principal,
  input: { name: string; description?: string | null; coverPhotoId?: string | null },
): CollectionDto {
  requireMembership(principal.userId, principal.spaceId);

  const name = input.name.trim();
  if (!name) throw badRequest('Give your collection a name.');
  if (name.length > 60) throw badRequest('That collection name is a little long.');

  if (input.coverPhotoId) assertPhotoInSpace(principal, input.coverPhotoId);

  const id = newId();
  db.run(
    'INSERT INTO collections (id, space_id, created_by, name, description, cover_photo_id) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    principal.spaceId,
    principal.userId,
    name,
    input.description?.trim() || null,
    input.coverPhotoId ?? null,
  );

  hub.emitToSpace(principal.spaceId, RealtimeEvents.COLLECTION_UPDATED, {
    collectionId: id,
    byUserId: principal.userId,
  });

  return serializeCollection(db.get<CollectionRow>('SELECT * FROM collections WHERE id = ?', id)!);
}

export function updateCollection(
  principal: Principal,
  id: string,
  input: { name?: string; description?: string | null; coverPhotoId?: string | null },
): CollectionDto {
  const collection = getCollectionOrThrow(principal, id);
  if (input.coverPhotoId) assertPhotoInSpace(principal, input.coverPhotoId);

  db.run(
    'UPDATE collections SET name = ?, description = ?, cover_photo_id = ?, updated_at = ? WHERE id = ?',
    input.name?.trim() || collection.name,
    input.description === undefined ? collection.description : input.description?.trim() || null,
    input.coverPhotoId === undefined ? collection.cover_photo_id : input.coverPhotoId,
    nowIso(),
    id,
  );

  hub.emitToSpace(principal.spaceId, RealtimeEvents.COLLECTION_UPDATED, {
    collectionId: id,
    byUserId: principal.userId,
  });

  const partnerId = partnerIdOf(principal);
  if (partnerId && collection.created_by === principal.userId) {
    notify({ principal, type: 'COLLECTION_UPDATED', targetUserId: partnerId, collectionId: id });
  }

  return serializeCollection(db.get<CollectionRow>('SELECT * FROM collections WHERE id = ?', id)!);
}

/**
 * Deleting a collection removes only the folder.
 *
 * Photos and diary entries inside it are deliberately preserved — the foreign
 * keys are `ON DELETE SET NULL`, so they simply become "unfiled" and stay in the
 * library. Losing a folder must never lose a memory.
 */
export function deleteCollection(principal: Principal, id: string): { detachedPhotos: number; detachedDiary: number } {
  const collection = getCollectionOrThrow(principal, id);

  const detachedPhotos = db.count(
    'SELECT COUNT(*) AS value FROM photos WHERE collection_id = ?',
    id,
  );
  const detachedDiary = db.count(
    'SELECT COUNT(*) AS value FROM diary_entries WHERE collection_id = ?',
    id,
  );

  db.transaction(() => {
    db.run('UPDATE photos SET collection_id = NULL, updated_at = ? WHERE collection_id = ?', nowIso(), id);
    db.run('UPDATE diary_entries SET collection_id = NULL, updated_at = ? WHERE collection_id = ?', nowIso(), id);
    db.run('DELETE FROM collections WHERE id = ?', id);
  });

  hub.emitToSpace(principal.spaceId, RealtimeEvents.COLLECTION_UPDATED, {
    collectionId: collection.id,
    byUserId: principal.userId,
  });

  return { detachedPhotos, detachedDiary };
}

export interface CollectionDetail {
  collection: CollectionDto;
  photos: PhotoDto[];
  diaryEntries: DiaryEntryDto[];
  stats: { photoCount: number; diaryCount: number; favoriteCount: number; firstMemoryAt: string | null; lastMemoryAt: string | null };
}

export function getCollectionDetail(principal: Principal, id: string): CollectionDetail {
  const row = getCollectionOrThrow(principal, id);

  const photoRows = db.all<PhotoRow>(
    'SELECT * FROM photos WHERE collection_id = ? AND space_id = ? ORDER BY photo_date DESC, created_at DESC',
    id,
    row.space_id,
  );

  const diaryRows = db.all<DiaryEntryRow>(
    `SELECT * FROM diary_entries
     WHERE collection_id = ? AND space_id = ? AND (visibility = 'SHARED' OR author_id = ?)
     ORDER BY entry_date DESC, created_at DESC`,
    id,
    row.space_id,
    principal.userId,
  );

  const dates = db.all<{ min: string | null; max: string | null }>(
    `SELECT MIN(d) AS min, MAX(d) AS max FROM (
       SELECT photo_date AS d FROM photos WHERE collection_id = ?
       UNION ALL
       SELECT entry_date AS d FROM diary_entries WHERE collection_id = ? AND space_id = ? AND (visibility = 'SHARED' OR author_id = ?)
     )`,
    id,
    id,
    row.space_id,
    principal.userId,
  );

  const favoriteCount =
    db.count('SELECT COUNT(*) AS value FROM photos WHERE collection_id = ? AND is_favorite = 1', id) +
    db.count(
      `SELECT COUNT(*) AS value FROM diary_entries
       WHERE collection_id = ? AND is_favorite = 1 AND (visibility = 'SHARED' OR author_id = ?)`,
      id,
      principal.userId,
    );

  return {
    collection: serializeCollection(row, { photoCount: photoRows.length, diaryCount: diaryRows.length }),
    photos: serializePhotos(photoRows, principal),
    diaryEntries: serializeDiaryEntries(diaryRows, principal),
    stats: {
      photoCount: photoRows.length,
      diaryCount: diaryRows.length,
      favoriteCount,
      firstMemoryAt: dates[0]?.min ?? null,
      lastMemoryAt: dates[0]?.max ?? null,
    },
  };
}

/** Removes a single memory from a collection without deleting the memory. */
export function removeMemoryFromCollection(
  principal: Principal,
  collectionId: string,
  kind: 'photo' | 'diary',
  memoryId: string,
): void {
  getCollectionOrThrow(principal, collectionId);

  if (kind === 'photo') {
    const { changes } = db.run(
      'UPDATE photos SET collection_id = NULL, updated_at = ? WHERE id = ? AND collection_id = ? AND space_id = ?',
      nowIso(),
      memoryId,
      collectionId,
      principal.spaceId,
    );
    if (changes === 0) throw notFound('That photo is not in this collection.');
  } else {
    const { changes } = db.run(
      `UPDATE diary_entries SET collection_id = NULL, updated_at = ?
       WHERE id = ? AND collection_id = ? AND space_id = ? AND (visibility = 'SHARED' OR author_id = ?)`,
      nowIso(),
      memoryId,
      collectionId,
      principal.spaceId,
      principal.userId,
    );
    if (changes === 0) throw notFound('That entry is not in this collection.');
  }

  db.run('UPDATE collections SET updated_at = ? WHERE id = ?', nowIso(), collectionId);
  hub.emitToSpace(principal.spaceId, RealtimeEvents.COLLECTION_UPDATED, {
    collectionId,
    byUserId: principal.userId,
  });
}

export function assertPhotoInSpace(principal: Principal, photoId: string): void {
  const photo = db.get<{ id: string; space_id: string }>('SELECT id, space_id FROM photos WHERE id = ?', photoId);
  if (!photo || photo.space_id !== principal.spaceId) {
    throw forbidden('That photo is not available.');
  }
}
