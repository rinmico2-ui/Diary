import { createHmac, randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { newId } from './ids.js';
import { nowIso } from './time.js';
import type { PasswordResetTokenRow } from '../types.js';

/**
 * Reset tokens follow the session rule: the raw value only ever exists in the
 * email, and the database keeps an HMAC of it keyed with SESSION_SECRET. A
 * dumped table therefore yields no usable reset links.
 */
function hashToken(token: string): string {
  return createHmac('sha256', config.sessionSecret).update(token).digest('hex');
}

/** True while the token can still be spent once. */
export function isResetTokenUsable(row: PasswordResetTokenRow): boolean {
  return !row.used_at && new Date(row.expires_at).getTime() > Date.now();
}

export function peekPasswordResetToken(token: string): PasswordResetTokenRow | null {
  if (!token) return null;
  return (
    db.get<PasswordResetTokenRow>('SELECT * FROM password_reset_tokens WHERE token_hash = ?', hashToken(token)) ??
    null
  );
}

/**
 * Issues a fresh token, invalidating any earlier link for that person — only
 * the most recent email can ever work.
 */
export function issuePasswordResetToken(userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.resetTokenTtlMs).toISOString();

  db.transaction(() => {
    db.run('DELETE FROM password_reset_tokens WHERE user_id = ?', userId);
    db.run(
      'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      newId(),
      userId,
      hashToken(token),
      expiresAt,
    );
  });

  return { token, expiresAt };
}

/**
 * Spends the token: deletes it and every other outstanding link for that user.
 * Must be called inside `db.transaction`, next to the password update, so the
 * token cannot be redeemed twice or survive a rollback.
 *
 * Returns the user the token belonged to, or null when it was already gone.
 */
export function consumePasswordResetToken(token: string): string | null {
  const row = peekPasswordResetToken(token);
  if (!row || !isResetTokenUsable(row)) return null;

  db.run('DELETE FROM password_reset_tokens WHERE user_id = ?', row.user_id);
  return row.user_id;
}

export function purgeExpiredPasswordResetTokens(): void {
  db.run('DELETE FROM password_reset_tokens WHERE expires_at <= ?', nowIso());
}
