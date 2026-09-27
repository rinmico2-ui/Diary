import { DatabaseSync, type StatementSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

/**
 * Single persistent SQLite connection.
 *
 * This is a real on-disk relational database (WAL journal, foreign keys on,
 * prepared statements) — the app never falls back to in-memory or localStorage.
 * All access flows through named queries so the whole data layer stays in one place.
 */
class Database {
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();

  constructor(file: string) {
    this.db = new DatabaseSync(file, {
      enableForeignKeyConstraints: true,
    });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  migrate(): void {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    this.db.exec(sql);
  }

  /** Prepared statements are cached, so repeated calls are cheap. */
  private prepare(sql: string): StatementSync {
    let stmt = this.statements.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  run(sql: string, ...params: SqlParam[]): { changes: number } {
    const result = this.prepare(sql).run(...params);
    return { changes: Number(result.changes) };
  }

  get<T = SqlRow>(sql: string, ...params: SqlParam[]): T | undefined {
    const row = this.prepare(sql).get(...params);
    return row === undefined ? undefined : ({ ...(row as object) } as T);
  }

  all<T = SqlRow>(sql: string, ...params: SqlParam[]): T[] {
    return this.prepare(sql)
      .all(...params)
      .map((row) => ({ ...(row as object) }) as T);
  }

  /** Scalar helper for `SELECT COUNT(*)` style queries. */
  count(sql: string, ...params: SqlParam[]): number {
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

  close(): void {
    this.statements.clear();
    this.db.close();
  }
}

export type SqlParam = string | number | bigint | null | Uint8Array;
export type SqlRow = Record<string, unknown>;

export const db = new Database(config.databasePath);
