import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncRoute } from '../middleware/errors.js';
import { principalOf, requireAuth } from '../middleware/auth.js';
import {
  getFavorites,
  getHomeSummary,
  getTimeline,
  search,
} from '../services/aggregate.js';
import {
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from '../services/notifications.js';

export const appRouter = Router();

appRouter.use(requireAuth);

appRouter.get(
  '/home',
  asyncRoute(async (req, res) => {
    res.json(getHomeSummary(principalOf(req)));
  }),
);

appRouter.get(
  '/timeline',
  validate(
    z.object({
      months: z.coerce.number().int().min(1).max(24).default(6),
      limit: z.coerce.number().int().min(1).max(50).default(12),
    }),
    'query',
  ),
  asyncRoute(async (req, res) => {
    const query = req.query as unknown as { months: number; limit: number };
    res.json({ months: getTimeline(principalOf(req), query) });
  }),
);

appRouter.get(
  '/favorites',
  validate(
    z.object({ limit: z.coerce.number().int().min(1).max(200).default(60) }),
    'query',
  ),
  asyncRoute(async (req, res) => {
    const { limit } = req.query as unknown as { limit: number };
    res.json(getFavorites(principalOf(req), limit));
  }),
);

appRouter.get(
  '/search',
  validate(
    z.object({
      q: z.string().trim().max(120).default(''),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
    'query',
  ),
  asyncRoute(async (req, res) => {
    const { q, limit } = req.query as unknown as { q: string; limit: number };
    res.json(search(principalOf(req), q, limit));
  }),
);

appRouter.get(
  '/notifications',
  validate(
    z.object({ limit: z.coerce.number().int().min(1).max(100).default(40) }),
    'query',
  ),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const { limit } = req.query as unknown as { limit: number };
    res.json({ notifications: listNotifications(principal, limit), unread: unreadCount(principal) });
  }),
);

appRouter.post(
  '/notifications/read',
  validate(z.object({ ids: z.array(z.string().uuid()).max(100).optional() })),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const { ids } = req.body as { ids?: string[] };
    if (ids && ids.length > 0) markRead(principal, ids);
    else markAllRead(principal);
    res.json({ unread: 0 });
  }),
);
