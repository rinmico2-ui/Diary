import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { config } from '../config.js';
import { SESSION_COOKIE, resolveSession } from '../lib/session.js';
import { getPrincipalForUser } from '../services/space.js';
import { clearUserCache } from '../services/serialize.js';
import { db } from '../db/index.js';
import { nowIso } from '../lib/time.js';
import { hub, RealtimeEvents } from './hub.js';
import type { Principal } from '../types.js';

type AppSocket = Socket<Record<string, never>, Record<string, never>, Record<string, never>, SocketData>;

interface SocketData {
  principal: Principal;
  userId: string;
  spaceId: string;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}

function markOnline(userId: string): void {
  const stamp = nowIso();
  db.run('UPDATE users SET is_online = 1, last_seen_at = ?, updated_at = ? WHERE id = ?', stamp, stamp, userId);
  clearUserCache();
}

function markOffline(userId: string): void {
  const stamp = nowIso();
  db.run('UPDATE users SET is_online = 0, last_seen_at = ?, updated_at = ? WHERE id = ?', stamp, stamp, userId);
  clearUserCache();
}

export function createRealtimeServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: config.corsOrigins, credentials: true },
    // Long-poll fallback keeps things working if a proxy blocks websockets.
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e6,
  });

  // Handshake authentication: same session cookie as the REST API, so a socket
  // can never be opened by someone who could not call the API anyway.
  io.use((socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const resolved = resolveSession(cookies[SESSION_COOKIE]);
      if (!resolved) return next(new Error('unauthorized'));

      const principal = getPrincipalForUser(resolved.user.id);
      if (!principal) return next(new Error('forbidden'));

      const data: SocketData = { principal, userId: principal.userId, spaceId: principal.spaceId };
      socket.data = data;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const typed = socket as AppSocket;
    const { principal, userId, spaceId } = typed.data;

    void typed.join(`user:${userId}`);
    void typed.join(`space:${spaceId}`);
    markOnline(userId);

    hub.emitToPartner(spaceId, userId, RealtimeEvents.PRESENCE_UPDATE, {
      userId,
      isOnline: true,
      lastSeenAt: nowIso(),
    });

    typed.on('typing:start', (payload: unknown) => {
      const isTyping = (payload as { isTyping?: boolean } | undefined)?.isTyping;
      if (isTyping === false) {
        hub.emitToPartner(spaceId, userId, RealtimeEvents.TYPING_STOP, { userId });
        return;
      }
      hub.emitToPartner(spaceId, userId, RealtimeEvents.TYPING_START, { userId, name: principal.name });
    });

    typed.on('typing:stop', () => {
      hub.emitToPartner(spaceId, userId, RealtimeEvents.TYPING_STOP, { userId });
    });

    typed.on('disconnect', () => {
      // Only go offline when the person has no other tabs or devices open.
      const remaining = io.of('/').adapter.rooms.get(`user:${userId}`)?.size ?? 0;
      if (remaining === 0) {
        markOffline(userId);
        hub.emitToPartner(spaceId, userId, RealtimeEvents.PRESENCE_UPDATE, {
          userId,
          isOnline: false,
          lastSeenAt: nowIso(),
        });
      }
    });
  });

  hub.attach(io);
  return io;
}
