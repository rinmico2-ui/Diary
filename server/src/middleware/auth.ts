import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { SESSION_COOKIE, resolveSession } from '../lib/session.js';
import { getPrincipalForUser } from '../services/space.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { Principal, PublicUser } from '../types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
      /** Set when the caller has authenticated but is not yet in the space. */
      userId?: string;
    }
  }
}

/**
 * Step 1 of the security chain: who is this?
 *
 * Reads the opaque session cookie, resolves it to a user, and attaches a
 * principal built from a real `space_members` row.
 */
export function attachPrincipal(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const resolved = resolveSession(token);

  if (resolved) {
    req.userId = resolved.user.id;
    const principal = getPrincipalForUser(resolved.user.id);
    // An authenticated user with no space membership gets a principal-less
    // request: routes that need a space will reject with 403.
    if (principal) req.principal = principal;
  }

  next();
}

/** Step 2: require a valid session AND space membership. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.userId) return next(unauthorized());
  if (!req.principal) {
    return next(forbidden('Your account is not part of a private space yet.'));
  }
  next();
}

/** Narrowing helper so route handlers get a non-optional principal. */
export function principalOf(req: Request): Principal {
  if (!req.principal) throw unauthorized();
  return req.principal;
}

export function partnerOf(req: Request): PublicUser | null {
  const principal = principalOf(req);

  // Being the only member is a normal, temporary state while waiting for the
  // second person to accept an invitation — it must not be an error.
  const member = db.get<{ user_id: string }>(
    'SELECT user_id FROM space_members WHERE space_id = ? AND user_id != ? LIMIT 1',
    principal.spaceId,
    principal.userId,
  );
  if (!member) return null;

  const partner = db.get<{ id: string; name: string; profile_image: string | null; is_online: number; last_seen_at: string | null }>(
    'SELECT id, name, profile_image, is_online, last_seen_at FROM users WHERE id = ?',
    member.user_id,
  );
  if (!partner) return null;

  const settings = db.get<{ show_last_seen: number; show_online_status: number }>(
    'SELECT show_last_seen, show_online_status FROM user_settings WHERE user_id = ?',
    partner.id,
  );

  return {
    id: partner.id,
    name: partner.name,
    profileImage: partner.profile_image,
    isOnline: settings?.show_online_status ? Boolean(partner.is_online) : false,
    lastSeenAt: settings?.show_last_seen ? partner.last_seen_at : null,
    showLastSeen: settings?.show_last_seen !== 0,
  };
}

export function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0]!.trim();
  return req.ip ?? null;
}

export function requireProductionSecret(): void {
  if (config.isProduction && config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET is not configured.');
  }
}
