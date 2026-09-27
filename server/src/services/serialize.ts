import { db } from '../db/index.js';
import { tagsForEntries, tagsForPhotos } from './tags.js';
import type {
  AttachmentRow,
  CollectionRow,
  DiaryEntryRow,
  MessageRow,
  PhotoRow,
  Principal,
  PublicUser,
  UserRow,
} from '../types.js';

export interface CollectionDto {
  id: string;
  name: string;
  description: string | null;
  coverPhotoId: string | null;
  coverThumbnailUrl: string | null;
  photoCount: number;
  diaryCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string; profileImage: string | null };
}

export interface DiaryEntryDto {
  id: string;
  title: string;
  content: string;
  mood: DiaryEntryRow['mood'];
  visibility: DiaryEntryRow['visibility'];
  entryDate: string;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  author: PublicUser;
  collection: { id: string; name: string } | null;
  tags: string[];
  photos: PhotoDto[];
  photoCount: number;
  /** True when the caller is not the author — used to hide private-only affordances. */
  isOwn: boolean;
}

export interface PhotoDto {
  id: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  caption: string | null;
  description: string | null;
  photoDate: string;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  width: number | null;
  height: number | null;
  collection: { id: string; name: string } | null;
  diaryEntry: { id: string; title: string } | null;
  tags: string[];
  owner: PublicUser;
  isOwn: boolean;
}

export interface AttachmentDto {
  id: string;
  kind: 'IMAGE' | 'VOICE';
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export function serializeAttachment(row: AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    kind: row.kind,
    url: row.url,
    thumbnailUrl: row.thumbnail_url,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds,
  };
}

const userCache = new Map<string, PublicUser>();

export function publicUserOf(userId: string): PublicUser {
  const cached = userCache.get(userId);
  if (cached) return cached;

  const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', userId);
  const settings = db.get<{ show_last_seen: number; show_online_status: number }>(
    'SELECT show_last_seen, show_online_status FROM user_settings WHERE user_id = ?',
    userId,
  );

  const dto: PublicUser = {
    id: userId,
    name: user?.name ?? 'Someone',
    profileImage: user?.profile_image ?? null,
    isOnline: settings?.show_online_status ? Boolean(user?.is_online) : false,
    lastSeenAt: settings?.show_last_seen ? (user?.last_seen_at ?? null) : null,
    showLastSeen: settings?.show_last_seen !== 0,
  };

  userCache.set(userId, dto);
  return dto;
}

export function clearUserCache(): void {
  userCache.clear();
}

export function serializeCollection(row: CollectionRow, counts?: { photoCount: number; diaryCount: number }): CollectionDto {
  const cover = row.cover_photo_id
    ? db.get<PhotoRow>('SELECT * FROM photos WHERE id = ? AND space_id = ?', row.cover_photo_id, row.space_id)
    : undefined;

  // Fall back to the most recent photo so a collection never has a blank cover.
  const fallback = cover
    ? null
    : db.get<PhotoRow>(
        'SELECT * FROM photos WHERE collection_id = ? ORDER BY photo_date DESC LIMIT 1',
        row.id,
      );

  const photoCount =
    counts?.photoCount ??
    db.count(
      'SELECT COUNT(*) AS value FROM photos WHERE collection_id = ? AND space_id = ?',
      row.id,
      row.space_id,
    );
  const diaryCount =
    counts?.diaryCount ??
    db.count('SELECT COUNT(*) AS value FROM diary_entries WHERE collection_id = ? AND space_id = ?', row.id, row.space_id);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    coverPhotoId: row.cover_photo_id,
    coverThumbnailUrl: cover?.thumbnail_url ?? cover?.image_url ?? fallback?.thumbnail_url ?? null,
    photoCount,
    diaryCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: {
      id: row.created_by,
      name: publicUserOf(row.created_by).name,
      profileImage: publicUserOf(row.created_by).profileImage,
    },
  };
}

