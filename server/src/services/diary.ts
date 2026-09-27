import { db } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, notFound } from '../lib/errors.js';
import { nowIso, toDayKey } from '../lib/time.js';
import { hub, RealtimeEvents } from '../realtime/hub.js';
import { notify } from './notifications.js';
import { assertCanEditDiary, canViewDiary, requireMembership } from './space.js';
import { parseTagInput, setTagsForEntry } from './tags.js';
import { serializeDiaryEntries, serializeDiaryEntry } from './serialize.js';
import type { DiaryEntryDto } from './serialize.js';
import type { DiaryEntryRow, Mood, Principal, Visibility } from '../types.js';

export interface ListDiaryOptions {
  limit: number;
  offset: number;
  collectionId?: string;
  mood?: Mood;
  tag?: string;
  favoritesOnly?: boolean;
  search?: string;
  authorId?: string;
}

/**
 * Single source of truth for diary visibility.
 *
 * The WHERE clause below is the actual privacy enforcement: a PRIVATE entry
 * written by the partner can never be selected, no matter what the client
 * sends. Route handlers never post-filter, so there is no path that returns one.
 */
export function listDiaryEntries(principal: Principal, options: ListDiaryOptions): { items: DiaryEntryDto[]; total: number } {
  requireMembership(principal.userId, principal.spaceId);

  const where: string[] = [
    'space_id = ?',
    "(visibility = 'SHARED' OR author_id = ?)",
  ];
  const params: Array<string | number> = [principal.spaceId, principal.userId];

  if (options.collectionId) {
    where.push('collection_id = ?');
    params.push(options.collectionId);
  }
  if (options.mood) {
    where.push('mood = ?');
    params.push(options.mood);
  }
  if (options.favoritesOnly) {
    where.push('is_favorite = 1');
  }
  if (options.authorId) {
    where.push('author_id = ?');
    params.push(options.authorId);
  }
  if (options.search) {
    where.push('(title LIKE ? OR content LIKE ?)');
    params.push(`%${options.search}%`, `%${options.search}%`);
  }
  if (options.tag) {
    where.push('id IN (SELECT mt.diary_entry_id FROM memory_tags mt JOIN tags t ON t.id = mt.tag_id WHERE t.name = ?)');
    params.push(options.tag);
  }

  const clause = where.join(' AND ');
  const total = db.count(`SELECT COUNT(*) AS value FROM diary_entries WHERE ${clause}`, ...params);
  const rows = db.all<DiaryEntryRow>(
    `SELECT * FROM diary_entries WHERE ${clause}
     ORDER BY entry_date DESC, created_at DESC
     LIMIT ? OFFSET ?`,
    ...params,
    options.limit,
    options.offset,
  );

  return { items: serializeDiaryEntries(rows, principal), total };
}

export function getDiaryEntryOrThrow(principal: Principal, id: string): DiaryEntryRow {
  const entry = db.get<DiaryEntryRow>('SELECT * FROM diary_entries WHERE id = ?', id);
  if (!entry || !canViewDiary(principal, entry)) {
    throw notFound('That diary entry is not available.');
  }
  return entry;
}

export interface CreateDiaryInput {
  title: string;
  content?: string;
  mood?: Mood | null;
  visibility: Visibility;
  entryDate?: string;
  collectionId?: string | null;
  tags?: string[];
  photoIds?: string[];
}

