import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { newId } from '../lib/ids.js';
import { badRequest } from '../lib/errors.js';
import { processPhotoUpload, processVoiceUpload, deleteStoredFile } from '../lib/image.js';
import { asyncRoute } from '../middleware/errors.js';
import { principalOf, requireAuth } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { requireMembership } from '../services/space.js';
import { db } from '../db/index.js';
import { serializeAttachment } from '../services/serialize.js';
import type { AttachmentRow } from '../types.js';

export const uploadRouter = Router();

/**
 * Uploads are buffered in memory with a hard cap, then validated by decoding
 * the bytes. Nothing reaches disk until the file has been proven to be a real
 * image or an allowed audio container.
 */
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadBytes,
    files: config.maxFilesPerUpload,
    fields: 10,
  },
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxAudioUploadBytes, files: 1, fields: 6 },
});

uploadRouter.post(
  '/photos',
  requireAuth,
  uploadLimiter,
  photoUpload.array('photos', config.maxFilesPerUpload),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    requireMembership(principal.userId, principal.spaceId);

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw badRequest('Choose at least one photo.');

    // Progress metadata the client uses to render per-file upload bars.
    const uploadId = newId();
    const created: Array<{ attachment: ReturnType<typeof serializeAttachment>; uploadId: string }> = [];
    const failed: Array<{ name: string; reason: string }> = [];

    for (const file of files) {
      try {
        const processed = await processPhotoUpload(file.buffer, file.mimetype);
        const id = newId();
        db.run(
          `INSERT INTO attachments (id, space_id, owner_id, kind, url, thumbnail_url, mime_type, size_bytes, width, height)
           VALUES (?, ?, ?, 'IMAGE', ?, ?, ?, ?, ?, ?)`,
          id,
          principal.spaceId,
          principal.userId,
          processed.url,
          processed.thumbnailUrl,
          processed.mimeType,
          processed.sizeBytes,
          processed.width,
          processed.height,
        );
        const row = db.get<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', id)!;
        created.push({ attachment: serializeAttachment(row), uploadId });
      } catch (error) {
        failed.push({
          name: file.originalname,
          reason: error instanceof Error ? error.message : 'That photo could not be read.',
        });
      }
    }

    if (created.length === 0) {
      throw badRequest(failed[0]?.reason ?? 'None of those photos could be uploaded.');
    }

    res.status(201).json({ uploads: created, failed });
  }),
);

const voiceMetaSchema = z.object({
  durationSeconds: z.coerce.number().min(0).max(600).optional(),
});

uploadRouter.post(
  '/voice',
  requireAuth,
  uploadLimiter,
  audioUpload.single('audio'),
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    requireMembership(principal.userId, principal.spaceId);

    const file = req.file as Express.Multer.File | undefined;
    if (!file) throw badRequest('No recording came through.');

    const parsed = voiceMetaSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('That recording looks incomplete.');

    const processed = await processVoiceUpload(
      file.buffer,
      file.mimetype,
      parsed.data.durationSeconds,
    );

    const id = newId();
    db.run(
      `INSERT INTO attachments (id, space_id, owner_id, kind, url, mime_type, size_bytes, duration_seconds)
       VALUES (?, ?, ?, 'VOICE', ?, ?, ?, ?)`,
      id,
      principal.spaceId,
      principal.userId,
      processed.url,
      processed.mimeType,
      processed.sizeBytes,
      processed.durationSeconds,
    );

    const row = db.get<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', id)!;
    res.status(201).json({ attachment: serializeAttachment(row) });
  }),
);

/** Removes an uploaded file that was never attached to a message or photo. */
uploadRouter.delete(
  '/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);
    const attachment = db.get<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', req.params.id!);
    if (!attachment || attachment.space_id !== principal.spaceId) {
      throw badRequest('That upload is not available.');
    }
    if (attachment.owner_id !== principal.userId) {
      throw badRequest('Only the person who uploaded this can remove it.');
    }

    const inUse =
      db.count('SELECT COUNT(*) AS value FROM messages WHERE attachment_id = ?', attachment.id) +
      db.count('SELECT COUNT(*) AS value FROM photos WHERE image_url = ?', attachment.url);

    if (inUse > 0) {
      db.run('DELETE FROM attachments WHERE id = ?', attachment.id);
      res.status(204).end();
      return;
    }

    db.run('DELETE FROM attachments WHERE id = ?', attachment.id);
    deleteStoredFile(attachment.url);
    deleteStoredFile(attachment.thumbnail_url);
    res.status(204).end();
  }),
);
