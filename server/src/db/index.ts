import Database from 'libsql';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

function isRemoteUrl(value: string): boolean {
  return /^(libsql:|https?:|wss?:)/i.test(value);
}

class Db {
  private readonly db: InstanceType<typeof Database>;
  private readonly statements = new Map<string, ReturnType<InstanceType<typeof Database>['prepare']>>();
  private readonly remote: boolean;

  constructor() {
    const remoteUrl = config.databaseUrl;
    const syncUrl = config.databaseSyncUrl;
    const authToken = config.databaseAuthToken;

    if (remoteUrl && isRemoteUrl(remoteUrl)) {
      this.remote = true;
      this.db = new Database(remoteUrl, { authToken } as any);
    } else if (syncUrl) {
      this.remote = false;
      this.db = new Database(remoteUrl || config.databasePath, {
        syncUrl,
        authToken,
      } as any);
    } else {
      this.remote = false;
      this.db = new Database(config.databasePath);
    }

    if (!this.remote) {
      try { this.db.exec('PRAGMA journal_mode = WAL;'); } catch { /* remote/managed db may reject */ }
      try { this.db.exec('PRAGMA synchronous = FULL;'); } catch { /* remote/managed db may reject */ }
    }
    try { this.db.exec('PRAGMA foreign_keys = ON;'); } catch { /* best effort */ }
    try { this.db.exec('PRAGMA busy_timeout = 5000;'); } catch { /* best effort */ }
  }

  migrate(): void {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    this.db.exec(sql);
  }

  private prepare(sql: string): any {
    let stmt = this.statements.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  private strip(row: unknown): unknown {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      const { _metadata, ...rest } = row as Record<string, unknown>;
      return rest;
    }
    return row;
  }

  run(sql: string, ...params: any[]): { changes: number } {
    const result = this.prepare(sql).run(...params);
    return { changes: Number(result.changes) };
  }

  get<T = Record<string, unknown>>(sql: string, ...params: any[]): T | undefined {
    const row = this.prepare(sql).get(...params);
    if (row === undefined || row === null) return undefined;
    return this.strip(row) as T;
  }

  all<T = Record<string, unknown>>(sql: string, ...params: any[]): T[] {
    return this.prepare(sql)
      .all(...params)
      .map((row: any) => this.strip(row) as T);
  }

  count(sql: string, ...params: unknown[]): number {
    const row = this.get<{ value: number }>(sql, ...params);
    return row ? Number(row.value) : 0;
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* rollback failure must not mask the original error */
      }
      throw error;
    }
  }

  checkpoint(): void {
    if (this.remote) return;
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      /* best effort */
    }
  }

  sync(): void {
    if (typeof this.db.sync === 'function') {
      try {
        this.db.sync();
      } catch {
        /* best effort */
      }
    }
  }

  close(): void {
    try {
      this.checkpoint();
    } catch {
      /* best effort */
    }
    try {
      this.sync();
    } catch {
      /* best effort */
    }
    this.statements.clear();
    this.db.close();
  }
}

// Preserve exported type alias names used elsewhere.
export type SqlParam = string | number | bigint | null | Uint8Array;
export type SqlRow = Record<string, unknown>;

export const db = new Db();

// Back-compat: expose migrate on instance (already). 
// Some code may call db.migrate(); ok.
