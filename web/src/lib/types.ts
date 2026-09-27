/** Mirrors the server's public DTOs. */

export type Visibility = 'PRIVATE' | 'SHARED';
export type MessageType = 'TEXT' | 'IMAGE' | 'VOICE' | 'MEMORY' | 'DIARY';
export type Mood = 'HAPPY' | 'LOVED' | 'PEACEFUL' | 'EMOTIONAL' | 'FUNNY' | 'SAD' | 'EXCITED';

export interface PublicUser {
  id: string;
  name: string;
  profileImage: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
  showLastSeen: boolean;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  profileImage: string | null;
  createdAt: string;
}

export interface Space {
  id: string;
  name: string;
  role: 'owner' | 'member';
}

export interface UserSettings {
  notificationsEnabled: boolean;
  browserNotifications: boolean;
  showLastSeen: boolean;
  showOnlineStatus: boolean;
}

export interface Session {
  user: Me;
  space: Space;
  partner: PublicUser | null;
  settings: UserSettings;
  badges: { messages: number; notifications: number };
}

export interface Collection {
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

export interface Photo {
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

export interface DiaryEntry {
  id: string;
  title: string;
  content: string;
  mood: Mood | null;
  visibility: Visibility;
  entryDate: string;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  author: PublicUser;
  collection: { id: string; name: string } | null;
  tags: string[];
  photos: Photo[];
  photoCount: number;
  isOwn: boolean;
}

export interface Attachment {
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

export interface Message {
  id: string;
  type: MessageType;
  content: string | null;
  sender: PublicUser;
  replyTo: { id: string; senderName: string; type: MessageType; preview: string } | null;
  attachment: Attachment | null;
  sharedPhoto: (Photo & { collectionName: string | null; diaryTitle: string | null }) | null;
  sharedDiary: {
    id: string;
    title: string;
    preview: string;
    entryDate: string;
    mood: Mood | null;
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

export interface TimelineDay {
  date: string;
  photos: Photo[];
  diaryEntries: DiaryEntry[];
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

export interface HomeSummary {
  greeting: string;
  spaceName: string;
  partner: { id: string; name: string; profileImage: string | null; isOnline: boolean; lastSeenAt: string | null } | null;
  today: string;
  counts: { photos: number; diary: number; collections: number; messages: number; favorites: number };
  recentMessages: Message[];
  recentPhotos: Photo[];
  recentDiary: DiaryEntry[];
  favoriteMemories: { photos: Photo[]; diaryEntries: DiaryEntry[] };
  collections: Collection[];
  unreadMessages: number;
  unreadNotifications: number;
  lastMessage: { content: string | null; senderId: string; createdAt: string } | null;
}

export interface CollectionDetail {
  collection: Collection;
  photos: Photo[];
  diaryEntries: DiaryEntry[];
  stats: {
    photoCount: number;
    diaryCount: number;
    favoriteCount: number;
    firstMemoryAt: string | null;
    lastMemoryAt: string | null;
  };
}

export interface TagSummary {
  name: string;
  photoCount: number;
  entryCount: number;
}

export interface NotificationItem {
  id: string;
  type: 'MESSAGE' | 'MESSAGE_REACTION' | 'DIARY_SHARED' | 'MEMORY_SHARED' | 'COLLECTION_UPDATED';
  createdAt: string;
  isRead: boolean;
  actor: { id: string; name: string; profileImage: string | null } | null;
  title: string;
  preview: string | null;
  target: { kind: 'message' | 'diary' | 'photo' | 'collection' | null; id: string | null };
}

export interface SearchResults {
  query: string;
  diaryEntries: DiaryEntry[];
  photos: Photo[];
  collections: Collection[];
  tags: TagSummary[];
  messages: Message[];
  total: number;
}

export interface FavoritesFeed {
  photos: Photo[];
  diaryEntries: DiaryEntry[];
  messages: Message[];
}

export const MOODS: Array<{ value: Mood; emoji: string; label: string }> = [
  { value: 'HAPPY', emoji: '😊', label: 'Happy' },
  { value: 'LOVED', emoji: '🥰', label: 'Loved' },
  { value: 'PEACEFUL', emoji: '😌', label: 'Peaceful' },
  { value: 'EMOTIONAL', emoji: '🥹', label: 'Emotional' },
  { value: 'FUNNY', emoji: '😂', label: 'Funny' },
  { value: 'SAD', emoji: '😔', label: 'Sad' },
  { value: 'EXCITED', emoji: '✨', label: 'Excited' },
];

export const moodMeta = (mood: Mood | null | undefined) => MOODS.find((m) => m.value === mood) ?? null;
