import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncRoute } from '../middleware/errors.js';
import { principalOf, requireAuth } from '../middleware/auth.js';
import {
  createCollection,
  deleteCollection,
  getCollectionDetail,
  listCollections,
  removeMemoryFromCollection,
  updateCollection,
} from '../services/collections.js';

export const collectionsRouter = Router();

collectionsRouter.use(requireAuth);

collectionsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json({ collections: listCollections(principalOf(req)) });
  }),
);

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give your collection a name.').max(60),
  description: z.string().trim().max(400).nullable().optional(),
  coverPhotoId: z.string().uuid().nullable().optional(),
});

collectionsRouter.post(
  '/',
  validate(createSchema),
  asyncRoute(async (req, res) => {
    res.status(201).json({ collection: createCollection(principalOf(req), req.body as z.infer<typeof createSchema>) });
  }),
);

collectionsRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    res.json(getCollectionDetail(principalOf(req), req.params.id!));
  }),
);

const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(400).nullable().optional(),
  coverPhotoId: z.string().uuid().nullable().optional(),
});

collectionsRouter.patch(
  '/:id',
  validate(updateSchema),
  asyncRoute(async (req, res) => {
    res.json({
      collection: updateCollection(principalOf(req), req.params.id!, req.body as z.infer<typeof updateSchema>),
    });
  }),
);

/**
 * Deleting a collection detaches its memories rather than destroying them, so
 * the response reports exactly how many memories were kept safe.
 */
collectionsRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const result = deleteCollection(principalOf(req), req.params.id!);
    res.json({
      deleted: true,
      keptPhotos: result.detachedPhotos,
      keptDiaryEntries: result.detachedDiary,
    });
  }),
);

const detachSchema = z.object({
  kind: z.enum(['photo', 'diary']),
  memoryId: z.string().uuid(),
});

collectionsRouter.post(
  '/:id/detach',
  validate(detachSchema),
  asyncRoute(async (req, res) => {
    const { kind, memoryId } = req.body as z.infer<typeof detachSchema>;
    removeMemoryFromCollection(principalOf(req), req.params.id!, kind, memoryId);
    res.status(204).end();
  }),
);
