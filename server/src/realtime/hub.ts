import type { Server } from 'socket.io';

/** Client <-> server event names, kept in one place so both sides agree. */
export const RealtimeEvents = {
  MESSAGE_CREATED: 'message:created',
  MESSAGE_UPDATED: 'message:updated',
  MESSAGE_DELETED: 'message:deleted',
  MESSAGE_READ: 'message:read',
  REACTION_ADDED: 'reaction:added',
  REACTION_REMOVED: 'reaction:removed',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  PRESENCE_UPDATE: 'presence:update',
  NOTIFICATION_CREATED: 'notification:created',
  MEMORY_CREATED: 'memory:created',
  MEMORY_UPDATED: 'memory:updated',
  MEMORY_DELETED: 'memory:deleted',
  COLLECTION_UPDATED: 'collection:updated',
} as const;

type EventPayloads = {
  [RealtimeEvents.MESSAGE_CREATED]: { messageId: string };
  [RealtimeEvents.MESSAGE_UPDATED]: { messageId: string };
  [RealtimeEvents.MESSAGE_DELETED]: { messageId: string };
  [RealtimeEvents.MESSAGE_READ]: { messageIds: string[]; byUserId: string };
  [RealtimeEvents.REACTION_ADDED]: { messageId: string; emoji: string; userId: string };
  [RealtimeEvents.REACTION_REMOVED]: { messageId: string; emoji: string; userId: string };
  [RealtimeEvents.TYPING_START]: { userId: string; name: string };
  [RealtimeEvents.TYPING_STOP]: { userId: string };
  [RealtimeEvents.PRESENCE_UPDATE]: { userId: string; isOnline: boolean; lastSeenAt: string | null };
  [RealtimeEvents.NOTIFICATION_CREATED]: { notificationId: string };
  [RealtimeEvents.MEMORY_CREATED]: { kind: 'diary' | 'photo'; id: string; byUserId: string };
  [RealtimeEvents.MEMORY_UPDATED]: { kind: 'diary' | 'photo'; id: string; byUserId: string };
  [RealtimeEvents.MEMORY_DELETED]: { kind: 'diary' | 'photo'; id: string; byUserId: string };
  [RealtimeEvents.COLLECTION_UPDATED]: { collectionId: string; byUserId: string };
};

/**
 * Thin wrapper around Socket.IO so services can emit without importing the
 * server instance (which would create an import cycle). Before the HTTP server
 * boots, emits are dropped rather than crashing.
 */
class RealtimeHub {
  private io: Server | null = null;

  attach(io: Server): void {
    this.io = io;
  }

  isReady(): boolean {
    return this.io !== null;
  }

  emitToUser<E extends keyof EventPayloads>(userId: string, event: E, payload: EventPayloads[E]): void {
    this.io?.to(`user:${userId}`).emit(event, payload);
  }

  emitToSpace<E extends keyof EventPayloads>(spaceId: string, event: E, payload: EventPayloads[E]): void {
    this.io?.to(`space:${spaceId}`).emit(event, payload);
  }

  /** Send to the partner of `userId` inside the space. */
  emitToPartner<E extends keyof EventPayloads>(spaceId: string, userId: string, event: E, payload: EventPayloads[E]): void {
    this.io?.to(`space:${spaceId}`).except(`user:${userId}`).emit(event, payload);
  }
}

export const hub = new RealtimeHub();
export type { EventPayloads };
