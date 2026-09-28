export type Visibility = 'PRIVATE' | 'SHARED';
export type MessageType = 'TEXT' | 'IMAGE' | 'VOICE' | 'MEMORY' | 'DIARY';
export type Mood = 'HAPPY' | 'LOVED' | 'PEACEFUL' | 'EMOTIONAL' | 'FUNNY' | 'SAD' | 'EXCITED';
export type NotificationType =
  | 'MESSAGE'
  | 'MESSAGE_REACTION'
  | 'DIARY_SHARED'
  | 'MEMORY_SHARED'
  | 'COLLECTION_UPDATED';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  profile_image: string | null;
  last_seen_at: string | null;
  is_online: number;
  created_at: string;
  updated_at: string;
}

export interface SpaceRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface SpaceMemberRow {
  id: string;
  space_id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: string;
  created_at: string;
  last_used_at: string;
}

export interface PasswordResetTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface AttachmentRow {
  id: string;
  space_id: string;
  owner_id: string;
  kind: 'IMAGE' | 'VOICE';
  url: string;
  thumbnail_url: string | null;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  created_at: string;
}

export interface MessageRow {
  id: string;
  space_id: string;
  sender_id: string;
  message_type: MessageType;
  content: string | null;
  reply_to_message_id: string | null;
  attachment_id: string | null;
  shared_photo_id: string | null;
  shared_diary_entry_id: string | null;
  shared_collection_id: string | null;
  is_edited: number;
  is_deleted: number;
  is_favorite: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionRow {
  id: string;
  space_id: string;
  created_by: string;
  name: string;
  description: string | null;
  cover_photo_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiaryEntryRow {
  id: string;
  author_id: string;
  space_id: string;
  collection_id: string | null;
  title: string;
  content: string;
  mood: Mood | null;
  visibility: Visibility;
  entry_date: string;
  is_favorite: number;
  created_at: string;
  updated_at: string;
}

export interface PhotoRow {
  id: string;
  owner_id: string;
  space_id: string;
  collection_id: string | null;
  diary_entry_id: string | null;
  image_url: string;
  thumbnail_url: string | null;
  caption: string | null;
  description: string | null;
  photo_date: string;
  is_favorite: number;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
}

export interface TagRow {
  id: string;
  space_id: string;
  name: string;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  space_id: string;
  user_id: string;
  actor_id: string | null;
  type: NotificationType;
  message_id: string | null;
  diary_entry_id: string | null;
  photo_id: string | null;
  collection_id: string | null;
  data: string | null;
  is_read: number;
  created_at: string;
}

export interface UserSettingsRow {
  user_id: string;
  notifications_enabled: number;
  browser_notifications: number;
  show_last_seen: number;
  show_online_status: number;
  updated_at: string;
}

/** The authenticated principal attached to every request. */
export interface Principal {
  userId: string;
  email: string;
  name: string;
  profileImage: string | null;
  /** The single private space this user belongs to. There is only ever one. */
  spaceId: string;
  spaceName: string;
  role: 'owner' | 'member';
}

export interface PublicUser {
  id: string;
  name: string;
  profileImage: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
  showLastSeen: boolean;
}
