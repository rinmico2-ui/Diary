import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { notFound } from './errors.js';

export type StorageBucket = keyof typeof config.storagePaths;

/**
 * Object storage boundary.
 *
 * Image binaries never go into the database — only their URLs do. The local
 * disk implementation below is swappable for S3/R2 without touching routes:
 * everything goes through `put`, `getStream`, `remove` and `publicUrl`.
 */
export interface ObjectStore {
  put(bucket: StorageBucket, key: string, data: Buffer): Promise<{ url: string; sizeBytes: number }>;
  getStream(bucket: StorageBucket, key: string): NodeJS.ReadableStream;
  remove(bucket: StorageBucket, key: string): Promise<void>;
  publicUrl(bucket: StorageBucket, key: string): string;
  /** Maps a stored public URL back to its bucket + key. */
  resolve(url: string): { bucket: StorageBucket; key: string } | null;
}

const BUCKET_PREFIX: Record<StorageBucket, string> = {
  photos: 'photos',
  thumbnails: 'thumbnails',
  audio: 'audio',
  avatars: 'avatars',
};

class LocalDiskStore implements ObjectStore {
  private ensureBucket(bucket: StorageBucket): string {
    const dir = config.storagePaths[bucket];
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async put(bucket: StorageBucket, key: string, data: Buffer) {
    const dir = this.ensureBucket(bucket);
    const target = path.join(dir, key);
    // Guard against path traversal in the generated key.
    if (!path.resolve(target).startsWith(path.resolve(dir))) {
      throw new Error('Refusing to write outside the storage directory.');
    }
    // Keys are namespaced (e.g. "photo/2026-09-27/<hex>.webp"), so the parent
    // directories have to be created too.
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
    return { url: this.publicUrl(bucket, key), sizeBytes: data.byteLength };
  }

  getStream(bucket: StorageBucket, key: string): NodeJS.ReadableStream {
    const dir = config.storagePaths[bucket];
    const file = path.join(dir, key);
    if (!path.resolve(file).startsWith(path.resolve(dir))) {
      throw notFound('That file is no longer available.');
    }
    if (!fs.existsSync(file)) throw notFound('That file is no longer available.');
    return fs.createReadStream(file);
  }

  async remove(bucket: StorageBucket, key: string): Promise<void> {
    const dir = config.storagePaths[bucket];
    const file = path.join(dir, key);
    if (!path.resolve(file).startsWith(path.resolve(dir))) return;
    await fsp.rm(file, { force: true });
  }

  publicUrl(bucket: StorageBucket, key: string): string {
    return `/media/${BUCKET_PREFIX[bucket]}/${key}`;
  }

  resolve(url: string): { bucket: StorageBucket; key: string } | null {
    const match = /^\/media\/([a-z]+)\/(.+)$/.exec(url);
    if (!match) return null;
    const bucket = match[1] as StorageBucket;
    if (!(bucket in BUCKET_PREFIX)) return null;
    const key = match[2]!;
    if (key.includes('..')) return null;
    return { bucket, key };
  }
}

export const storage: ObjectStore = new LocalDiskStore();

/** Collision-resistant, non-guessable object key that leaks no user input. */
export function objectKey(prefix: string, extension: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${prefix}/${stamp}/${crypto.randomBytes(16).toString('hex')}.${extension}`;
}
