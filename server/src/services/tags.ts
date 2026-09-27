import { db } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireMembership } from './space.js';
import type { TagRow } from '../types.js';

export function normaliseTagName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function parseTagInput(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const unique = new Set<string>();
  for (const tag of tags) {
    const normalised = normaliseTagName(tag);
    if (normalised) unique.add(normalised);
  }
  return [...unique].slice(0, 12);
}

/** Finds or creates a tag inside the space. Tag names are unique per space. */
function upsertTag(spaceId: string, name: string): string {
  const existing = db.get<TagRow>('SELECT * FROM tags WHERE space_id = ? AND name = ?', spaceId, name);
  if (existing) return existing.id;
  const id = newId();
  db.run('INSERT INTO tags (id, space_id, name) VALUES (?, ?, ?)', id, spaceId, name);
  return id;
}

/**
 * Replaces the tag set for one memory. `spaceId` is verified against the
 * caller's membership before any tag rows are touched.
 */
export function setTagsForEntry(
  spaceId: string,
  userId: string,
  entryId: string,
  tags: string[],
): string[] {
  requireMembership(userId, spaceId);
  db.run('DELETE FROM memory_tags WHERE diary_entry_id = ?', entryId);
  for (const name of tags) {
    const tagId = upsertTag(spaceId, name);
    db.run(
      'INSERT INTO memory_tags (id, tag_id, diary_entry_id) VALUES (?, ?, ?)',
      newId(),
      tagId,
      entryId,
    );
  }
  return tags;
}

export function setTagsForPhoto(spaceId: string, userId: string, photoId: string, tags: string[]): string[] {
  requireMembership(userId, spaceId);
  db.run('DELETE FROM memory_tags WHERE photo_id = ?', photoId);
  for (const name of tags) {
    const tagId = upsertTag(spaceId, name);
    db.run('INSERT INTO memory_tags (id, tag_id, photo_id) VALUES (?, ?, ?)', newId(), tagId, photoId);
  }
  return tags;
}

export function addTagToPhoto(spaceId: string, userId: string, photoId: string, name: string): void {
  requireMembership(userId, spaceId);
  const tagId = upsertTag(spaceId, name);
  db.run(
    'INSERT OR IGNORE INTO memory_tags (id, tag_id, photo_id) VALUES (?, ?, ?)',
    newId(),
    tagId,
    photoId,
  );
}

export function removeTagFromPhoto(spaceId: string, userId: string, photoId: string, name: string): void {
  requireMembership(userId, spaceId);
  const tag = db.get<TagRow>('SELECT * FROM tags WHERE space_id = ? AND name = ?', spaceId, name);
  if (!tag) return;
  db.run('DELETE FROM memory_tags WHERE photo_id = ? AND tag_id = ?', photoId, tag.id);
}

export function tagsForEntry(entryId: string): string[] {
  return db
    .all<{ name: string }>(
      `SELECT t.name FROM memory_tags mt
       JOIN tags t ON t.id = mt.tag_id
       WHERE mt.diary_entry_id = ?
       ORDER BY t.name`,
      entryId,
    )
    .map((r) => r.name);
}

export function tagsForPhoto(photoId: string): string[] {
  return db
    .all<{ name: string }>(
      `SELECT t.name FROM memory_tags mt
       JOIN tags t ON t.id = mt.tag_id
       WHERE mt.photo_id = ?
       ORDER BY t.name`,
      photoId,
    )
    .map((r) => r.name);
}

/** Batched loader so lists do not run N+1 queries. */
export function tagsForEntries(entryIds: string[]): Map<string, string[]> {
  return groupTags('diary_entry_id', entryIds);
}

export function tagsForPhotos(photoIds: string[]): Map<string, string[]> {
  return groupTags('photo_id', photoIds);
}

function groupTags(column: 'diary_entry_id' | 'photo_id', ids: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.all<{ ref: string; name: string }>(
    `SELECT mt.${column} AS ref, t.name AS name
     FROM memory_tags mt
     JOIN tags t ON t.id = mt.tag_id
     WHERE mt.${column} IN (${placeholders})
     ORDER BY t.name`,
    ...ids,
  );
  for (const row of rows) {
    const list = out.get(row.ref);
    if (list) list.push(row.name);
    else out.set(row.ref, [row.name]);
  }
  return out;
}

export function listSpaceTags(spaceId: string): Array<{ name: string; photoCount: number; entryCount: number }> {
  return db.all<{ name: string; photoCount: number; entryCount: number }>(
    `SELECT t.name,
            (SELECT COUNT(*) FROM memory_tags mt JOIN photos p ON p.id = mt.photo_id
              WHERE mt.tag_id = t.id AND p.space_id = t.space_id) AS photoCount,
            (SELECT COUNT(*) FROM memory_tags mt JOIN diary_entries d ON d.id = mt.diary_entry_id
              WHERE mt.tag_id = t.id AND d.space_id = t.space_id) AS entryCount
     FROM tags t
     WHERE t.space_id = ?
     ORDER BY photoCount DESC, entryCount DESC, t.name ASC`,
    spaceId,
  );
}
