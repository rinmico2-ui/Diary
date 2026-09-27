import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncRoute } from '../middleware/errors.js';
import { principalOf, requireAuth } from '../middleware/auth.js';
import {
  addPhotoTag,
  createPhoto,
  deletePhoto,
  getPhotoOrThrow,
  listPhotos,
  movePhotosToCollection,
  removePhotoTag,
  sharePhotoToPartner,
  togglePhotoFavorite,
  updatePhoto,
} from '../services/photos.js';
import { serializePhotos } from '../services/serialize.js';

export const photosRouter = Router();

photosRouter.use(requireAuth);

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(60),
  offset: z.coerce.number().int().min(0).default(0),
  collectionId: z.string().uuid().optional(),
  diaryEntryId: z.string().uuid().optional(),
  tag: z.string().trim().max(40).optional(),
  favoritesOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().trim().max(120).optional(),
  ownerId: z.string().uuid().optional(),
});

photosRouter.get(
  '/',
  validate(listSchema, 'query'),
  asyncRoute(async (req, res) => {
    res.json(listPhotos(principalOf(req), req.query as unknown as z.infer<typeof listSchema>));
  }),
);

const createSchema = z.object({
  url: z.string().min(1).max(500),
  thumbnailUrl: z.string().max(500).nullable(),
  width: z.number().int().min(1).max(40_000),
  height: z.number().int().min(1).max(40_000),
  sizeBytes: z.number().int().min(1).max(100_000_000),
  mimeType: z.string().max(80),
  caption: z.string().max(300).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  photoDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.string().datetime())
    .optional(),
  collectionId: z.string().uuid().nullable().optional(),
  diaryEntryId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
});

photosRouter.post(
  '/',
  validate(createSchema),
  asyncRoute(async (req, res) => {
    res.status(201).json({ photo: createPhoto(principalOf(req), req.body as z.infer<typeof createSchema>) });
  }),
);

/** Batched create, so a multi-photo upload is one request instead of twenty. */
const bulkCreateSchema = z.object({
  photos: z.array(createSchema).min(1).max(50),
  collectionId: z.string().uuid().nullable().optional(),
  diaryEntryId: z.string().uuid().nullable().optional(),
  photoDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.string().datetime())
    .optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
});

photosRouter.post(
  '/bulk',
  validate(bulkCreateSchema),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const body = req.body as z.infer<typeof bulkCreateSchema>;

    const created = body.photos.map((photo) =>
      createPhoto(principal, {
        ...photo,
        collectionId: photo.collectionId ?? body.collectionId ?? null,
        diaryEntryId: photo.diaryEntryId ?? body.diaryEntryId ?? null,
        photoDate: photo.photoDate ?? body.photoDate,
        tags: photo.tags ?? body.tags,
      }),
    );

    res.status(201).json({ photos: created });
  }),
);

photosRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const photo = getPhotoOrThrow(principal, req.params.id!);
    res.json({ photo: serializePhotos([photo], principal)[0] });
  }),
);

const updateSchema = z.object({
  caption: z.string().max(300).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  photoDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.string().datetime())
    .optional(),
  collectionId: z.string().uuid().nullable().optional(),
  diaryEntryId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
});

photosRouter.patch(
  '/:id',
  validate(updateSchema),
  asyncRoute(async (req, res) => {
    res.json({ photo: updatePhoto(principalOf(req), req.params.id!, req.body as z.infer<typeof updateSchema>) });
  }),
);

photosRouter.patch(
  '/:id/favorite',
  validate(z.object({ favorite: z.boolean() })),
  asyncRoute(async (req, res) => {
    const { favorite } = req.body as { favorite: boolean };
    res.json({ photo: togglePhotoFavorite(principalOf(req), req.params.id!, favorite) });
  }),
);

photosRouter.post(
  '/:id/tags',
  validate(z.object({ tag: z.string().trim().min(1).max(40) })),
  asyncRoute(async (req, res) => {
    const { tag } = req.body as { tag: string };
    res.json({ photo: addPhotoTag(principalOf(req), req.params.id!, tag) });
  }),
);

photosRouter.delete(
  '/:id/tags/:tag',
  asyncRoute(async (req, res) => {
    res.json({ photo: removePhotoTag(principalOf(req), req.params.id!, req.params.tag!) });
  }),
);

/** Sends the photo into the private conversation as a memory card. */
photosRouter.post(
  '/:id/share',
  asyncRoute(async (req, res) => {
    const photo = sharePhotoToPartner(principalOf(req), req.params.id!);
    res.json({ photo, shared: true });
  }),
);

const moveSchema = z.object({
  photoIds: z.array(z.string().uuid()).min(1).max(200),
  collectionId: z.string().uuid().nullable(),
});

photosRouter.post(
  '/move',
  validate(moveSchema),
  asyncRoute(async (req, res) => {
    const { photoIds, collectionId } = req.body as z.infer<typeof moveSchema>;
    res.json({ moved: movePhotosToCollection(principalOf(req), photoIds, collectionId) });
  }),
);

photosRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    deletePhoto(principalOf(req), req.params.id!);
    res.status(204).end();
  }),
);
