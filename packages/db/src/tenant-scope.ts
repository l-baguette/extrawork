import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/**
 * The tenant a database connection is currently acting for, carried to the
 * driver so PostgreSQL row-level security can enforce what the repositories
 * already promise.
 *
 * Why ambient rather than another argument: `TenantContext` is already passed
 * explicitly to every repository method, and that stays — it is what builds the
 * `WHERE organization_id = ...` clauses. RLS needs the same value one layer
 * lower, at the moment a statement is sent, and threading it through 78
 * `transaction()` calls and 52 direct reads would give 130 chances to miss one.
 * A missed one fails closed (the query returns nothing), so the cost of a miss
 * is a broken feature rather than a leak — but a broken feature found in
 * production is still worse than this.
 *
 * The two are belt and braces, not duplicates: the WHERE clause is the app's
 * intent, the policy is the database refusing to be talked out of it.
 */

export type TenantScope = { kind: 'tenant'; organizationId: string } | { kind: 'system' };

/** Matches the sentinel in the `tenant_isolation` policies (migration 0019). */
const SYSTEM_SENTINEL = '*';
const GUC = 'extrawork.organization_id';

/**
 * A mutable box rather than the scope itself, because a request does not know
 * its tenant when it starts. Resolving the session reads `sessions`,
 * `memberships` and `organizations` — none of them tenant-scoped, precisely so
 * that this bootstrap is possible — and only then is the organization known.
 * The box is created at the edge and filled in by `requireAuth`.
 */
interface ScopeBox {
  current: TenantScope | undefined;
}

const storage = new AsyncLocalStorage<ScopeBox>();

/**
 * Fallback for processes that are system-level in their entirety: the worker,
 * the migrator and the operator CLIs. They sweep every tenant by definition —
 * the job queue and outbox are not per-tenant queues — so requiring each of
 * their many entry points to declare a scope would be ceremony that one missed
 * loop turns into a silently idle worker.
 *
 * Deliberately NOT set by the API. There, an absent scope means a request that
 * has not authenticated yet, and the right answer is to see nothing.
 */
let processDefault: TenantScope | undefined;

export function setProcessDefaultScope(scope: TenantScope): void {
  processDefault = scope;
}

export function tenantScope(organizationId: string): TenantScope {
  return { kind: 'tenant', organizationId };
}

/**
 * Work that legitimately spans tenants: the outbox pump, the job runner, the
 * retention and integrity sweeps, migrations and operator CLIs.
 *
 * Deliberately noisy to write. Every use is a place where tenant isolation is
 * not being enforced by the database, so each one should be a considered
 * decision that a reviewer can grep for.
 */
export const SYSTEM_SCOPE: TenantScope = { kind: 'system' };

export function runInScope<T>(scope: TenantScope, fn: () => Promise<T>): Promise<T> {
  return storage.run({ current: scope }, fn);
}

/**
 * Opens a scope that is not known yet. Everything inside sees no tenant — and
 * therefore no tenant rows — until `setScope` is called.
 */
export function runUnscoped<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ current: undefined }, fn);
}

/**
 * The same, for a framework hook that hands control on through a callback.
 *
 * Fastify continues the request synchronously from `done()`, so calling it
 * inside `storage.run` puts the whole rest of the request — every hook, the
 * handler, and everything they await — inside this scope.
 */
export function runUnscopedSync<T>(fn: () => T): T {
  return storage.run({ current: undefined }, fn);
}

/**
 * Declares the tenant for the rest of the current scope.
 *
 * Silently does nothing outside a scope, rather than throwing: the alternative
 * is a crash in a background path that merely needed no tenant, and the
 * fail-closed policy already makes an unscoped query harmless.
 */
export function setScope(scope: TenantScope): void {
  const box = storage.getStore();
  if (box) box.current = scope;
}

export function currentScope(): TenantScope | undefined {
  const box = storage.getStore();
  if (box) return box.current ?? processDefault;
  return processDefault;
}

function scopeValue(scope: TenantScope | undefined): string {
  if (!scope) return '';
  return scope.kind === 'system' ? SYSTEM_SENTINEL : scope.organizationId;
}

/**
 * Applies the current scope to this connection for the rest of the transaction.
 *
 * `set_config(..., true)` is transaction-local, so it cannot leak onto the next
 * borrower of a pooled connection. With no scope set it writes an empty string,
 * which matches no row and no sentinel — unscoped access sees nothing rather
 * than everything.
 */
export async function applyScope(db: Database, scope = currentScope()): Promise<void> {
  await db.execute(sql`SELECT set_config(${GUC}, ${scopeValue(scope)}, true)`);
}
