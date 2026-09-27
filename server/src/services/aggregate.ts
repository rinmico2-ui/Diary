import { db } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { requireMembership } from './space.js';
import { serializeCollection, serializeDiaryEntries, serializePhotos, publicUserOf } from './serialize.js';
import { listCollections } from './collections.js';
import { unreadMessageSummary } from './messages.js';
import { unreadCount } from './notifications.js';
import type { CollectionDto, DiaryEntryDto, MessageDto, PhotoDto } from './serialize.js';
import { hydrate } from './messages.js';
import type {
  CollectionRow,
  DiaryEntryRow,
  MessageRow,
  PhotoRow,
  Principal,
} from '../types.js';

/* ------------------------------------------------------------------ *
 * Home
 * ------------------------------------------------------------------ */

export interface HomeSummary {
  greeting: string;
  spaceName: string;
  partner: { id: string; name: string; profileImage: string | null; isOnline: boolean; lastSeenAt: string | null } | null;
  today: string;
  counts: { photos: number; diary: number; collections: number; messages: number; favorites: number };
  recentMessages: MessageDto[];
  recentPhotos: PhotoDto[];
  recentDiary: DiaryEntryDto[];
  favoriteMemories: { photos: PhotoDto[]; diaryEntries: DiaryEntryDto[] };
  collections: CollectionDto[];
  unreadMessages: number;
  unreadNotifications: number;
  lastMessage: { content: string | null; senderId: string; createdAt: string } | null;
}

export function getHomeSummary(principal: Principal): HomeSummary {
  requireMembership(principal.userId, principal.spaceId);

  const partnerRow = db.get<{ user_id: string }>(
    'SELECT user_id FROM space_members WHERE space_id = ? AND user_id != ? LIMIT 1',
    principal.spaceId,
    principal.userId,
  );
  const partner = partnerRow ? publicUserOf(partnerRow.user_id) : null;

  const messageRows = db.all<MessageRow>(
    'SELECT * FROM messages WHERE space_id = ? ORDER BY created_at DESC LIMIT 3',
    principal.spaceId,
  );
  const photoRows = db.all<PhotoRow>(
    'SELECT * FROM photos WHERE space_id = ? ORDER BY photo_date DESC, created_at DESC LIMIT 12',
    principal.spaceId,
  );
  const diaryRows = db.all<DiaryEntryRow>(
    `SELECT * FROM diary_entries
     WHERE space_id = ? AND (visibility = 'SHARED' OR author_id = ?)
     ORDER BY entry_date DESC, created_at DESC LIMIT 6`,
    principal.spaceId,
    principal.userId,
  );

  const favPhotoRows = db.all<PhotoRow>(
    'SELECT * FROM photos WHERE space_id = ? AND is_favorite = 1 ORDER BY photo_date DESC LIMIT 8',
    principal.spaceId,
  );
  const favDiaryRows = db.all<DiaryEntryRow>(
    `SELECT * FROM diary_entries
     WHERE space_id = ? AND is_favorite = 1 AND (visibility = 'SHARED' OR author_id = ?)
     ORDER BY entry_date DESC LIMIT 5`,
    principal.spaceId,
    principal.userId,
  );

  const messages = unreadMessageSummary(principal);

  return {
    greeting: greetingFor(principal.name),
    spaceName: principal.spaceName,
    partner: partner
      ? {
          id: partner.id,
          name: partner.name,
          profileImage: partner.profileImage,
          isOnline: partner.isOnline,
          lastSeenAt: partner.lastSeenAt,
        }
      : null,
    today: new Date().toISOString(),
    counts: {
      photos: db.count('SELECT COUNT(*) AS value FROM photos WHERE space_id = ?', principal.spaceId),
      diary: db.count(
        `SELECT COUNT(*) AS value FROM diary_entries
         WHERE space_id = ? AND (visibility = 'SHARED' OR author_id = ?)`,
        principal.spaceId,
        principal.userId,
      ),
      collections: db.count('SELECT COUNT(*) AS value FROM collections WHERE space_id = ?', principal.spaceId),
      messages: db.count('SELECT COUNT(*) AS value FROM messages WHERE space_id = ?', principal.spaceId),
      favorites:
        db.count('SELECT COUNT(*) AS value FROM photos WHERE space_id = ? AND is_favorite = 1', principal.spaceId) +
        db.count(
          `SELECT COUNT(*) AS value FROM diary_entries
           WHERE space_id = ? AND is_favorite = 1 AND (visibility = 'SHARED' OR author_id = ?)`,
          principal.spaceId,
          principal.userId,
        ),
    },
    recentMessages: hydrate(messageRows.reverse(), principal),
    recentPhotos: serializePhotos(photoRows, principal),
    recentDiary: serializeDiaryEntries(diaryRows, principal),
    favoriteMemories: {
      photos: serializePhotos(favPhotoRows, principal),
      diaryEntries: serializeDiaryEntries(favDiaryRows, principal),
    },
    collections: listCollections(principal).slice(0, 6),
    unreadMessages: messages.unreadCount,
    unreadNotifications: unreadCount(principal),
    lastMessage: messages.lastMessage,
  };
}

