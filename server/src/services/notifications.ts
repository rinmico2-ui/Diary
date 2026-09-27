import { db } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { publicUserOf, plainTextPreview } from './serialize.js';
import { hub, RealtimeEvents } from '../realtime/hub.js';
import type { NotificationRow, NotificationType, Principal } from '../types.js';

export interface NotificationDto {
  id: string;
  type: NotificationType;
  createdAt: string;
  isRead: boolean;
  actor: { id: string; name: string; profileImage: string | null } | null;
  title: string;
  preview: string | null;
  target: {
    kind: 'message' | 'diary' | 'photo' | 'collection' | null;
    id: string | null;
  };
}

interface CreateNotificationInput {
  principal: Principal;
  type: NotificationType;
  targetUserId: string;
  messageId?: string | null;
  diaryEntryId?: string | null;
  photoId?: string | null;
  collectionId?: string | null;
  data?: Record<string, unknown> | null;
}

/**
 * Creates a notification for the *other* person only. Notifications never go to
 * the actor, and the target must be a member of the same space.
 */
export function notify(input: CreateNotificationInput): void {
  const { principal, type } = input;
  if (input.targetUserId === principal.userId) return;

  const isMember = db.get<{ id: string }>(
    'SELECT id FROM space_members WHERE space_id = ? AND user_id = ?',
    principal.spaceId,
    input.targetUserId,
  );
  if (!isMember) return;

  const settings = db.get<{ notifications_enabled: number }>(
    'SELECT notifications_enabled FROM user_settings WHERE user_id = ?',
    input.targetUserId,
  );
  if (settings && settings.notifications_enabled === 0) return;

  const id = newId();
  db.run(
    `INSERT INTO notifications (id, space_id, user_id, actor_id, type, message_id, diary_entry_id, photo_id, collection_id, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    principal.spaceId,
    input.targetUserId,
    principal.userId,
    type,
    input.messageId ?? null,
    input.diaryEntryId ?? null,
    input.photoId ?? null,
    input.collectionId ?? null,
    input.data ? JSON.stringify(input.data) : null,
  );

  hub.emitToUser(input.targetUserId, RealtimeEvents.NOTIFICATION_CREATED, { notificationId: id });
}

export function listNotifications(principal: Principal, limit = 40): NotificationDto[] {
  const rows = db.all<NotificationRow>(
    `SELECT * FROM notifications
     WHERE user_id = ? AND space_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    principal.userId,
    principal.spaceId,
    limit,
  );
  return rows.map(toDto);
}

function toDto(row: NotificationRow): NotificationDto {
  const actor = row.actor_id ? publicUserOf(row.actor_id) : null;
  let title = 'Something new';
  let preview: string | null = null;
  let target: NotificationDto['target'] = { kind: null, id: null };

  if (row.message_id) {
    const message = db.get<{ content: string | null; message_type: string; is_deleted: number }>(
      'SELECT content, message_type, is_deleted FROM messages WHERE id = ?',
      row.message_id,
    );
    title = 'New message';
    preview = message && !message.is_deleted ? plainTextPreview(message.content ?? '') : null;
    target = { kind: 'message', id: row.message_id };
  } else if (row.diary_entry_id) {
    const entry = db.get<{ title: string; content: string }>(
      'SELECT title, content FROM diary_entries WHERE id = ?',
      row.diary_entry_id,
    );
    title = entry ? `Shared a diary entry: ${entry.title}` : 'Shared a diary entry';
    preview = entry ? plainTextPreview(entry.content, 90) : null;
    target = { kind: 'diary', id: row.diary_entry_id };
  } else if (row.photo_id) {
    title = 'Shared a memory';
    target = { kind: 'photo', id: row.photo_id };
  } else if (row.collection_id) {
    const collection = db.get<{ name: string }>('SELECT name FROM collections WHERE id = ?', row.collection_id);
    title = collection ? `Updated ${collection.name}` : 'Updated a collection';
    target = { kind: 'collection', id: row.collection_id };
  } else if (row.type === 'MESSAGE_REACTION') {
    title = 'Reacted to your message';
  }

  return {
    id: row.id,
    type: row.type,
    createdAt: row.created_at,
    isRead: Boolean(row.is_read),
    actor: actor ? { id: actor.id, name: actor.name, profileImage: actor.profileImage } : null,
    title,
    preview,
    target,
  };
}

export function unreadCount(principal: Principal): number {
  return db.count(
    'SELECT COUNT(*) AS value FROM notifications WHERE user_id = ? AND space_id = ? AND is_read = 0',
    principal.userId,
    principal.spaceId,
  );
}

export function markAllRead(principal: Principal): number {
  const { changes } = db.run(
    'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND space_id = ? AND is_read = 0',
    principal.userId,
    principal.spaceId,
  );
  return changes;
}

export function markRead(principal: Principal, ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.run(
    `UPDATE notifications SET is_read = 1
     WHERE user_id = ? AND space_id = ? AND is_read = 0 AND id IN (${placeholders})`,
    principal.userId,
    principal.spaceId,
    ...ids,
  );
}
