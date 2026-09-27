import { Router } from 'express';
import { config } from '../config.js';
import { storage } from '../lib/storage.js';
import { asyncRoute } from '../middleware/errors.js';
import { principalOf, requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { notFound } from '../lib/errors.js';

export const mediaRouter = Router();

/**
 * Media is never world-readable.
 *
 * Every request must present a valid session, the URL must resolve to a real
 * object inside the storage root, and the object must be referenced by a
 * resource the caller is allowed to see. Guessing a URL is not enough: a
 * stranger gets 401, and a signed-in person gets 404 for anything that is not
 * theirs.
 */
const VALID_BUCKETS = ['photos', 'thumbnails', 'audio', 'avatars'] as const;
type Bucket = (typeof VALID_BUCKETS)[number];

function isBucket(value: string): value is Bucket {
  return (VALID_BUCKETS as readonly string[]).includes(value);
}

mediaRouter.get(
  '/:bucket/:key(*)',
  requireAuth,
  asyncRoute(async (req, res) => {
    const principal = principalOf(req);

    if (!isBucket(req.params.bucket!)) throw notFound();
    const bucket: Bucket = req.params.bucket;
    const key = req.params.key!;

    if (key.includes('..') || key.includes('\0')) throw notFound();

    const referenced = db.get<{ id: string }>(
      `SELECT id FROM attachments
       WHERE space_id = ? AND (url = ? OR thumbnail_url = ?)
       LIMIT 1`,
      principal.spaceId,
      `/media/${bucket}/${key}`,
      `/media/${bucket}/${key}`,
    );

    const referencedByPhoto = db.get<{ id: string }>(
      'SELECT id FROM photos WHERE space_id = ? AND (image_url = ? OR thumbnail_url = ?) LIMIT 1',
      principal.spaceId,
      `/media/${bucket}/${key}`,
      `/media/${bucket}/${key}`,
    );

    const referencedByUser = db.get<{ id: string }>(
      'SELECT id FROM users WHERE id = ? AND profile_image = ? LIMIT 1',
      principal.userId,
      `/media/${bucket}/${key}`,
    );

    if (!referenced && !referencedByPhoto && !referencedByUser) {
      throw notFound('That file is not available.');
    }

    const stream = storage.getStream(bucket, key);

    res.setHeader('Content-Type', contentTypeFor(key));
    res.setHeader('Cache-Control', config.isProduction ? 'private, max-age=31536000, immutable' : 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
  }),
);

function contentTypeFor(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'webp':
      return 'image/webp';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'avif':
      return 'image/avif';
    case 'svg':
      return 'image/svg+xml';
    case 'webm':
      return 'audio/webm';
    case 'ogg':
      return 'audio/ogg';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    case 'aac':
      return 'audio/aac';
    case 'wav':
      return 'audio/wav';
    default:
      return 'application/octet-stream';
  }
}