export function createDiaryEntry(principal: Principal, input: CreateDiaryInput): DiaryEntryDto {
  requireMembership(principal.userId, principal.spaceId);

  const title = input.title.trim();
  if (!title) throw badRequest('Give your entry a title.');

  if (input.collectionId) assertCollectionInSpace(principal, input.collectionId);

  const id = newId();
  const entryDate = input.entryDate ? normaliseDate(input.entryDate) : toDayKey(new Date());

  db.run(
    `INSERT INTO diary_entries (id, author_id, space_id, collection_id, title, content, mood, visibility, entry_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    principal.userId,
    principal.spaceId,
    input.collectionId ?? null,
    title,
    input.content ?? '',
    input.mood ?? null,
    input.visibility,
    entryDate,
  );

  setTagsForEntry(principal.spaceId, principal.userId, id, parseTagInput(input.tags));

  // Linking existing photos to a new entry never transfers ownership.
  if (input.photoIds && input.photoIds.length > 0) {
    const placeholders = input.photoIds.map(() => '?').join(',');
    db.run(
      `UPDATE photos SET diary_entry_id = ?, updated_at = ?
       WHERE id IN (${placeholders}) AND space_id = ? AND diary_entry_id IS NULL`,
      id,
      nowIso(),
      ...input.photoIds,
      principal.spaceId,
    );
  }

  const entry = db.get<DiaryEntryRow>('SELECT * FROM diary_entries WHERE id = ?', id)!;

  if (entry.visibility === 'SHARED') {
    const partnerId = partnerIdOf(principal);
    if (partnerId) {
      notify({ principal, type: 'DIARY_SHARED', targetUserId: partnerId, diaryEntryId: id });
    }
    hub.emitToSpace(principal.spaceId, RealtimeEvents.MEMORY_CREATED, {
      kind: 'diary',
      id,
      byUserId: principal.userId,
    });
  }

  return serializeDiaryEntry(entry, principal, { withPhotos: true });
}

export interface UpdateDiaryInput {
  title?: string;
  content?: string;
  mood?: Mood | null;
  visibility?: Visibility;
  entryDate?: string;
  collectionId?: string | null;
  tags?: string[];
}

export function updateDiaryEntry(principal: Principal, id: string, input: UpdateDiaryInput): DiaryEntryDto {
  const existing = getDiaryEntryOrThrow(principal, id);
  assertCanEditDiary(principal, existing);

  if (input.collectionId) assertCollectionInSpace(principal, input.collectionId);
  if (input.title !== undefined && !input.title.trim()) throw badRequest('Give your entry a title.');

  db.run(
    `UPDATE diary_entries
     SET title = COALESCE(?, title),
         content = COALESCE(?, content),
         mood = ?,
         visibility = COALESCE(?, visibility),
         entry_date = COALESCE(?, entry_date),
         collection_id = ?,
         updated_at = ?
     WHERE id = ?`,
    input.title?.trim() ?? null,
    input.content ?? null,
    input.mood === undefined ? existing.mood : input.mood,
    input.visibility ?? null,
    input.entryDate ? normaliseDate(input.entryDate) : null,
    input.collectionId === undefined ? existing.collection_id : input.collectionId,
    nowIso(),
    id,
  );

  if (input.tags !== undefined) {
    setTagsForEntry(principal.spaceId, principal.userId, id, parseTagInput(input.tags));
  }

  const updated = db.get<DiaryEntryRow>('SELECT * FROM diary_entries WHERE id = ?', id)!;
  hub.emitToSpace(principal.spaceId, RealtimeEvents.MEMORY_UPDATED, {
    kind: 'diary',
    id,
    byUserId: principal.userId,
  });

  return serializeDiaryEntry(updated, principal, { withPhotos: true });
}

export function toggleDiaryFavorite(principal: Principal, id: string, favorite: boolean): DiaryEntryDto {
  const existing = getDiaryEntryOrThrow(principal, id);
  db.run('UPDATE diary_entries SET is_favorite = ?, updated_at = ? WHERE id = ?', favorite ? 1 : 0, nowIso(), id);
  const updated = db.get<DiaryEntryRow>('SELECT * FROM diary_entries WHERE id = ?', id)!;
  if (existing.space_id !== principal.spaceId) throw notFound('That entry is not available.');
  return serializeDiaryEntry(updated, principal, { withPhotos: true });
}

export function deleteDiaryEntry(principal: Principal, id: string): void {
  const existing = getDiaryEntryOrThrow(principal, id);
  assertCanEditDiary(principal, existing);

  // Photos inside the entry are kept; only the link is removed (ON DELETE SET NULL
  // handles it) so a shared memory is never destroyed as a side effect.
  db.run('DELETE FROM diary_entries WHERE id = ?', id);

  hub.emitToSpace(principal.spaceId, RealtimeEvents.MEMORY_DELETED, {
    kind: 'diary',
    id,
    byUserId: principal.userId,
  });
}

export function assertCollectionInSpace(principal: Principal, collectionId: string): void {
  const collection = db.get<{ id: string; space_id: string }>(
    'SELECT id, space_id FROM collections WHERE id = ?',
    collectionId,
  );
  if (!collection || collection.space_id !== principal.spaceId) {
    throw badRequest('That collection is not available.');
  }
}

export function partnerIdOf(principal: Principal): string | null {
  return (
    db.get<{ user_id: string }>(
      'SELECT user_id FROM space_members WHERE space_id = ? AND user_id != ? LIMIT 1',
      principal.spaceId,
      principal.userId,
    )?.user_id ?? null
  );
}

export function normaliseDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw badRequest('That date does not look right.');
  return value.length === 10 ? value : toDayKey(parsed);
}