function greetingFor(name: string): string {
  const first = name.split(' ')[0] ?? name;
  // "You" is a placeholder account name; greeting it by name reads oddly.
  const who = first.length > 0 && first.toLowerCase() !== 'you' ? first : '';
  const hour = new Date().getHours();

  if (hour < 5) return who ? `Still awake, ${who}` : 'Still awake';
  if (hour < 12) return who ? `Good morning, ${who}` : 'Good morning';
  if (hour < 18) return who ? `Good afternoon, ${who}` : 'Good afternoon';
  return who ? `Good evening, ${who}` : 'Good evening';
}

/* ------------------------------------------------------------------ *
 * Timeline
 * ------------------------------------------------------------------ */

export interface TimelineDay {
  date: string;
  photos: PhotoDto[];
  diaryEntries: DiaryEntryDto[];
  messageCount: number;
  messagePreview: string | null;
  favoriteCount: number;
  total: number;
}

export interface TimelineMonth {
  month: string;
  days: TimelineDay[];
  totals: { photos: number; diary: number; messages: number };
}

export function getTimeline(principal: Principal, options: { months: number; limit: number }): TimelineMonth[] {
  requireMembership(principal.userId, principal.spaceId);

  const dayCount = options.months * 31;

  const photoDays = db.all<{ day: string; total: number }>(
    `SELECT substr(photo_date, 1, 10) AS day, COUNT(*) AS total
     FROM photos WHERE space_id = ?
     GROUP BY day ORDER BY day DESC LIMIT ?`,
    principal.spaceId,
    dayCount,
  );

  const diaryDays = db.all<{ day: string; total: number }>(
    `SELECT substr(entry_date, 1, 10) AS day, COUNT(*) AS total
     FROM diary_entries
     WHERE space_id = ? AND (visibility = 'SHARED' OR author_id = ?)
     GROUP BY day ORDER BY day DESC LIMIT ?`,
    principal.spaceId,
    principal.userId,
    dayCount,
  );

  const messageDays = db.all<{ day: string; total: number; preview: string | null }>(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS total,
            (SELECT content FROM messages m2
              WHERE substr(m2.created_at, 1, 10) = substr(messages.created_at, 1, 10)
                AND m2.space_id = messages.space_id AND m2.is_deleted = 0
              ORDER BY m2.created_at ASC LIMIT 1) AS preview
     FROM messages
     WHERE space_id = ? AND is_deleted = 0
     GROUP BY day ORDER BY day DESC LIMIT ?`,
    principal.spaceId,
    dayCount,
  );

  const allDays = new Set<string>();
  for (const row of [...photoDays, ...diaryDays, ...messageDays]) allDays.add(row.day);
  const days = [...allDays].sort((a, b) => b.localeCompare(a)).slice(0, dayCount);

  const monthMap = new Map<string, TimelineMonth>();

  for (const day of days) {
    const photos = db.all<PhotoRow>(
      'SELECT * FROM photos WHERE space_id = ? AND substr(photo_date, 1, 10) = ? ORDER BY photo_date DESC LIMIT ?',
      principal.spaceId,
      day,
      options.limit,
    );
    const diary = db.all<DiaryEntryRow>(
      `SELECT * FROM diary_entries
       WHERE space_id = ? AND (visibility = 'SHARED' OR author_id = ?) AND substr(entry_date, 1, 10) = ?
       ORDER BY entry_date DESC LIMIT ?`,
      principal.spaceId,
      principal.userId,
      day,
      options.limit,
    );

    const messageStat = messageDays.find((m) => m.day === day);
    const photoStat = photoDays.find((p) => p.day === day);
    const diaryStat = diaryDays.find((d) => d.day === day);

    const month = day.slice(0, 7);
    const entry: TimelineDay = {
      date: day,
      photos: serializePhotos(photos, principal),
      diaryEntries: serializeDiaryEntries(diary, principal),
      messageCount: messageStat?.total ?? 0,
      messagePreview: messageStat?.preview ?? null,
      favoriteCount: photos.filter((p) => p.is_favorite).length + diary.filter((d) => d.is_favorite).length,
      total: photos.length + diary.length + (messageStat?.total ?? 0),
    };

    if (!monthMap.has(month)) {
      monthMap.set(month, { month, days: [], totals: { photos: 0, diary: 0, messages: 0 } });
    }
    const bucket = monthMap.get(month)!;
    bucket.days.push(entry);
    bucket.totals.photos += photoStat?.total ?? 0;
    bucket.totals.diary += diaryStat?.total ?? 0;
    bucket.totals.messages += messageStat?.total ?? 0;
  }

  return [...monthMap.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/* ------------------------------------------------------------------ *
 * Favorites
 * ------------------------------------------------------------------ */

export interface FavoritesFeed {
  photos: PhotoDto[];
  diaryEntries: DiaryEntryDto[];
  messages: MessageDto[];
}

export function getFavorites(principal: Principal, limit: number): FavoritesFeed {
  requireMembership(principal.userId, principal.spaceId);

  const photoRows = db.all<PhotoRow>(
    'SELECT * FROM photos WHERE space_id = ? AND is_favorite = 1 ORDER BY photo_date DESC LIMIT ?',
    principal.spaceId,
    limit,
  );
  const diaryRows = db.all<DiaryEntryRow>(
    `SELECT * FROM diary_entries
     WHERE space_id = ? AND is_favorite = 1 AND (visibility = 'SHARED' OR author_id = ?)
     ORDER BY entry_date DESC LIMIT ?`,
    principal.spaceId,
    principal.userId,
    limit,
  );
  const messageRows = db.all<MessageRow>(
    'SELECT * FROM messages WHERE space_id = ? AND is_favorite = 1 AND is_deleted = 0 ORDER BY created_at DESC LIMIT ?',
    principal.spaceId,
    limit,
  );

  return {
    photos: serializePhotos(photoRows, principal),
    diaryEntries: serializeDiaryEntries(diaryRows, principal),
    messages: hydrate(messageRows, principal),
  };
}

export function toggleMessageFavorite(principal: Principal, messageId: string, favorite: boolean): void {
  const { changes } = db.run(
    'UPDATE messages SET is_favorite = ?, updated_at = ? WHERE id = ? AND space_id = ?',
    favorite ? 1 : 0,
    new Date().toISOString(),
    messageId,
    principal.spaceId,
  );
  if (changes === 0) throw notFound('That message is not available.');
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export interface SearchResults {
  query: string;
  diaryEntries: DiaryEntryDto[];
  photos: PhotoDto[];
  collections: CollectionDto[];
  tags: Array<{ name: string; photoCount: number; entryCount: number }>;
  messages: MessageDto[];
  total: number;
}

export function search(principal: Principal, query: string, limit: number): SearchResults {
  requireMembership(principal.userId, principal.spaceId);
  const trimmed = query.trim();
  if (!trimmed) {
    return { query: trimmed, diaryEntries: [], photos: [], collections: [], tags: [], messages: [], total: 0 };
  }

  const like = `%${trimmed}%`;
  const tagLike = `%${trimmed.toLowerCase().replace(/^#/, '')}%`;

  const diaryRows = db.all<DiaryEntryRow>(
    `SELECT * FROM diary_entries
     WHERE space_id = ? AND (visibility = 'SHARED' OR author_id = ?)
       AND (title LIKE ? OR content LIKE ?)
     ORDER BY entry_date DESC LIMIT ?`,
    principal.spaceId,
    principal.userId,
    like,
    like,
    limit,
  );

  const photoRows = db.all<PhotoRow>(
    `SELECT * FROM photos
     WHERE space_id = ? AND (caption LIKE ? OR description LIKE ?)
     ORDER BY photo_date DESC LIMIT ?`,
    principal.spaceId,
    like,
    like,
    limit,
  );

  const tagRows = db.all<{ name: string; photoCount: number; entryCount: number }>(
    `SELECT t.name,
            (SELECT COUNT(*) FROM memory_tags mt JOIN photos p ON p.id = mt.photo_id
              WHERE mt.tag_id = t.id AND p.space_id = t.space_id) AS photoCount,
            (SELECT COUNT(*) FROM memory_tags mt JOIN diary_entries d ON d.id = mt.diary_entry_id
              WHERE mt.tag_id = t.id AND d.space_id = t.space_id) AS entryCount
     FROM tags t
     WHERE t.space_id = ? AND t.name LIKE ?
     ORDER BY photoCount DESC, t.name LIMIT ?`,
    principal.spaceId,
    tagLike,
    limit,
  );

  const collectionRows = db.all<CollectionRow>(
    'SELECT * FROM collections WHERE space_id = ? AND (name LIKE ? OR description LIKE ?) ORDER BY updated_at DESC LIMIT ?',
    principal.spaceId,
    like,
    like,
    limit,
  );

  // Tag matches also surface the memories carrying them.
  const taggedPhotoRows = db.all<PhotoRow>(
    `SELECT DISTINCT p.* FROM photos p
     JOIN memory_tags mt ON mt.photo_id = p.id
     JOIN tags t ON t.id = mt.tag_id
     WHERE p.space_id = ? AND t.name LIKE ?
     ORDER BY p.photo_date DESC LIMIT ?`,
    principal.spaceId,
    tagLike,
    limit,
  );
  const taggedDiaryRows = db.all<DiaryEntryRow>(
    `SELECT DISTINCT d.* FROM diary_entries d
     JOIN memory_tags mt ON mt.diary_entry_id = d.id
     JOIN tags t ON t.id = mt.tag_id
     WHERE d.space_id = ? AND t.name LIKE ? AND (d.visibility = 'SHARED' OR d.author_id = ?)
     ORDER BY d.entry_date DESC LIMIT ?`,
    principal.spaceId,
    tagLike,
    principal.userId,
    limit,
  );

  const messageRows = db.all<MessageRow>(
    `SELECT * FROM messages
     WHERE space_id = ? AND is_deleted = 0 AND content LIKE ?
     ORDER BY created_at DESC LIMIT ?`,
    principal.spaceId,
    like,
    limit,
  );

  const photos = serializePhotos(mergeById(photoRows, taggedPhotoRows), principal);
  const diaryEntries = serializeDiaryEntries(mergeById(diaryRows, taggedDiaryRows), principal);
  const collections = collectionRows.map((row) => serializeCollection(row));

  return {
    query: trimmed,
    diaryEntries,
    photos,
    collections,
    tags: tagRows,
    messages: hydrate(messageRows, principal),
    total: photos.length + diaryEntries.length + collections.length + tagRows.length + messageRows.length,
  };
}

function mergeById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const seen = new Set(a.map((row) => row.id));
  return [...a, ...b.filter((row) => !seen.has(row.id))];
}