export function serializePhoto(row: PhotoRow, tags?: string[]): PhotoDto {
  return {
    id: row.id,
    imageUrl: row.image_url,
    thumbnailUrl: row.thumbnail_url,
    caption: row.caption,
    description: row.description,
    photoDate: row.photo_date,
    isFavorite: Boolean(row.is_favorite),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    width: row.width,
    height: row.height,
    collection: row.collection_id
      ? (() => {
          const c = db.get<CollectionRow>('SELECT * FROM collections WHERE id = ?', row.collection_id);
          return c ? { id: c.id, name: c.name } : null;
        })()
      : null,
    diaryEntry: row.diary_entry_id
      ? (() => {
          const d = db.get<DiaryEntryRow>('SELECT * FROM diary_entries WHERE id = ?', row.diary_entry_id);
          return d ? { id: d.id, title: d.title } : null;
        })()
      : null,
    tags: tags ?? [],
    owner: publicUserOf(row.owner_id),
    isOwn: false,
  };
}

export function serializePhotos(rows: PhotoRow[], principal: Principal): PhotoDto[] {
  const tagMap = tagsForPhotos(rows.map((r) => r.id));
  return rows.map((row) => ({
    ...serializePhoto(row, tagMap.get(row.id) ?? []),
    isOwn: row.owner_id === principal.userId,
  }));
}

export function serializeDiaryEntry(row: DiaryEntryRow, principal: Principal, options?: { withPhotos?: boolean }): DiaryEntryDto {
  const tagMap = tagsForEntries([row.id]);
  const photoRows = options?.withPhotos
    ? db.all<PhotoRow>(
        'SELECT * FROM photos WHERE diary_entry_id = ? ORDER BY photo_date ASC, created_at ASC',
        row.id,
      )
    : [];

  const collection = row.collection_id
    ? db.get<CollectionRow>('SELECT * FROM collections WHERE id = ?', row.collection_id)
    : undefined;

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    mood: row.mood,
    visibility: row.visibility,
    entryDate: row.entry_date,
    isFavorite: Boolean(row.is_favorite),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: publicUserOf(row.author_id),
    collection: collection ? { id: collection.id, name: collection.name } : null,
    tags: tagMap.get(row.id) ?? [],
    photos: photoRows.map((p) => ({ ...serializePhoto(p), isOwn: p.owner_id === principal.userId })),
    photoCount: db.count('SELECT COUNT(*) AS value FROM photos WHERE diary_entry_id = ?', row.id),
    isOwn: row.author_id === principal.userId,
  };
}

export function serializeDiaryEntries(rows: DiaryEntryRow[], principal: Principal): DiaryEntryDto[] {
  const tagMap = tagsForEntries(rows.map((r) => r.id));
  return rows.map((row) => ({
    ...serializeDiaryEntry(row, principal, { withPhotos: false }),
    tags: tagMap.get(row.id) ?? [],
  }));
}

export interface MessageDto {
  id: string;
  type: MessageRow['message_type'];
  content: string | null;
  sender: PublicUser;
  replyTo: {
    id: string;
    senderName: string;
    type: MessageRow['message_type'];
    preview: string;
  } | null;
  attachment: AttachmentDto | null;
  sharedPhoto: (PhotoDto & { collectionName: string | null; diaryTitle: string | null }) | null;
  sharedDiary: {
    id: string;
    title: string;
    preview: string;
    entryDate: string;
    mood: DiaryEntryRow['mood'];
    authorName: string;
    photoCount: number;
  } | null;
  sharedCollection: {
    id: string;
    name: string;
    description: string | null;
    coverThumbnailUrl: string | null;
    photoCount: number;
    diaryCount: number;
  } | null;
  reactions: Array<{ emoji: string; userIds: string[]; count: number }>;
  isEdited: boolean;
  isDeleted: boolean;
  isFavorite: boolean;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
}

export function plainTextPreview(html: string, max = 140): string {
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export { plainTextPreview as toPreview };
