import { db } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { hub, RealtimeEvents } from '../realtime/hub.js';
import { notify } from './notifications.js';
import { assertCanViewDiary, assertSameSpace, canViewDiary, requireMembership } from './space.js';
import {
  publicUserOf,
  serializeAttachment,
  serializePhoto,
  toPreview,
  type AttachmentDto,
  type MessageDto,
  type PhotoDto,
} from './serialize.js';
import type {
  AttachmentRow,
  CollectionRow,
  DiaryEntryRow,
  MessageRow,
  MessageType,
  PhotoRow,
  Principal,
} from '../types.js';

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export interface ListMessagesOptions {
  limit: number;
  before?: string;
  search?: string;
  favoritesOnly?: boolean;
}

export function listMessages(principal: Principal, options: ListMessagesOptions): MessageDto[] {
  requireMembership(principal.userId, principal.spaceId);

  const where: string[] = ['space_id = ?'];
  const params: Array<string | number> = [principal.spaceId];

  if (options.before) {
    where.push('created_at < ?');
    params.push(options.before);
  }
  if (options.search) {
    where.push('content LIKE ?');
    params.push(`%${options.search}%`);
  }
  if (options.favoritesOnly) {
    where.push('is_favorite = 1');
  }

  // Newest first for the LIMIT, then flip to chronological for rendering.
  const rows = db.all<MessageRow>(
    `SELECT * FROM messages WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
    ...params,
    options.limit,
  );

  return hydrate(rows.reverse(), principal);
}

export function getMessage(principal: Principal, messageId: string): MessageRow {
  const message = db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', messageId);
  if (!message) throw notFound('That message is gone.');
  assertSameSpace(principal, message.space_id);
  return message;
}

export function hydrate(rows: MessageRow[], principal: Principal): MessageDto[] {
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');

  const attachmentRows = db.all<AttachmentRow>(
    `SELECT * FROM attachments
     WHERE id IN (SELECT attachment_id FROM messages WHERE id IN (${placeholders}) AND attachment_id IS NOT NULL)`,
    ...ids,
  );
  const attachmentById = new Map(attachmentRows.map((a) => [a.id, a]));

  const readRows = db.all<{ message_id: string; user_id: string }>(
    `SELECT message_id, user_id FROM message_reads WHERE user_id = ? AND message_id IN (${placeholders})`,
    principal.userId,
    ...ids,
  );
  const readSet = new Set(readRows.map((r) => r.message_id));

  const reactionRows = db.all<{ message_id: string; emoji: string; user_id: string }>(
    `SELECT message_id, emoji, user_id FROM message_reactions WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`,
    ...ids,
  );
  const reactionMap = new Map<string, Array<{ emoji: string; userId: string }>>();
  for (const row of reactionRows) {
    const list = reactionMap.get(row.message_id);
    if (list) list.push({ emoji: row.emoji, userId: row.user_id });
    else reactionMap.set(row.message_id, [{ emoji: row.emoji, userId: row.user_id }]);
  }

  const replyIds = rows.map((r) => r.reply_to_message_id).filter((id): id is string => Boolean(id));
  const replyRows = replyIds.length
    ? db.all<MessageRow>(
        `SELECT * FROM messages WHERE id IN (${replyIds.map(() => '?').join(',')})`,
        ...replyIds,
      )
    : [];
  const replyById = new Map(replyRows.map((r) => [r.id, r]));

  return rows.map((row) => {
    const attachment = row.attachment_id ? attachmentById.get(row.attachment_id) : undefined;

    const reply = row.reply_to_message_id ? replyById.get(row.reply_to_message_id) : undefined;
    const replyPreview = reply
      ? reply.is_deleted
        ? 'Message deleted'
        : reply.message_type === 'IMAGE'
          ? '📸 Photo'
          : reply.message_type === 'VOICE'
            ? '🎙 Voice message'
            : reply.message_type === 'MEMORY'
              ? '📸 Shared a memory'
              : reply.message_type === 'DIARY'
                ? '📝 Shared a diary entry'
                : toPreview(reply.content ?? '', 80)
      : null;

    const reactions = new Map<string, string[]>();
    for (const reaction of reactionMap.get(row.id) ?? []) {
      const users = reactions.get(reaction.emoji);
      if (users) users.push(reaction.userId);
      else reactions.set(reaction.emoji, [reaction.userId]);
    }

    return {
      id: row.id,
      type: row.message_type,
      content: row.is_deleted ? null : row.content,
      sender: publicUserOf(row.sender_id),
      replyTo: reply
        ? {
            id: reply.id,
            senderName: publicUserOf(reply.sender_id).name,
            type: reply.message_type,
            preview: replyPreview ?? '',
          }
        : null,
      attachment: attachment && !row.is_deleted ? serializeAttachment(attachment) : null,
      sharedPhoto: buildSharedPhoto(row, principal),
      sharedDiary: buildSharedDiary(row, principal),
      sharedCollection: buildSharedCollection(row, principal),
      reactions: [...reactions.entries()].map(([emoji, userIds]) => ({ emoji, userIds, count: userIds.length })),
      isEdited: Boolean(row.is_edited),
      isDeleted: Boolean(row.is_deleted),
      isFavorite: Boolean(row.is_favorite),
      isRead: readSet.has(row.id) || row.sender_id === principal.userId,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

/**
 * Shared-memory previews are re-resolved on read, and are gated by the same
 * visibility rules as the memory library. A diary entry that became private
 * after being shared stops rendering in the chat too.
 */
function buildSharedPhoto(
  row: MessageRow,
  principal: Principal,
): (PhotoDto & { collectionName: string | null; diaryTitle: string | null }) | null {
  if (!row.shared_photo_id) return null;
  const photo = db.get<PhotoRow>('SELECT * FROM photos WHERE id = ?', row.shared_photo_id);
  if (!photo || photo.space_id !== principal.spaceId) return null;
  const collection = photo.collection_id
    ? db.get<CollectionRow>('SELECT * FROM collections WHERE id = ?', photo.collection_id)
    : undefined;
  const diary = photo.diary_entry_id
    ? db.get<DiaryEntryRow>('SELECT * FROM diary_entries WHERE id = ?', photo.diary_entry_id)
    : undefined;
  return {
    ...serializePhoto(photo),
    collectionName: collection?.name ?? null,
    diaryTitle: diary?.title ?? null,
    isOwn: photo.owner_id === principal.userId,
  };
}

function buildSharedDiary(
  row: MessageRow,
  principal: Principal,
): MessageDto['sharedDiary'] {
  if (!row.shared_diary_entry_id) return null;
  const entry = db.get<DiaryEntryRow>('SELECT * FROM diary_entries WHERE id = ?', row.shared_diary_entry_id);
  if (!entry) return null;
  // A now-private entry must never leak through the chat payload — drop the
  // preview silently rather than failing the whole message list.
  if (!canViewDiary(principal, entry)) return null;
  return {
    id: entry.id,
    title: entry.title,
    preview: toPreview(entry.content, 120),
    entryDate: entry.entry_date,
    mood: entry.mood,
    authorName: publicUserOf(entry.author_id).name,
    photoCount: db.count('SELECT COUNT(*) AS value FROM photos WHERE diary_entry_id = ?', entry.id),
  };
}

function buildSharedCollection(
  row: MessageRow,
  principal: Principal,
): MessageDto['sharedCollection'] {
  if (!row.shared_collection_id) return null;
  const collection = db.get<CollectionRow>('SELECT * FROM collections WHERE id = ?', row.shared_collection_id);
  if (!collection || collection.space_id !== principal.spaceId) return null;
  return {
    id: collection.id,
    name: collection.name,
    description: collection.description,
    coverThumbnailUrl:
      (collection.cover_photo_id
        ? db.get<PhotoRow>('SELECT thumbnail_url, image_url FROM photos WHERE id = ?', collection.cover_photo_id)
        : undefined)?.thumbnail_url ??
      db.get<PhotoRow>('SELECT thumbnail_url FROM photos WHERE collection_id = ? LIMIT 1', collection.id)?.thumbnail_url ??
      null,
    photoCount: db.count(
      'SELECT COUNT(*) AS value FROM photos WHERE collection_id = ? AND space_id = ?',
      collection.id,
      collection.space_id,
    ),
    diaryCount: db.count(
      `SELECT COUNT(*) AS value FROM diary_entries
       WHERE collection_id = ? AND space_id = ? AND (visibility = 'SHARED' OR author_id = ?)`,
      collection.id,
      collection.space_id,
      principal.userId,
    ),
  };
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

export interface CreateMessageInput {
  type: MessageType;
  content?: string | null;
  replyToMessageId?: string | null;
  attachmentId?: string | null;
  sharedPhotoId?: string | null;
  sharedDiaryEntryId?: string | null;
  sharedCollectionId?: string | null;
}

export function createMessage(principal: Principal, input: CreateMessageInput): MessageDto {
  requireMembership(principal.userId, principal.spaceId);

  const content = (input.content ?? '').trim();
  if (input.type === 'TEXT' && !content) throw badRequest('Write something first.');

  // Every referenced object is verified to live in the caller's own space.
  if (input.replyToMessageId) {
    const reply = db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', input.replyToMessageId);
    if (!reply) throw badRequest('The message you replied to is gone.');
    assertSameSpace(principal, reply.space_id);
  }

  if (input.attachmentId) {
    const attachment = db.get<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', input.attachmentId);
    if (!attachment) throw badRequest('That attachment is gone.');
    assertSameSpace(principal, attachment.space_id);
    if (input.type === 'IMAGE' && attachment.kind !== 'IMAGE') throw badRequest('That file is not a photo.');
    if (input.type === 'VOICE' && attachment.kind !== 'VOICE') throw badRequest('That file is not a recording.');
  }

  if (input.sharedPhotoId) {
    const photo = db.get<PhotoRow>('SELECT * FROM photos WHERE id = ?', input.sharedPhotoId);
    if (!photo) throw badRequest('That memory is gone.');
    assertSameSpace(principal, photo.space_id);
  }

  if (input.sharedDiaryEntryId) {
    const entry = db.get<DiaryEntryRow>('SELECT * FROM diary_entries WHERE id = ?', input.sharedDiaryEntryId);
    if (!entry) throw badRequest('That diary entry is gone.');
    assertCanViewDiary(principal, entry);
  }

  if (input.sharedCollectionId) {
    const collection = db.get<CollectionRow>('SELECT * FROM collections WHERE id = ?', input.sharedCollectionId);
    if (!collection) throw badRequest('That collection is gone.');
    assertSameSpace(principal, collection.space_id);
  }

  const id = newId();
  db.run(
    `INSERT INTO messages (
       id, space_id, sender_id, message_type, content, reply_to_message_id, attachment_id,
       shared_photo_id, shared_diary_entry_id, shared_collection_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    principal.spaceId,
    principal.userId,
    input.type,
    content || null,
    input.replyToMessageId ?? null,
    input.attachmentId ?? null,
    input.sharedPhotoId ?? null,
    input.sharedDiaryEntryId ?? null,
    input.sharedCollectionId ?? null,
  );

  // The sender has, by definition, read their own message.
  db.run(
    'INSERT INTO message_reads (id, message_id, user_id) VALUES (?, ?, ?)',
    newId(),
    id,
    principal.userId,
  );

  const partnerId = db.get<{ user_id: string }>(
    'SELECT user_id FROM space_members WHERE space_id = ? AND user_id != ? LIMIT 1',
    principal.spaceId,
    principal.userId,
  )?.user_id;

  if (partnerId) {
    notify({
      principal,
      type: 'MESSAGE',
      targetUserId: partnerId,
      messageId: id,
      data: { type: input.type },
    });
  }

  const dto = hydrate([db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', id)!], principal)[0]!;

  if (partnerId) {
    hub.emitToPartner(principal.spaceId, principal.userId, RealtimeEvents.MESSAGE_CREATED, { messageId: id });
  }
  // Echo back so the sender's other tabs stay in sync.
  hub.emitToUser(principal.userId, RealtimeEvents.MESSAGE_CREATED, { messageId: id });

  return dto;
}

export function editMessage(principal: Principal, messageId: string, content: string): void {
  const message = getMessage(principal, messageId);
  if (message.sender_id !== principal.userId) throw forbidden('You can only edit your own messages.');
  if (message.is_deleted) throw badRequest('That message was deleted.');
  if (message.message_type !== 'TEXT') throw badRequest('Only text messages can be edited.');

  const trimmed = content.trim();
  if (!trimmed) throw badRequest('A message cannot be empty.');

  db.run(
    'UPDATE messages SET content = ?, is_edited = 1, updated_at = ? WHERE id = ?',
    trimmed,
    nowIso(),
    messageId,
  );
  hub.emitToSpace(principal.spaceId, RealtimeEvents.MESSAGE_UPDATED, { messageId });
}

/** Soft delete: the row stays so replies keep their anchor, content is hidden. */
export function deleteMessage(principal: Principal, messageId: string): void {
  const message = getMessage(principal, messageId);
  if (message.sender_id !== principal.userId) throw forbidden('You can only delete your own messages.');

  db.run(
    `UPDATE messages SET is_deleted = 1, content = NULL, attachment_id = NULL,
       shared_photo_id = NULL, shared_diary_entry_id = NULL, shared_collection_id = NULL,
       updated_at = ? WHERE id = ?`,
    nowIso(),
    messageId,
  );
  hub.emitToSpace(principal.spaceId, RealtimeEvents.MESSAGE_DELETED, { messageId });
}

export function toggleReaction(principal: Principal, messageId: string, emoji: string): { added: boolean } {
  const message = getMessage(principal, messageId);

  const existing = db.get<{ id: string }>(
    'SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
    messageId,
    principal.userId,
    emoji,
  );

  if (existing) {
    db.run('DELETE FROM message_reactions WHERE id = ?', existing.id);
    hub.emitToSpace(principal.spaceId, RealtimeEvents.REACTION_REMOVED, {
      messageId,
      emoji,
      userId: principal.userId,
    });
    return { added: false };
  }

  db.run(
    'INSERT INTO message_reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)',
    newId(),
    messageId,
    principal.userId,
    emoji,
  );
  hub.emitToSpace(principal.spaceId, RealtimeEvents.REACTION_ADDED, {
    messageId,
    emoji,
    userId: principal.userId,
  });

  const partnerId = db.get<{ user_id: string }>(
    'SELECT user_id FROM space_members WHERE space_id = ? AND user_id != ? LIMIT 1',
    principal.spaceId,
    principal.userId,
  )?.user_id;
  if (partnerId && message.sender_id === partnerId) {
    notify({ principal, type: 'MESSAGE_REACTION', targetUserId: partnerId, messageId });
  }

  return { added: true };
}

/** Marks the partner's messages as read by the caller. */
export function markMessagesRead(principal: Principal, messageIds: string[]): string[] {
  if (messageIds.length === 0) return [];

  const placeholders = messageIds.map(() => '?').join(',');
  const rows = db.all<MessageRow>(
    `SELECT * FROM messages
     WHERE id IN (${placeholders}) AND space_id = ? AND sender_id != ?`,
    ...messageIds,
    principal.spaceId,
    principal.userId,
  );

  const read: string[] = [];
  for (const row of rows) {
    const { changes } = db.run(
      'INSERT OR IGNORE INTO message_reads (id, message_id, user_id) VALUES (?, ?, ?)',
      newId(),
      row.id,
      principal.userId,
    );
    if (changes > 0) read.push(row.id);
  }

  if (read.length > 0) {
    const payload = { messageIds: read, byUserId: principal.userId };
    hub.emitToPartner(principal.spaceId, principal.userId, RealtimeEvents.MESSAGE_READ, payload);
    // Also tell the reader, so their own unread badge clears and any other
    // tab they have open stays in sync.
    hub.emitToUser(principal.userId, RealtimeEvents.MESSAGE_READ, payload);
  }

  return read;
}

export function unreadMessageSummary(principal: Principal): {
  unreadCount: number;
  lastMessage: { content: string | null; senderId: string; createdAt: string } | null;
} {
  const unreadCount = db.count(
    `SELECT COUNT(*) AS value FROM messages
     WHERE space_id = ? AND sender_id != ?
       AND id NOT IN (SELECT message_id FROM message_reads WHERE user_id = ?)`,
    principal.spaceId,
    principal.userId,
    principal.userId,
  );

  const last = db.get<{ content: string | null; sender_id: string; created_at: string }>(
    'SELECT content, sender_id, created_at FROM messages WHERE space_id = ? ORDER BY created_at DESC LIMIT 1',
    principal.spaceId,
  );

  return {
    unreadCount,
    lastMessage: last ? { content: last.content, senderId: last.sender_id, createdAt: last.created_at } : null,
  };
}
