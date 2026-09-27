import path from 'node:path';
import sharp from 'sharp';
import { badRequest, tooLarge } from './errors.js';
import { config } from '../config.js';
import { objectKey, storage } from './storage.js';

const FULL_MAX_EDGE = 2048;
const THUMB_MAX_EDGE = 640;

/** Formats we accept, keyed by the canonical output extension. */
const ALLOWED = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff', 'svg']);

/**
 * The declared Content-Type from a browser cannot be trusted, so the real
 * format is sniffed by decoding the bytes. HEIC/HEIF are decoded but converted
 * to JPEG so the browser can actually display them.
 */
export async function sniffImageFormat(buffer: Buffer): Promise<{ format: string; width: number; height: number } | null> {
  try {
    const meta = await sharp(buffer, { limitInputPixels: 268_402_689 }).metadata();
    if (!meta.format || !ALLOWED.has(meta.format)) return null;
    return {
      format: meta.format,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    };
  } catch {
    return null;
  }
}

export interface ProcessedImage {
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
}

/**
 * Validates, auto-rotates from EXIF, downsizes and re-encodes an upload.
 * Produces a full-size WebP plus a lightweight thumbnail for the grid.
 */
export async function processPhotoUpload(buffer: Buffer, _declaredMime: string): Promise<ProcessedImage> {
  if (buffer.byteLength > config.maxUploadBytes) {
    throw tooLarge('That photo is too large to upload.');
  }

  const sniffed = await sniffImageFormat(buffer);
  if (!sniffed) {
    throw badRequest('That file does not look like a photo we can use.');
  }
  if (sniffed.width === 0 || sniffed.height === 0) {
    throw badRequest('That photo appears to be empty.');
  }

  // SVG is vector: re-encoding to raster would be lossy, so store as-is and skip thumbnails.
  if (sniffed.format === 'svg') {
    const key = objectKey('photo', 'svg');
    const stored = await storage.put('photos', key, buffer);
    return {
      url: stored.url,
      thumbnailUrl: stored.url,
      width: sniffed.width,
      height: sniffed.height,
      sizeBytes: stored.sizeBytes,
      mimeType: 'image/svg+xml',
    };
  }

  const pipeline = sharp(buffer, { limitInputPixels: 268_402_689 }).rotate();

  const full = await pipeline
    .clone()
    .resize({ width: FULL_MAX_EDGE, height: FULL_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  const thumb = await pipeline
    .clone()
    .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: 'cover', position: 'attention' })
    .webp({ quality: 76, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  const fullKey = objectKey('photo', 'webp');
  const thumbKey = objectKey('thumb', 'webp');

  const fullStored = await storage.put('photos', fullKey, full.data);
  await storage.put('thumbnails', thumbKey, thumb.data);

  return {
    url: fullStored.url,
    thumbnailUrl: storage.publicUrl('thumbnails', thumbKey),
    width: full.info.width,
    height: full.info.height,
    sizeBytes: fullStored.sizeBytes,
    mimeType: 'image/webp',
  };
}

const AUDIO_MIME_ALLOWLIST = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
  'audio/x-m4a',
]);

const AUDIO_EXTENSION: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-m4a': 'm4a',
};

export async function processVoiceUpload(
  buffer: Buffer,
  declaredMime: string,
  durationSeconds?: number,
): Promise<{ url: string; sizeBytes: number; mimeType: string; durationSeconds: number | null }> {
  if (buffer.byteLength > config.maxAudioUploadBytes) {
    throw tooLarge('That voice note is too long.');
  }
  if (buffer.byteLength === 0) {
    throw badRequest('That recording came through empty.');
  }

  const mimeType = (declaredMime || '').split(';')[0]!.trim().toLowerCase();
  const extension = AUDIO_EXTENSION[mimeType];
  if (!extension || !AUDIO_MIME_ALLOWLIST.has(mimeType)) {
    throw badRequest('That audio format is not supported.');
  }

  const key = objectKey('voice', extension);
  const stored = await storage.put('audio', key, buffer);

  return {
    url: stored.url,
    sizeBytes: stored.sizeBytes,
    mimeType,
    durationSeconds: durationSeconds && durationSeconds > 0 ? Math.min(durationSeconds, 600) : null,
  };
}

export function deleteStoredFile(url: string | null | undefined): void {
  if (!url) return;
  const resolved = storage.resolve(url);
  if (!resolved) return;
  void storage.remove(resolved.bucket, resolved.key);
}

export const imagePathFor = (fileName: string) => path.basename(fileName);
