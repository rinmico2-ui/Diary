import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncRoute } from '../middleware/errors.js';
import { principalOf, requireAuth } from '../middleware/auth.js';
import { badRequest } from '../lib/errors.js';
import { hub } from '../realtime/hub.js';
import {
  createMessage,
  deleteMessage,
  editMessage,
  getMessage,
  hydrate,
  listMessages,
  markMessagesRead,
  toggleReaction,
  unreadMessageSummary,
} from '../services/messages.js';
import { toggleMessageFavorite } from '../services/aggregate.js';
import { db } from '../db/index.js';
import type { MessageRow } from '../types.js';

export const messagesRouter = Router();

messagesRouter.use(requireAuth);

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(60),
  before: z.string().datetime().optional(),
  search: z.string().trim().min(1).max(120).optional(),
  favoritesOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

messagesRouter.get(
  '/',
  validate(listSchema, 'query'),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const query = req.query as unknown as z.infer<typeof listSchema>;
    res.json({ messages: listMessages(principal, query) });
  }),
);

messagesRouter.get(
  '/summary',
  asyncRoute(async (req, res) => {
    res.json(unreadMessageSummary(principalOf(req)));
  }),
);

const createSchema = z.object({
  type: z.enum(['TEXT', 'IMAGE', 'VOICE', 'MEMORY', 'DIARY']),
  content: z.string().max(4000).optional().nullable(),
  replyToMessageId: z.string().uuid().optional().nullable(),
  attachmentId: z.string().uuid().optional().nullable(),
  sharedPhotoId: z.string().uuid().optional().nullable(),
  sharedDiaryEntryId: z.string().uuid().optional().nullable(),
  sharedCollectionId: z.string().uuid().optional().nullable(),
});

messagesRouter.post(
  '/',
  validate(createSchema),
  asyncRoute(async (req, res) => {
    const message = createMessage(principalOf(req), req.body as z.infer<typeof createSchema>);
    res.status(201).json({ message });
  }),
);

messagesRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    getMessage(principal, req.params.id!);
    const row = db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', req.params.id!);
    res.json({ message: hydrate([row!], principal)[0] });
  }),
);

const editSchema = z.object({ content: z.string().trim().min(1, 'A message cannot be empty.').max(4000) });

messagesRouter.patch(
  '/:id',
  validate(editSchema),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    editMessage(principal, req.params.id!, (req.body as z.infer<typeof editSchema>).content);
    const row = db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', req.params.id!)!;
    res.json({ message: hydrate([row], principal)[0] });
  }),
);

messagesRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    deleteMessage(principal, req.params.id!);
    res.status(204).end();
  }),
);

const reactionSchema = z.object({ emoji: z.string().trim().min(1).max(8) });

messagesRouter.post(
  '/:id/reactions',
  validate(reactionSchema),
  asyncRoute(async (req, res) => {
    const result = toggleReaction(principalOf(req), req.params.id!, (req.body as z.infer<typeof reactionSchema>).emoji);
    res.json(result);
  }),
);

const favoriteSchema = z.object({ favorite: z.boolean() });

messagesRouter.patch(
  '/:id/favorite',
  validate(favoriteSchema),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const { favorite } = req.body as z.infer<typeof favoriteSchema>;
    toggleMessageFavorite(principal, req.params.id!, favorite);
    res.json({ favorite });
  }),
);

const readSchema = z.object({
  messageIds: z.array(z.string().uuid()).min(1).max(200),
});

messagesRouter.post(
  '/read',
  validate(readSchema),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const { messageIds } = req.body as z.infer<typeof readSchema>;
    const read = markMessagesRead(principal, messageIds);
    if (read.length === 0) throw badRequest('Nothing new to mark as read.');
    res.json({ read: read.length });
  }),
);

/** Typing indicator relay for clients that prefer REST over the socket. */
messagesRouter.post(
  '/typing',
  validate(z.object({ isTyping: z.boolean() })),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const { isTyping } = req.body as { isTyping: boolean };
    if (isTyping) {
      hub.emitToPartner(principal.spaceId, principal.userId, 'typing:start', {
        userId: principal.userId,
        name: principal.name,
      });
    } else {
      hub.emitToPartner(principal.spaceId, principal.userId, 'typing:stop', { userId: principal.userId });
    }
    res.status(204).end();
  }),
);
