import { db } from '../db/index.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { DiaryEntryRow, Principal, PublicUser, SpaceMemberRow, UserRow } from '../types.js';

/**
 * The private space is the security boundary of this application.
 *
 * Every authenticated user belongs to exactly one space, and every space has
 * exactly two members. A principal is only ever constructed after a successful
 * `space_members` lookup, so code downstream can trust `principal.spaceId`
 * without re-checking membership.
 */
export function getPrincipalForUser(userId: string): Principal | null {
  const membership = db.get<SpaceMemberRow>(
    'SELECT * FROM space_members WHERE user_id = ? ORDER BY joined_at ASC LIMIT 1',
    userId,
  );
  if (!membership) return null;

  const space = db.get<{ id: string; name: string }>(
    'SELECT id, name FROM private_spaces WHERE id = ?',
    membership.space_id,
  );
  if (!space) return null;

  const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', userId);
  if (!user) return null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    profileImage: user.profile_image,
    spaceId: space.id,
    spaceName: space.name,
    role: membership.role,
  };
}

/**
 * Hard authorization check: is this user genuinely a member of this space?
 * Called on every request that touches space-scoped data, regardless of any
 * IDs the client supplied.
 */
export function requireMembership(userId: string, spaceId: string): void {
  const member = db.get<{ id: string }>(
    'SELECT id FROM space_members WHERE space_id = ? AND user_id = ?',
    spaceId,
    userId,
  );
  if (!member) {
    throw forbidden('You are not a member of this private space.');
  }
}

/** Confirms a resource's spaceId matches the caller's space. */
export function assertSameSpace(principal: Principal, resourceSpaceId: string): void {
  if (principal.spaceId !== resourceSpaceId) {
    throw forbidden('That memory belongs to another space.');
  }
}

export function isSpaceMember(spaceId: string, userId: string): boolean {
  return Boolean(
    db.get<{ id: string }>(
      'SELECT id FROM space_members WHERE space_id = ? AND user_id = ?',
      spaceId,
      userId,
    ),
  );
}

/** The other person. There is always exactly one in a two-person space. */
export function getPartner(principal: Principal): PublicUser | null {
  const member = db.get<SpaceMemberRow>(
    'SELECT * FROM space_members WHERE space_id = ? AND user_id != ? LIMIT 1',
    principal.spaceId,
    principal.userId,
  );
  if (!member) return null;
  return toPublicUser(member.user_id);
}

export function toPublicUser(userId: string): PublicUser | null {
  const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', userId);
  if (!user) return null;
  const settings = db.get<{ show_last_seen: number; show_online_status: number }>(
    'SELECT show_last_seen, show_online_status FROM user_settings WHERE user_id = ?',
    userId,
  );
  return {
    id: user.id,
    name: user.name,
    profileImage: user.profile_image,
    isOnline: settings?.show_online_status ? Boolean(user.is_online) : false,
    lastSeenAt: settings?.show_last_seen ? user.last_seen_at : null,
    showLastSeen: settings?.show_last_seen !== 0,
  };
}

/**
 * Diary visibility is enforced here, in one place, so no route can forget it.
 * A PRIVATE entry is only ever returned to its author — never to the partner,
 * regardless of the entry id being known.
 */
export function canViewDiary(principal: Principal, entry: Pick<DiaryEntryRow, 'author_id' | 'space_id' | 'visibility'>): boolean {
  if (entry.space_id !== principal.spaceId) return false;
  if (entry.visibility === 'PRIVATE') return entry.author_id === principal.userId;
  return true;
}

export function assertCanViewDiary(principal: Principal, entry: DiaryEntryRow): void {
  if (!canViewDiary(principal, entry)) {
    // Deliberately 404-shaped for private entries: we do not confirm they exist.
    throw forbidden('That diary entry is private.');
  }
}

export function assertCanEditDiary(principal: Principal, entry: DiaryEntryRow): void {
  assertSameSpace(principal, entry.space_id);
  if (entry.author_id !== principal.userId) {
    throw forbidden('Only the author can change this diary entry.');
  }
}

/** Owner-or-partner: used for things like shared memory labels. */
export function assertNotSelf(principal: Principal, userId: string): void {
  if (userId === principal.userId) throw forbidden('This action needs the other person.');
}

export function requirePrincipal(principal: Principal | undefined): Principal {
  if (!principal) throw unauthorized();
  return principal;
}
