import { createHmac, randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { newId } from './ids.js';
import { nowIso } from './time.js';
import type { SessionRow, UserRow } from '../types.js';

export const SESSION_COOKIE = 'ols_session';

/**
 * Session tokens are opaque random values, not JWTs — there is no signature to
 * forge, and logout genuinely revokes.
 *
 * The stored value is an HMAC of the token keyed with SESSION_SECRET rather
 * than a bare hash. That is deliberate defence in depth: if the database were
 * ever dumped, the stored digests alone cannot be replayed as cookies without
 * also holding the secret. It is why SESSION_SECRET must be set in production.
 */
function hashToken(token: string): string {
  return createHmac('sha256', config.sessionSecret).update(token).digest('hex');
}

export interface CreateSessionInput {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export function createSession(input: CreateSessionInput): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlMs).toISOString();

  db.run(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    newId(),
    input.userId,
    hashToken(token),
    input.userAgent ?? null,
    input.ipAddress ?? null,
    expiresAt,
  );

  return { token, expiresAt };
}

export function resolveSession(token: string | undefined): { session: SessionRow; user: UserRow } | null {
  if (!token) return null;

  const session = db.get<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', hashToken(token));
  if (!session) return null;

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    db.run('DELETE FROM sessions WHERE id = ?', session.id);
    return null;
  }

  const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', session.user_id);
  if (!user) {
    db.run('DELETE FROM sessions WHERE id = ?', session.id);
    return null;
  }

  // Throttle the write so we do not hit the disk on every request.
  const lastUsed = new Date(session.last_used_at).getTime();
  if (Date.now() - lastUsed > 60_000) {
    db.run('UPDATE sessions SET last_used_at = ? WHERE id = ?', nowIso(), session.id);
  }

  return { session, user };
}

export function destroySession(token: string | undefined): void {
  if (!token) return;
  db.run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
}

export function destroyAllSessionsForUser(userId: string): void {
  db.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function purgeExpiredSessions(): void {
  db.run('DELETE FROM sessions WHERE expires_at <= ?', nowIso());
}

export function sessionCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.cookieSecure,
    path: '/',
    maxAge: maxAgeMs,
  };
}
