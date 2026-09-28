import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';
import { badRequest, conflict, forbidden, serviceUnavailable, tooManySpaces, unauthorized } from '../lib/errors.js';
import { hashPassword, passwordProblems, verifyPassword } from '../lib/password.js';
import {
  consumePasswordResetToken,
  isResetTokenUsable,
  issuePasswordResetToken,
  peekPasswordResetToken,
} from '../lib/passwordReset.js';
import { isMailConfigured, sendPasswordResetEmail } from '../lib/mailer.js';
import { checkInviteCode, consumeInviteCode } from '../services/invites.js';
import {
  SESSION_COOKIE,
  createSession,
  destroyAllSessionsForUser,
  destroySession,
  sessionCookieOptions,
} from '../lib/session.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { asyncRoute } from '../middleware/errors.js';
import { clientIp, partnerOf, principalOf, requireAuth } from '../middleware/auth.js';
import { clearUserCache, publicUserOf } from '../services/serialize.js';
import { unreadCount } from '../services/notifications.js';
import { unreadMessageSummary } from '../services/messages.js';
import type { SpaceMemberRow, UserRow } from '../types.js';

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Tell us your name.').max(60),
  email: z.string().trim().toLowerCase().email('That email does not look right.').max(160),
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
  // Optional: the very first person needs no code because the space is empty.
  // Everyone after that must present a working invitation.
  inviteCode: z.string().trim().max(40).optional().default(''),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('That email does not look right.'),
  password: z.string().min(1, 'Enter your password.'),
});

/** The space holds exactly two people. No third seat is ever created. */
function spaceMemberCount(spaceId: string): number {
  return db.count('SELECT COUNT(*) AS value FROM space_members WHERE space_id = ?', spaceId);
}

function theSpaceId(): string {
  const space = db.get<{ id: string }>('SELECT id FROM private_spaces ORDER BY created_at ASC LIMIT 1');
  if (!space) throw new Error('The private space has not been created yet. Run: npm run seed');
  return space.id;
}

authRouter.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncRoute(async (req, res) => {
    const { name, email, password, inviteCode } = req.body as z.infer<typeof registerSchema>;

    const problems = passwordProblems(password);
    if (problems.length > 0) {
      throw badRequest(`Your password needs ${problems.join(', ')}.`);
    }

    if (db.get<UserRow>('SELECT * FROM users WHERE email = ?', email)) {
      throw conflict('An account already uses that email.');
    }

    const spaceId = theSpaceId();
    const existingMembers = spaceMemberCount(spaceId);

    if (existingMembers >= 2) {
      throw tooManySpaces('This space already has its two people. 💛');
    }

    const userId = newId();
    const passwordHash = await hashPassword(password);
    const role: 'owner' | 'member' = existingMembers === 0 ? 'owner' : 'member';

    // The second person must prove they were invited. The first person needs no
    // code at all — there is nobody to invite them yet. This is validated
    // read-only first, so a bad code never creates a half-finished account.
    if (existingMembers > 0) {
      if (!inviteCode) throw badRequest('You need an invitation code to join this space.');
      const check = checkInviteCode(spaceId, inviteCode, config.inviteCode);
      if (!check.ok) throw badRequest(check.reason);
    }

    db.transaction(() => {
      db.run(
        'INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
        userId,
        name,
        email,
        passwordHash,
      );

      // Burned inside the transaction, and only after the user exists, because
      // invite_codes.used_by is a foreign key. A throw here rolls everything back.
      if (existingMembers > 0) {
        consumeInviteCode(spaceId, inviteCode, userId, config.inviteCode);
      }

      db.run(
        'INSERT INTO space_members (id, space_id, user_id, role) VALUES (?, ?, ?, ?)',
        newId(),
        spaceId,
        userId,
        role,
      );
      db.run('INSERT INTO user_settings (user_id) VALUES (?)', userId);
    });

    clearUserCache();
    const { token } = createSession({ userId, userAgent: req.get('user-agent'), ipAddress: clientIp(req) });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config.sessionTtlMs));
    res.status(201).json({ user: publicUserOf(userId), role });
  }),
);

