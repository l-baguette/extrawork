import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

/**
 * Plain SQL migration runner.
 *
 * Report §9.1 asks for Drizzle "while retaining explicit SQL for locking,
 * aggregates, and constraints", and §11.4 requires expand-and-contract
 * migrations. Hand-written, ordered SQL files are the clearest way to satisfy
 * both: each file is reviewable, checksummed, and applied exactly once inside
 * its own transaction.
 */

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

export interface MigrationFile {
  version: string;
  filename: string;
  sql: string;
  checksum: string;
}

export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const files: MigrationFile[] = [];
  for (const filename of entries) {
    const sqlText = await readFile(path.join(dir, filename), 'utf8');
    files.push({
      version: filename.replace(/\.sql$/, ''),
      filename,
      sql: sqlText,
      checksum: createHash('sha256').update(sqlText).digest('hex'),
    });
  }
  return files;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export interface MigrateOptions {
  dir?: string;
  /** Throws when a previously applied file has been edited. */
  verifyChecksums?: boolean;
  log?: (message: string) => void;
}

export async function runMigrations(
  pool: pg.Pool,
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const log = options.log ?? (() => undefined);
  const migrations = await loadMigrations(options.dir);
  const applied: string[] = [];
  const skipped: string[] = [];

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const existing = new Map(rows.map((r) => [r.version, r.checksum]));

    for (const migration of migrations) {
      const previousChecksum = existing.get(migration.version);
      if (previousChecksum) {
        if (options.verifyChecksums !== false && previousChecksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.filename} was modified after it was applied. ` +
              `Create a new migration instead of editing an applied one.`,
          );
        }
        skipped.push(migration.version);
        continue;
      }

      log(`applying ${migration.filename}`);
      // Each migration is one transaction: a partial schema change is never
      // left behind (report §13.6 "recover from failed migration").
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
          migration.version,
          migration.checksum,
        ]);
        await client.query('COMMIT');
        applied.push(migration.version);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.filename} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }
  } finally {
    client.release();
  }

  return { applied, skipped };
}

/** Drops and recreates the public schema. Local and test only. */
export async function resetDatabase(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    client.release();
  }
}
