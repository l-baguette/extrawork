import { readFileSync } from 'node:fs';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { AppError } from '@extrawork/contracts';
import { metrics, METRIC } from '@extrawork/observability';
import * as schema from './schema/index.js';

const { Pool, types } = pg;

/**
 * Database client and unit of work.
 *
 * Report §14.3 defines `UnitOfWork.transaction`, and §7.5 requires the domain
 * change, the audit events and the outbox rows to commit in one transaction.
 * §7.6 and §14.4 forbid calling an external provider while a transaction is
 * open — `TransactionContext` therefore carries an `afterCommit` queue so a
 * side effect can be registered inside the transaction but only run once it
 * has committed.
 */

// int8 arrives as a string by default; keep it that way and convert explicitly
// in the custom column type. Silently coercing to Number would lose precision
// on large paise amounts (report §8.1).
types.setTypeParser(types.builtins.INT8, (value) => value);
// numeric also stays a string so a quantity never becomes a float.
types.setTypeParser(types.builtins.NUMERIC, (value) => value);

export type Database = NodePgDatabase<typeof schema>;

export interface TransactionContext {
  db: Database;
  /**
   * Registers work to run after a successful commit. Used for provider calls
   * and cache invalidation. Never used for anything that must be durable —
   * durable side effects go through the outbox.
   */
  afterCommit(fn: () => void | Promise<void>): void;
}

export interface UnitOfWork {
  transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
  /** Read-only work that does not need a transaction. */
  readonly db: Database;
  close(): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; latencyMs: number }>;
}

export interface CreateDatabaseOptions {
  connectionString: string;
  max?: number;
  min?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
  ssl?: boolean;
  /**
   * Path to a CA certificate for providers whose chain Node does not trust by
   * default (Supabase signs with its own CA). Supplying it keeps certificate
   * verification ON; the usual shortcut, `rejectUnauthorized: false`, would
   * leave the connection encrypted but unauthenticated.
   */
  caCertPath?: string;
  applicationName?: string;
  statementTimeoutMs?: number;
}

function sslConfig(options: CreateDatabaseOptions): pg.PoolConfig['ssl'] {
  if (!options.ssl) return undefined;
  if (!options.caCertPath) return { rejectUnauthorized: true };

  const ca = readFileSync(options.caCertPath, 'utf8');
  return { rejectUnauthorized: true, ca };
}

export function createPool(options: CreateDatabaseOptions): pg.Pool {
  return new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    // `pg` otherwise drops every idle connection after ten seconds. Reopening
    // a TLS connection to a remote Supabase region costs seconds, so retain at
    // least one warm connection per process while still allowing excess
    // connections to age out.
    min: options.min ?? 3,
    idleTimeoutMillis: options.idleTimeoutMs ?? 300_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    ssl: sslConfig(options),
    application_name: options.applicationName ?? 'extrawork',
    // A runaway query must not hold a connection forever; the decision path is
    // short by design (report §7.8 "short database transactions").
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    idle_in_transaction_session_timeout: 30_000,
  });
}

export class PostgresUnitOfWork implements UnitOfWork {
  readonly db: Database;
  /**
   * Exposed for operational tooling that legitimately needs raw SQL outside the
   * repository layer: migrations, the seeder, integrity/repair commands and
   * test teardown. Application code uses `db` or `transaction` instead.
   */
  readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
    this.db = drizzle(pool, { schema });
  }

  /** Opens the configured minimum in parallel so the first user request is not the warm-up. */
  async warm(): Promise<void> {
    const target = Math.max(1, Math.min(this.pool.options.min ?? 1, this.pool.options.max ?? 10));
    const clients = await Promise.all(Array.from({ length: target }, () => this.pool.connect()));
    for (const client of clients) client.release();
  }

  async transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const afterCommitHooks: Array<() => void | Promise<void>> = [];

    const result = await this.db.transaction(async (txDb) => {
      const ctx: TransactionContext = {
        db: txDb as unknown as Database,
        afterCommit(hook) {
          afterCommitHooks.push(hook);
        },
      };
      return fn(ctx);
    });

    // Only after the commit has returned. A failure here is logged by the
    // caller but never rolls back the committed domain change — report §7.6:
    // "Approval confirmation notification failure never reverses the approval."
    for (const hook of afterCommitHooks) {
      await hook();
    }

    return result;
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    const started = Date.now();
    try {
      await this.db.execute(sql`SELECT 1`);
      metrics.gauge(
        METRIC.DB_POOL_IN_USE,
        'Database connections in use',
        this.pool.totalCount - this.pool.idleCount,
      );
      return { ok: true, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, latencyMs: Date.now() - started };
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createUnitOfWork(options: CreateDatabaseOptions): PostgresUnitOfWork {
  return new PostgresUnitOfWork(createPool(options));
}

// --- Error translation -----------------------------------------------------

interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
  message?: string;
}

/**
 * Maps PostgreSQL error codes onto stable application codes so a constraint
 * violation surfaces as a meaningful client error rather than a 500.
 */
export function translateDatabaseError(error: unknown): AppError | null {
  const pgError = error as PgError;
  if (!pgError?.code) return null;

  switch (pgError.code) {
    case '23505': {
      // unique_violation
      const constraint = pgError.constraint ?? '';
      if (constraint.includes('idempotency')) {
        return new AppError('IDEMPOTENCY_KEY_REUSED');
      }
      if (constraint.includes('decisions_version_id')) {
        return new AppError('ALREADY_DECIDED');
      }
      if (constraint.includes('number')) {
        return new AppError('DUPLICATE_NUMBER');
      }
      if (constraint.includes('versions_single_draft')) {
        return new AppError('INVALID_STATE_TRANSITION', {
          message: 'This change request already has an open draft.',
        });
      }
      return new AppError('LOCK_CONFLICT', {
        message: 'That record already exists.',
        details: { constraint },
      });
    }
    case '23503': // foreign_key_violation
      return new AppError('VALIDATION_FAILED', {
        message: 'A referenced record does not exist or cannot be removed.',
        details: { constraint: pgError.constraint },
      });
    case '23514': // check_violation
      return new AppError('VALIDATION_FAILED', {
        message: 'That value breaks a rule enforced by the database.',
        details: { constraint: pgError.constraint },
      });
    case '23001': // restrict_violation — our append-only triggers
      return new AppError('INVALID_STATE_TRANSITION', {
        message: pgError.message ?? 'This record is append-only and cannot be modified.',
      });
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return new AppError('LOCK_CONFLICT', {
        message: 'The record was being changed at the same time. Please try again.',
      });
    case '55P03': // lock_not_available
      return new AppError('LOCK_CONFLICT');
    case '57014': // query_canceled (statement timeout)
      return new AppError('SERVICE_UNAVAILABLE', {
        message: 'That request took too long and was stopped.',
      });
    case '53300': // too_many_connections
      return new AppError('SERVICE_UNAVAILABLE');
    default:
      return null;
  }
}

export { schema, sql };