/** Lets the sign-up form confirm a code before the person commits to a password. */
authRouter.post(
  '/check-invite',
  authLimiter,
  validate(z.object({ inviteCode: z.string().trim().min(1, 'Enter your invitation code.').max(40) })),
  asyncRoute(async (req, res) => {
    const { inviteCode } = req.body as { inviteCode: string };
    const spaceId = theSpaceId();
    const seats = 2 - spaceMemberCount(spaceId);

    if (seats <= 0) {
      throw tooManySpaces('This space already has its two people. 💛');
    }

    const result = checkInviteCode(spaceId, inviteCode, config.inviteCode);
    if (!result.ok) throw badRequest(result.reason);

    res.json({ valid: true });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncRoute(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const user = db.get<UserRow>('SELECT * FROM users WHERE email = ?', email);
    // Always run a hash comparison so a missing account and a wrong password
    // take the same amount of time.
    const stored = user?.password_hash ?? 'scrypt$65536$8$1$AAAA$AAAA';
    const valid = await verifyPassword(password, stored);

    if (!user || !valid) throw unauthorized('That email and password do not match.');

    const membership = db.get<SpaceMemberRow>(
      'SELECT * FROM space_members WHERE user_id = ? LIMIT 1',
      user.id,
    );
    if (!membership) throw forbidden('Your account is not part of a private space.');

    const { token } = createSession({ userId: user.id, userAgent: req.get('user-agent'), ipAddress: clientIp(req) });
    clearUserCache();
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config.sessionTtlMs));
    res.json({ user: publicUserOf(user.id) });
  }),
);

authRouter.post('/logout', (req, res) => {
  destroySession(req.cookies?.[SESSION_COOKIE] as string | undefined);
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(0), maxAge: undefined });
  res.status(204).end();
});

/** Everything the app shell needs on boot, in one round trip. */
authRouter.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const me = db.get<UserRow>('SELECT * FROM users WHERE id = ?', principal.userId)!;
    const settings = db.get<{
      notifications_enabled: number;
      browser_notifications: number;
      show_last_seen: number;
      show_online_status: number;
    }>('SELECT * FROM user_settings WHERE user_id = ?', principal.userId);

    res.json({
      user: {
        id: me.id,
        name: me.name,
        email: me.email,
        profileImage: me.profile_image,
        createdAt: me.created_at,
      },
      space: { id: principal.spaceId, name: principal.spaceName, role: principal.role },
      partner: partnerOf(req),
      settings: {
        notificationsEnabled: settings?.notifications_enabled !== 0,
        browserNotifications: settings?.browser_notifications !== 0,
        showLastSeen: settings?.show_last_seen !== 0,
        showOnlineStatus: settings?.show_online_status !== 0,
      },
      badges: {
        messages: unreadMessageSummary(principal).unreadCount,
        notifications: unreadCount(principal),
      },
    });
  }),
);

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string().min(10, 'Use at least 10 characters.').max(200),
});

authRouter.post(
  '/change-password',
  requireAuth,
  authLimiter,
  validate(passwordSchema),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const { currentPassword, newPassword } = req.body as z.infer<typeof passwordSchema>;

    const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', principal.userId);
    if (!user) throw unauthorized();

    if (!(await verifyPassword(currentPassword, user.password_hash))) {
      throw unauthorized('That is not your current password.');
    }

    const problems = passwordProblems(newPassword);
    if (problems.length > 0) throw badRequest(`Your new password needs ${problems.join(', ')}.`);

    db.run(
      'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
      await hashPassword(newPassword),
      nowIso(),
      principal.userId,
    );

    // Every other device is signed out; the current cookie is refreshed below.
    destroyAllSessionsForUser(principal.userId);
    const { token } = createSession({ userId: principal.userId, userAgent: req.get('user-agent'), ipAddress: clientIp(req) });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config.sessionTtlMs));
    res.status(204).end();
  }),
);

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('That email does not look right.'),
});

/**
 * Starts a reset. The reply is identical whether or not the address is known —
 * otherwise this endpoint tells anyone which emails have accounts here.
 */
authRouter.post(
  '/forgot-password',
  authLimiter,
  validate(forgotPasswordSchema),
  asyncRoute(async (req, res) => {
    const { email } = req.body as z.infer<typeof forgotPasswordSchema>;

    // Checked before the lookup so a half-configured server fails the same way
    // for every address instead of only for the ones that exist.
    if (!isMailConfigured()) {
      throw serviceUnavailable(
        'Password reset email is not configured on this server yet. Set SMTP_HOST in server/.env.',
      );
    }

    const generic = {
      ok: true,
      message: 'If an account uses that email, a reset link is on its way.',
    };

    const user = db.get<UserRow>('SELECT * FROM users WHERE email = ?', email);
    if (!user) {
      res.json(generic);
      return;
    }

    const { token, expiresAt } = issuePasswordResetToken(user.id);
    const expiresMinutes = Math.max(1, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000));
    const resetUrl = `${config.webOrigin}/reset-password?token=${encodeURIComponent(token)}`;

    // A send failure is surfaced rather than swallowed: quietly pretending an
    // email is coming is the one failure a person cannot discover on their own.
    await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl, expiresMinutes });

    res.json(generic);
  }),
);

