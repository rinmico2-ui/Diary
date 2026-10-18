import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const rootDir = path.resolve(import.meta.dirname, '..');
const resolveFromRoot = (p: string) => (path.isAbsolute(p) ? p : path.join(rootDir, p));

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

const sessionSecret = process.env.SESSION_SECRET ?? '';

if (isProduction && sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters in production.');
}

if (!isProduction && sessionSecret.length < 32) {
  // A random per-boot fallback would silently sign everyone out on every
  // restart, so say so rather than letting it be discovered later.
  console.warn(
    '\n  [warning] SESSION_SECRET is not set in .env, so a random one was generated.\n' +
      '            Every restart will sign both people out. Generate a real one with:\n' +
      '            node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"\n',
  );
}

// Render (and similar hosts) mount a persistent disk at a fixed path; prefer it
// automatically so data survives redeploys without extra configuration.
function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  for (const candidate of ['/var/data', '/data']) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore and fall through */
    }
  }
  return './data';
}
const dataDir = resolveDataDir();
const databasePath = resolveFromRoot(process.env.DATABASE_PATH ?? path.join(dataDir, 'our-space.db'));
const databaseUrl = process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL ?? '';
const databaseAuthToken = process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN ?? '';
const databaseSyncUrl = process.env.DATABASE_SYNC_URL ?? process.env.TURSO_SYNC_URL ?? '';
const storageDir = resolveFromRoot(process.env.STORAGE_DIR ?? path.join(dataDir, 'storage'));

for (const dir of [path.dirname(databasePath), storageDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const corsOrigins = (process.env.CORS_ORIGINS ?? process.env.WEB_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const config = {
  env: nodeEnv,
  isProduction,
  port: int(process.env.PORT, 4000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  corsOrigins,
  sessionSecret: sessionSecret || crypto.randomBytes(48).toString('base64url'),
  databasePath,
  databaseUrl,
  databaseAuthToken,
  databaseSyncUrl,
  storageDir,
  /** The built client. In production this process also serves it, so the app
   *  runs on a single origin — which is what the httpOnly session cookie wants. */
  clientDist: path.resolve(rootDir, '..', 'web', 'dist'),
  storagePaths: {
    photos: path.join(storageDir, 'photos'),
    thumbnails: path.join(storageDir, 'thumbnails'),
    audio: path.join(storageDir, 'audio'),
    avatars: path.join(storageDir, 'avatars'),
  },
  maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 15 * 1024 * 1024),
  maxAudioUploadBytes: int(process.env.MAX_AUDIO_UPLOAD_BYTES, 10 * 1024 * 1024),
  maxFilesPerUpload: int(process.env.MAX_FILES_PER_UPLOAD, 20),
  cookieSecure: bool(process.env.COOKIE_SECURE, isProduction),
  /**
   * Registration is closed by default. A person needs this shared code to create
   * an account, and the space refuses to accept a third member.
   */
  inviteCode: process.env.INVITE_CODE ?? (isProduction ? '' : 'our-little-space'),
  spaceName: process.env.SPACE_NAME ?? 'Our Little Space ❤️',
  sessionTtlMs: 1000 * 60 * 60 * 24 * 30,
  /** Password reset links are deliberately short lived — long enough to read
   *  the email, short enough that a leaked link is rarely still usable. */
  resetTokenTtlMs: 1000 * 60 * 30,
  /**
   * Outbound SMTP for password reset mail. `host` being empty means email is
   * not configured, and the forgot-password endpoint says so plainly instead
   * of pretending a message was sent.
   */
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'Our Little Space <no-reply@localhost>',
  },
  rateLimitWindowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  /** Prints the account list in the boot log. Off by default: emails in a
   *  shared log are only okay when the operator explicitly asks for them. */
  logAccounts: bool(process.env.LOG_ACCOUNTS, false),
  authRateLimitMax: int(process.env.AUTH_RATE_LIMIT_MAX, 10),
  apiRateLimitMax: int(process.env.API_RATE_LIMIT_MAX, 600),
  uploadRateLimitMax: int(process.env.UPLOAD_RATE_LIMIT_MAX, 120),
} as const;

export type Config = typeof config;
