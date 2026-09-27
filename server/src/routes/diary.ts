import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncRoute } from '../middleware/errors.js';
import { principalOf, requireAuth } from '../middleware/auth.js';
import {
  createDiaryEntry,
  deleteDiaryEntry,
  getDiaryEntryOrThrow,
  listDiaryEntries,
  toggleDiaryFavorite,
  updateDiaryEntry,
} from '../services/diary.js';
import { serializeDiaryEntry } from '../services/serialize.js';
import { notify } from '../services/notifications.js';
import { partnerIdOf } from '../services/diary.js';
import { listSpaceTags } from '../services/tags.js';

export const diaryRouter = Router();

diaryRouter.use(requireAuth);

const MOODS = ['HAPPY', 'LOVED', 'PEACEFUL', 'EMOTIONAL', 'FUNNY', 'SAD', 'EXCITED'] as const;

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
  collectionId: z.string().uuid().optional(),
  mood: z.enum(MOODS).optional(),
  tag: z.string().trim().max(40).optional(),
  favoritesOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().trim().max(120).optional(),
  authorId: z.string().uuid().optional(),
});

diaryRouter.get(
  '/',
  validate(listSchema, 'query'),
  asyncRoute(async (req, res) => {
    res.json(listDiaryEntries(principalOf(req), req.query as unknown as z.infer<typeof listSchema>));
  }),
);

diaryRouter.get(
  '/tags',
  asyncRoute(async (req, res) => {
    res.json({ tags: listSpaceTags(principalOf(req).spaceId) });
  }),
);

const contentSchema = z
  .string()
  .max(60_000)
  // Only a conservative subset of formatting is accepted from the rich text editor.
  .refine(
    (value) => !/<\s*script|<\s*iframe|<\s*object|<\s*embed|javascript:|on[a-z]+\s*=/i.test(value),
    'That formatting is not allowed.',
  );

const createSchema = z.object({
  title: z.string().trim().min(1, 'Give your entry a title.').max(140),
  content: contentSchema.optional(),
  mood: z.enum(MOODS).nullable().optional(),
  visibility: z.enum(['PRIVATE', 'SHARED']).default('SHARED'),
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
    .or(z.string().datetime())
    .optional(),
  collectionId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  photoIds: z.array(z.string().uuid()).max(50).optional(),
});

diaryRouter.post(
  '/',
  validate(createSchema),
  asyncRoute(async (req, res) => {
    res.status(201).json({ entry: createDiaryEntry(principalOf(req), req.body as z.infer<typeof createSchema>) });
  }),
);

diaryRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const entry = getDiaryEntryOrThrow(principal, req.params.id!);
    res.json({ entry: serializeDiaryEntry(entry, principal, { withPhotos: true }) });
  }),
);

const updateSchema = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  content: contentSchema.optional(),
  mood: z.enum(MOODS).nullable().optional(),
  visibility: z.enum(['PRIVATE', 'SHARED']).optional(),
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.string().datetime())
    .optional(),
  collectionId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
});

diaryRouter.patch(
  '/:id',
  validate(updateSchema),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const before = getDiaryEntryOrThrow(principal, req.params.id!);
    const entry = updateDiaryEntry(principal, req.params.id!, req.body as z.infer<typeof updateSchema>);

    // Only tell the other person when an entry is *newly* shared, so ordinary
    // edits to an already-shared entry stay quiet.
    if (before.visibility === 'PRIVATE' && entry.visibility === 'SHARED') {
      const partnerId = partnerIdOf(principal);
      if (partnerId) notify({ principal, type: 'DIARY_SHARED', targetUserId: partnerId, diaryEntryId: entry.id });
    }

    res.json({ entry });
  }),
);

diaryRouter.patch(
  '/:id/favorite',
  validate(z.object({ favorite: z.boolean() })),
  asyncRoute(async (req, res) => {
    const { favorite } = req.body as { favorite: boolean };
    res.json({ entry: toggleDiaryFavorite(principalOf(req), req.params.id!, favorite) });
  }),
);

diaryRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    deleteDiaryEntry(principalOf(req), req.params.id!);
    res.status(204).end();
  }),
);