/** Lets the reset page say "this link expired" before anyone types a password. */
authRouter.get(
  '/reset-password/:token',
  authLimiter,
  validate(z.object({ token: z.string().trim().min(1, 'That link is missing its token.') }), 'params'),
  asyncRoute(async (req, res) => {
    const { token } = req.params as { token: string };
    const row = peekPasswordResetToken(token);

    if (!row || !isResetTokenUsable(row)) {
      throw badRequest('That reset link is not valid or has expired. Ask for a new one.');
    }

    res.json({ valid: true });
  }),
);

const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'That link is missing its token.'),
  newPassword: z.string().min(10, 'Use at least 10 characters.').max(200),
});

authRouter.post(
  '/reset-password',
  authLimiter,
  validate(resetPasswordSchema),
  asyncRoute(async (req, res) => {
    const { token, newPassword } = req.body as z.infer<typeof resetPasswordSchema>;

    const row = peekPasswordResetToken(token);
    if (!row || !isResetTokenUsable(row)) {
      throw badRequest('That reset link is not valid or has expired. Ask for a new one.');
    }

    const problems = passwordProblems(newPassword);
    if (problems.length > 0) throw badRequest(`Your new password needs ${problems.join(', ')}.`);

    const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.user_id);
    if (!user) throw badRequest('That reset link is not valid or has expired. Ask for a new one.');

    const passwordHash = await hashPassword(newPassword);

    // Spending the token and changing the password commit together, so a link
    // is either fully used or still fully valid — never a half-finished reset.
    db.transaction(() => {
      const spentUserId = consumePasswordResetToken(token);
      if (!spentUserId) throw badRequest('That reset link is no longer valid. Ask for a new one.');

      db.run(
        'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
        passwordHash,
        nowIso(),
        spentUserId,
      );
    });

    // Every other device is signed out; this one gets a fresh session below.
    clearUserCache();
    destroyAllSessionsForUser(user.id);
    const { token: sessionToken } = createSession({
      userId: user.id,
      userAgent: req.get('user-agent'),
      ipAddress: clientIp(req),
    });
    res.cookie(SESSION_COOKIE, sessionToken, sessionCookieOptions(config.sessionTtlMs));
    res.status(204).end();
  }),
);

const settingsSchema = z.object({
  notificationsEnabled: z.boolean().optional(),
  browserNotifications: z.boolean().optional(),
  showLastSeen: z.boolean().optional(),
  showOnlineStatus: z.boolean().optional(),
});

authRouter.patch(
  '/settings',
  requireAuth,
  validate(settingsSchema),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const body = req.body as z.infer<typeof settingsSchema>;

    db.run(
      `UPDATE user_settings SET
         notifications_enabled = ?, browser_notifications = ?, show_last_seen = ?, show_online_status = ?, updated_at = ?
       WHERE user_id = ?`,
      body.notificationsEnabled === undefined ? null : body.notificationsEnabled ? 1 : 0,
      body.browserNotifications === undefined ? null : body.browserNotifications ? 1 : 0,
      body.showLastSeen === undefined ? null : body.showLastSeen ? 1 : 0,
      body.showOnlineStatus === undefined ? null : body.showOnlineStatus ? 1 : 0,
      nowIso(),
      principal.userId,
    );

    const settings = db.get<{
      notifications_enabled: number;
      browser_notifications: number;
      show_last_seen: number;
      show_online_status: number;
    }>('SELECT * FROM user_settings WHERE user_id = ?', principal.userId);

    clearUserCache();
    res.json({
      notificationsEnabled: settings?.notifications_enabled !== 0,
      browserNotifications: settings?.browser_notifications !== 0,
      showLastSeen: settings?.show_last_seen !== 0,
      showOnlineStatus: settings?.show_online_status !== 0,
    });
  }),
);

const profileSchema = z.object({
  name: z.string().trim().min(1, 'Tell us your name.').max(60).optional(),
  profileImage: z.string().trim().max(500).nullable().optional(),
});

authRouter.patch(
  '/profile',
  requireAuth,
  validate(profileSchema),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const body = req.body as z.infer<typeof profileSchema>;

    db.run(
      'UPDATE users SET name = ?, profile_image = ?, updated_at = ? WHERE id = ?',
      body.name ?? principal.name,
      body.profileImage === undefined ? null : body.profileImage || null,
      nowIso(),
      principal.userId,
    );
    clearUserCache();
    res.json(publicUserOf(principal.userId));
  }),
);
