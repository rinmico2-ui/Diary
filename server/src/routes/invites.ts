import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncRoute } from '../middleware/errors.js';
import { principalOf, requireAuth } from '../middleware/auth.js';
import { createInviteCode, listInviteCodes, revokeInviteCode, seatsLeft } from '../services/invites.js';

export const invitesRouter = Router();

invitesRouter.use(requireAuth);

invitesRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    res.json({
      invites: listInviteCodes(principal),
      seatsLeft: seatsLeft(principal.spaceId),
      canCreate: principal.role === 'owner' && seatsLeft(principal.spaceId) > 0,
    });
  }),
);

const createSchema = z.object({
  expiresInHours: z.number().int().min(1).max(24 * 30).optional(),
});

invitesRouter.post(
  '/',
  validate(createSchema),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const { expiresInHours } = req.body as z.infer<typeof createSchema>;
    const created = createInviteCode(principal, { expiresInHours });
    // The only time the full code is ever returned — it is stored hashed.
    res.status(201).json({ code: created.code, invite: created.invite });
  }),
);

invitesRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    revokeInviteCode(principalOf(req), req.params.id!);
    res.status(204).end();
  }),
);
