import { createHash, randomInt } from 'node:crypto';
import { db } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';
import { badRequest, forbidden, notFound, tooManySpaces } from '../lib/errors.js';
import type { Principal } from '../types.js';

// Ambiguous characters (0/O, 1/I/L) are left out so a code read aloud or typed
// from a text message survives the trip.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUPS = 3;
const GROUP_LENGTH = 4;

/** e.g. `7K2M-4XQ9-8TZR` — 60 bits of entropy, one group per 4 characters. */
export function generateInviteCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = '';
    for (let i = 0; i < GROUP_LENGTH; i++) {
      group += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}

/** Normalises user input: lowercase, no spaces, dashes grouped consistently. */
export function normaliseInviteCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/(.{4})(?=.)/g, '$1-');
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export interface InviteCodeDto {
  id: string;
  /** Last few characters, so a code can be recognised without storing it. */
  hint: string;
  createdAt: string;
  expiresAt: string | null;
  usedAt: string | null;
  usedByName: string | null;
  revokedAt: string | null;
  status: 'active' | 'used' | 'expired' | 'revoked';
}

function toDto(row: {
  id: string;
  code_hint: string;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
  used_by: string | null;
  revoked_at: string | null;
}): InviteCodeDto {
  const now = Date.now();
  const expired = row.expires_at !== null && new Date(row.expires_at).getTime() <= now;

  let status: InviteCodeDto['status'] = 'active';
  if (row.revoked_at) status = 'revoked';
  else if (row.used_at) status = 'used';
  else if (expired) status = 'expired';

  const usedBy = row.used_by
    ? db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', row.used_by)
    : undefined;

  return {
    id: row.id,
    hint: row.code_hint,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    usedByName: usedBy?.name ?? null,
    revokedAt: row.revoked_at,
    status,
  };
}

export function memberCount(spaceId: string): number {
  return db.count('SELECT COUNT(*) AS value FROM space_members WHERE space_id = ?', spaceId);
}

export function seatsLeft(spaceId: string): number {
  return Math.max(0, 2 - memberCount(spaceId));
}

export interface CreateInviteOptions {
  /** Hours until the code stops working. Omit for no expiry. */
  expiresInHours?: number;
}

export interface CreatedInvite {
  code: string;
  invite: InviteCodeDto;
}

export function createInviteCode(principal: Principal, options: CreateInviteOptions = {}): CreatedInvite {
  if (seatsLeft(principal.spaceId) === 0) {
    throw tooManySpaces('There is already a second person here. 💛');
  }

  // Only the owner may invite, so a member cannot quietly add a third person
  // if the owner ever hands over their session.
  if (principal.role !== 'owner') {
    throw forbidden('Only the person who set this space up can invite someone.');
  }

  const code = generateInviteCode();
  const expiresAt =
    options.expiresInHours && options.expiresInHours > 0
      ? new Date(Date.now() + options.expiresInHours * 60 * 60 * 1000).toISOString()
      : null;

  const id = newId();
  db.run(
    `INSERT INTO invite_codes (id, space_id, code_hash, code_hint, created_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    principal.spaceId,
    hashCode(code),
    code.slice(-6),
    principal.userId,
    expiresAt,
  );

  const row = db.get<Parameters<typeof toDto>[0]>('SELECT * FROM invite_codes WHERE id = ?', id)!;
  return { code, invite: toDto(row) };
}

export function listInviteCodes(principal: Principal): InviteCodeDto[] {
  return db
    .all<Parameters<typeof toDto>[0]>(
      'SELECT * FROM invite_codes WHERE space_id = ? ORDER BY created_at DESC',
      principal.spaceId,
    )
    .map(toDto);
}

export function revokeInviteCode(principal: Principal, id: string): void {
  if (principal.role !== 'owner') throw forbidden('Only the owner can revoke an invitation.');

  const row = db.get<{ id: string; space_id: string; revoked_at: string | null; used_at: string | null }>(
    'SELECT * FROM invite_codes WHERE id = ?',
    id,
  );
  if (!row || row.space_id !== principal.spaceId) throw notFound('That invitation no longer exists.');
  if (row.used_at) throw badRequest('That code has already been used.');
  if (row.revoked_at) return;

  db.run('UPDATE invite_codes SET revoked_at = ? WHERE id = ?', nowIso(), id);
}

/**
 * Consumes an invitation, if it is genuinely usable.
 *
 * `bootstrapCode` is the server's configured INVITE_CODE. It is accepted as a
 * fallback so an existing installation is never locked out of its own space.
 */
export function consumeInviteCode(
  spaceId: string,
  rawCode: string,
  userId: string,
  bootstrapCode?: string,
): { id: string } {
  const normalised = normaliseInviteCode(rawCode);
  if (!normalised) throw badRequest('Enter your invitation code.');

  const row = db.get<{
    id: string;
    code_hash: string;
    space_id: string;
    expires_at: string | null;
    used_at: string | null;
    revoked_at: string | null;
  }>('SELECT * FROM invite_codes WHERE code_hash = ?', hashCode(normalised));

  if (row) {
    if (row.space_id !== spaceId) throw badRequest('That invitation is for a different space.');
    if (row.revoked_at) throw badRequest('That invitation has been cancelled. Ask for a new one.');
    if (row.used_at) throw badRequest('That invitation has already been used. Ask for a new one.');
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      throw badRequest('That invitation has expired. Ask for a new one.');
    }

    db.run('UPDATE invite_codes SET used_by = ?, used_at = ? WHERE id = ?', userId, nowIso(), row.id);
    return { id: row.id };
  }

  if (bootstrapCode && normaliseInviteCode(bootstrapCode) === normalised) {
    // A configured code can be used as many times as the two-person cap allows.
    return { id: 'bootstrap' };
  }

  throw badRequest('That invitation code is not valid.');
}

/** Read-only check. Deliberately does NOT touch the code — see `consumeInviteCode`. */
export function checkInviteCode(spaceId: string, rawCode: string, bootstrapCode?: string): { ok: true } | { ok: false; reason: string } {
  const normalised = normaliseInviteCode(rawCode);
  if (!normalised) return { ok: false, reason: 'Enter your invitation code.' };

  const row = db.get<{
    space_id: string;
    expires_at: string | null;
    used_at: string | null;
    revoked_at: string | null;
  }>('SELECT space_id, expires_at, used_at, revoked_at FROM invite_codes WHERE code_hash = ?', hashCode(normalised));

  if (!row) {
    if (bootstrapCode && normaliseInviteCode(bootstrapCode) === normalised) return { ok: true };
    return { ok: false, reason: 'That invitation code is not valid.' };
  }

  if (row.space_id !== spaceId) return { ok: false, reason: 'That invitation is for a different space.' };
  if (row.revoked_at) return { ok: false, reason: 'That invitation has been cancelled. Ask for a new one.' };
  if (row.used_at) return { ok: false, reason: 'That invitation has already been used. Ask for a new one.' };
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'That invitation has expired. Ask for a new one.' };
  }

  return { ok: true };
}
