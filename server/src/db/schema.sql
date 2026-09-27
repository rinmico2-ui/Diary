-- Our Little Space — schema
-- A private two-person world. Every table is scoped to a private_space.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  profile_image  TEXT,
  last_seen_at   TEXT,
  is_online      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS private_spaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS space_members (
  id         TEXT PRIMARY KEY,
  space_id   TEXT NOT NULL REFERENCES private_spaces(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (space_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  user_agent   TEXT,
  ip_address   TEXT,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Binary assets live on disk / object storage, only metadata lives here.
CREATE TABLE IF NOT EXISTS attachments (
  id                TEXT PRIMARY KEY,
  space_id          TEXT NOT NULL REFERENCES private_spaces(id) ON DELETE CASCADE,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('IMAGE','VOICE')),
  url               TEXT NOT NULL,
  thumbnail_url     TEXT,
  mime_type         TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  width             INTEGER,
  height            INTEGER,
  duration_seconds  REAL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_space ON attachments(space_id);

CREATE TABLE IF NOT EXISTS messages (
  id                    TEXT PRIMARY KEY,
  space_id              TEXT NOT NULL REFERENCES private_spaces(id) ON DELETE CASCADE,
  sender_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_type          TEXT NOT NULL CHECK (message_type IN ('TEXT','IMAGE','VOICE','MEMORY','DIARY')),
  content               TEXT,
  reply_to_message_id   TEXT REFERENCES messages(id) ON DELETE SET NULL,
  attachment_id         TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  -- MEMORY / DIARY shares point at the shared object; denormalised for fast chat rendering
  shared_photo_id       TEXT,
  shared_diary_entry_id TEXT,
  shared_collection_id  TEXT,
  is_edited             INTEGER NOT NULL DEFAULT 0,
  is_deleted            INTEGER NOT NULL DEFAULT 0,
  is_favorite           INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_space_created ON messages(space_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

CREATE TABLE IF NOT EXISTS message_reads (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_message_reads_user ON message_reads(user_id);

CREATE TABLE IF NOT EXISTS message_reactions (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS collections (
  id              TEXT PRIMARY KEY,
  space_id        TEXT NOT NULL REFERENCES private_spaces(id) ON DELETE CASCADE,
  created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  cover_photo_id  TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_collections_space ON collections(space_id);

CREATE TABLE IF NOT EXISTS diary_entries (
  id            TEXT PRIMARY KEY,
  author_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id      TEXT NOT NULL REFERENCES private_spaces(id) ON DELETE CASCADE,
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL DEFAULT '',
  mood          TEXT CHECK (mood IS NULL OR mood IN ('HAPPY','LOVED','PEACEFUL','EMOTIONAL','FUNNY','SAD','EXCITED')),
  visibility    TEXT NOT NULL DEFAULT 'SHARED' CHECK (visibility IN ('PRIVATE','SHARED')),
  entry_date    TEXT NOT NULL,
  is_favorite   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_diary_space_date ON diary_entries(space_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_diary_author ON diary_entries(author_id);
CREATE INDEX IF NOT EXISTS idx_diary_collection ON diary_entries(collection_id);

CREATE TABLE IF NOT EXISTS photos (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id       TEXT NOT NULL REFERENCES private_spaces(id) ON DELETE CASCADE,
  collection_id  TEXT REFERENCES collections(id) ON DELETE SET NULL,
  diary_entry_id TEXT REFERENCES diary_entries(id) ON DELETE SET NULL,
  image_url      TEXT NOT NULL,
  thumbnail_url  TEXT,
  caption        TEXT,
  description    TEXT,
  photo_date     TEXT NOT NULL,
  is_favorite    INTEGER NOT NULL DEFAULT 0,
  width          INTEGER,
  height         INTEGER,
  size_bytes     INTEGER,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_photos_space_date ON photos(space_id, photo_date);
CREATE INDEX IF NOT EXISTS idx_photos_collection ON photos(collection_id);
CREATE INDEX IF NOT EXISTS idx_photos_diary ON photos(diary_entry_id);
CREATE INDEX IF NOT EXISTS idx_photos_owner ON photos(owner_id);

CREATE TABLE IF NOT EXISTS tags (
  id        TEXT PRIMARY KEY,
  space_id  TEXT NOT NULL REFERENCES private_spaces(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (space_id, name)
);

CREATE TABLE IF NOT EXISTS memory_tags (
  id             TEXT PRIMARY KEY,
  tag_id         TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  diary_entry_id TEXT REFERENCES diary_entries(id) ON DELETE CASCADE,
  photo_id       TEXT REFERENCES photos(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((diary_entry_id IS NOT NULL AND photo_id IS NULL) OR (photo_id IS NOT NULL AND diary_entry_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_tags_entry_tag ON memory_tags(diary_entry_id, tag_id) WHERE diary_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_tags_photo_tag ON memory_tags(photo_id, tag_id) WHERE photo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag_id);

-- Single-use invitation codes. The code itself is never stored, only a hash,
-- so a database leak cannot be replayed as a working invitation.
CREATE TABLE IF NOT EXISTS invite_codes (
  id          TEXT PRIMARY KEY,
  space_id    TEXT NOT NULL REFERENCES private_spaces(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL UNIQUE,
  code_hint   TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT,
  used_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  used_at     TEXT,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_invite_codes_space ON invite_codes(space_id);

CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  space_id        TEXT NOT NULL REFERENCES private_spaces(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id        TEXT REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('MESSAGE','MESSAGE_REACTION','DIARY_SHARED','MEMORY_SHARED','COLLECTION_UPDATED')),
  message_id      TEXT REFERENCES messages(id) ON DELETE CASCADE,
  diary_entry_id  TEXT REFERENCES diary_entries(id) ON DELETE CASCADE,
  photo_id        TEXT REFERENCES photos(id) ON DELETE CASCADE,
  collection_id   TEXT REFERENCES collections(id) ON DELETE CASCADE,
  data            TEXT,
  is_read         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id                    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notifications_enabled      INTEGER NOT NULL DEFAULT 1,
  browser_notifications      INTEGER NOT NULL DEFAULT 1,
  show_last_seen             INTEGER NOT NULL DEFAULT 1,
  show_online_status         INTEGER NOT NULL DEFAULT 1,
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
