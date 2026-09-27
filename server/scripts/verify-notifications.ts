/**
 * End-to-end check of the notification path a browser would exercise: two
 * sockets in the real space, a real message, the real events, then cleanup.
 *
 * It mints temporary session tokens for the two existing members, so nothing
 * about the accounts changes — only one message and one notification row are
 * created, and both are deleted at the end.
 *
 * npx tsx scripts/verify-notifications.ts
 */
import { io, type Socket } from 'socket.io-client';
import { db } from '../src/db/index.js';
import { createSession, destroySession, SESSION_COOKIE } from '../src/lib/session.js';

const API = 'http://localhost:4000/api';
const ORIGIN = 'http://localhost:5173';

interface Assertion {
  label: string;
  pass: boolean;
  detail?: string;
}
const results: Assertion[] = [];
function check(label: string, pass: boolean, detail?: string): void {
  results.push({ label, pass, detail });
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
}

function waitFor(socket: Socket, event: string, ms = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event, (payload: Record<string, unknown>) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function socketFor(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io('http://localhost:4000', {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
      extraHeaders: { Cookie: `${SESSION_COOKIE}=${token}`, Origin: ORIGIN },
    });
    const timer = setTimeout(() => reject(new Error('socket connect timed out')), 6000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function call(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${SESSION_COOKIE}=${token}`,
      Origin: ORIGIN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

let cleanupMessageId: string | null = null;
let cleanupNotificationId: string | null = null;
const minted: string[] = [];

async function main(): Promise<void> {
  const members = db.all<{ id: string; name: string; email: string }>(
    `SELECT u.id, u.name, u.email FROM users u
     JOIN space_members m ON m.user_id = u.id
     ORDER BY u.created_at ASC`,
  );
  if (members.length !== 2) throw new Error(`expected 2 members, found ${members.length}`);

  const [a, b] = members as [any, any];
  console.log(`testing ${a.name} -> ${b.name}\n`);

  const sessionA = createSession({ userId: a.id });
  const sessionB = createSession({ userId: b.id });
  minted.push(sessionA.token, sessionB.token);

  const aSocket = await socketFor(sessionA.token);
  const bSocket = await socketFor(sessionB.token);
  check('both sockets connected', aSocket.connected && bSocket.connected);

  // The space already holds real data, so count what's there first rather than
  // assuming a pristine inbox.
  const inboxABefore = (await call(sessionA.token, 'GET', '/notifications?limit=100')).json?.notifications?.length ?? -1;
  const inboxBBefore = (await call(sessionB.token, 'GET', '/notifications?limit=100')).json?.notifications?.length ?? -1;
  check('baselines captured', inboxABefore >= 0 && inboxBBefore >= 0, `A=${inboxABefore} B=${inboxBBefore}`);

  try {
    const aSawCreated = waitFor(aSocket, 'message:created');
    const bSawCreated = waitFor(bSocket, 'message:created');
    const bSawNotification = waitFor(bSocket, 'notification:created');

    const send = await call(sessionA.token, 'POST', '/messages', {
      type: 'TEXT',
      content: 'quietly checking the doorbell',
    });
    check('POST /messages accepted', send.status === 201, `HTTP ${send.status}`);
    cleanupMessageId = send.json?.message?.id ?? null;
    check('response carries the message id', Boolean(cleanupMessageId));

    const aCreated = await aSawCreated.catch((error: Error) => ({ __error: error.message }));
    check("sender gets their own message:created", !('__error' in aCreated), String((aCreated as any).__error ?? ''));

    const bCreated = await bSawCreated.catch((error: Error) => ({ __error: error.message }));
    check('partner gets message:created', !('__error' in bCreated), String((bCreated as any).__error ?? ''));
    check('message:created carries the id', (bCreated as any).messageId === cleanupMessageId, JSON.stringify(bCreated));

    const notified = await bSawNotification.catch((error: Error) => ({ __error: error.message }));
    check('partner gets notification:created', !('__error' in notified), String((notified as any).__error ?? ''));
    cleanupNotificationId = (notified as any).notificationId ?? null;

    const inboxA = await call(sessionA.token, 'GET', '/notifications?limit=100');
    const afterA = inboxA.json?.notifications ?? [];
    check(
      "sender's inbox did not grow (never notifies the actor)",
      afterA.length === inboxABefore,
      `was ${inboxABefore}, now ${afterA.length}`,
    );

    const inboxB = await call(sessionB.token, 'GET', '/notifications?limit=100');
    const items = inboxB.json?.notifications ?? [];
    check(
      "partner's inbox grew by exactly one",
      items.length === inboxBBefore + 1,
      `was ${inboxBBefore}, now ${items.length}`,
    );
    check('newest notification is the one just created', items[0]?.id === cleanupNotificationId, String(items[0]?.id));
    check('notification is unread', items[0]?.isRead === false);
    check('notification has a title', Boolean(items[0]?.title), items[0]?.title);
    check('notification has a message preview', Boolean(items[0]?.preview), String(items[0]?.preview));
    check('notification targets the message', items[0]?.target?.kind === 'message');
    check('notification target id matches', items[0]?.target?.id === cleanupMessageId, String(items[0]?.target?.id));

    const summaryA = await call(sessionA.token, 'GET', '/messages/summary');
    check(
      'summary shape is flat {unreadCount,lastMessage}',
      typeof summaryA.json?.unreadCount === 'number',
      JSON.stringify(summaryA.json),
    );

    const before = await call(sessionB.token, 'GET', '/messages/summary');
    check('partner sees 1 unread message', before.json?.unreadCount === 1, `got ${before.json?.unreadCount}`);

    // --- reading clears the badge, and both sides are told ---------------------
    const aSawRead = waitFor(aSocket, 'message:read');
    const bSawRead = waitFor(bSocket, 'message:read');

    const read = await call(sessionB.token, 'POST', '/messages/read', { messageIds: [cleanupMessageId] });
    check('POST /messages/read ok', read.status === 200, `HTTP ${read.status}`);

    const selfRead = await bSawRead.catch((error: Error) => ({ __error: error.message }));
    check('reader is told about the read (badge clears)', !('__error' in selfRead), String((selfRead as any).__error ?? ''));

    const partnerRead = await aSawRead.catch((error: Error) => ({ __error: error.message }));
    check('sender is told the message was read', !('__error' in partnerRead), String((partnerRead as any).__error ?? ''));

    const after = await call(sessionB.token, 'GET', '/messages/summary');
    check('partner unread count is now 0', after.json?.unreadCount === 0, `got ${after.json?.unreadCount}`);

    const mark = await call(sessionB.token, 'POST', '/notifications/read', {});
    check('POST /notifications/read ok', mark.status === 200, `HTTP ${mark.status}`);
    const reloaded = await call(sessionB.token, 'GET', '/notifications?limit=5');
    check('notification is now read', (reloaded.json?.notifications ?? [])[0]?.isRead === true);
  } finally {
    aSocket.close();
    bSocket.close();
    cleanup();
  }

  const failed = results.filter((result) => !result.pass);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) process.exitCode = 1;
}

let cleaned = false;
/** Remove every trace of the test message and notification, and the temp tokens. */
function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  db.transaction(() => {
    if (cleanupMessageId) {
      db.run('DELETE FROM message_reads WHERE message_id = ?', cleanupMessageId);
      db.run('DELETE FROM message_reactions WHERE message_id = ?', cleanupMessageId);
      db.run('DELETE FROM notifications WHERE message_id = ?', cleanupMessageId);
      db.run('DELETE FROM messages WHERE id = ?', cleanupMessageId);
    }
    if (cleanupNotificationId) {
      db.run('DELETE FROM notifications WHERE id = ?', cleanupNotificationId);
    }
  });
  for (const token of minted) destroySession(token);

  console.log(
    `\n  cleaned up: messages=${db.count('SELECT COUNT(*) AS value FROM messages')} ` +
      `notifications=${db.count('SELECT COUNT(*) AS value FROM notifications')} ` +
      `members=${db.count('SELECT COUNT(*) AS value FROM space_members')}`,
  );
  db.close();
}

main().catch((error: unknown) => {
  cleanup();
  console.error('\nverify-notifications failed:', error);
  process.exitCode = 1;
});
