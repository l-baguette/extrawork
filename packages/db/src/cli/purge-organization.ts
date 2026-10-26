#!/usr/bin/env tsx
/**
 * Destroys a closed organization after its recovery window — report §9.8, and
 * §4 of the `data-subject-request` runbook.
 *
 * This is the only command in the product that deletes evidence, so it is the
 * most heavily guarded. It refuses unless the account is CLOSED, the 30-day
 * window has actually elapsed, no legal hold covers it, and the operator has
 * typed the organization id back. `--dry-run` reports exactly what would go.
 *
 * The append-only triggers on `audit_events`, `decisions` and
 * `change_order_versions` are disabled for the duration of the transaction and
 * restored inside it. That is the documented escape hatch from migration 0014
 * ("a database superuser can always disable triggers explicitly for disaster
 * recovery"), and it is why this needs the maintenance role rather than the
 * runtime one — the runtime role cannot do this even by accident.
 *
 * A row in `purged_organizations` survives as proof the deletion happened.
 *
 *   pnpm --filter @extrawork/db exec tsx src/cli/purge-organization.ts \
 *     --organization <uuid> --operator "ops@example.com" --reason "DSR-123" \
 *     --confirm <uuid> [--dry-run]
 */
import { sql } from 'drizzle-orm';
import { loadConfig } from '@extrawork/config';
import { formatCliError } from './describe-error.js';
import { createUnitOfWork } from '../client.js';
import { SYSTEM_SCOPE, setProcessDefaultScope } from '../tenant-scope.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const organizationId = arg('organization');
const operator = arg('operator');
const reason = arg('reason');
const confirm = arg('confirm');
const dryRun = process.argv.includes('--dry-run');

if (!organizationId || !operator || !reason) {
  process.stderr.write(
    'usage: purge-organization.ts --organization <uuid> --operator <email> --reason <ref> \\\n' +
      '         --confirm <same uuid> [--dry-run]\n',
  );
  process.exit(1);
}
if (!dryRun && confirm !== organizationId) {
  process.stderr.write(
    'Refusing to purge: pass --confirm with the same organization id to acknowledge that\n' +
      'this permanently destroys the account and every record in it.\n',
  );
  process.exit(1);
}

// Operator tooling acts across tenants by definition.
setProcessDefaultScope(SYSTEM_SCOPE);

const config = loadConfig();
const uow = createUnitOfWork({
  connectionString: config.DATABASE_MAINTENANCE_URL ?? config.DATABASE_URL,
  ssl: config.DATABASE_SSL,
  applicationName: 'extrawork-purge-organization',
  statementTimeoutMs: 300_000,
});

/**
 * Children first, then parents. Everything not listed here reaches the same end
 * through `ON DELETE CASCADE` when the organization row goes; these are the
 * tables whose foreign keys are NO ACTION or RESTRICT and would otherwise abort
 * the delete, plus the append-only ones that need their trigger lifted.
 */
const DELETE_ORDER = [
  'version_attachments',
  'line_items',
  'decisions',
  'approval_tokens',
  'otp_challenges',
  'messages',
  'generated_documents',
  'reminder_schedules',
  'change_order_versions',
  'change_orders',
  'baseline_versions',
  'inbound_message_media',
  'inbound_messages',
  'employee_project_assignments',
  'project_members',
  'projects',
  'contacts',
  'customers',
  'audit_events',
] as const;

/**
 * Tables whose guard triggers are lifted for this transaction.
 *
 * `DISABLE TRIGGER USER` rather than a list of trigger names, because the guards
 * are not only the DELETE ones. Deleting a project cascades `SET NULL` onto
 * `audit_events.project_id`, which the append-only *UPDATE* guard then refuses —
 * an error about §9.6 raised in the middle of a court-ordered deletion. Naming
 * triggers individually meant discovering that one failure at a time, and would
 * break again the day a seventh guard is added.
 *
 * `organizations` is included because the final DELETE cascades widely.
 */
const GUARDED_TABLES = [...new Set([...DELETE_ORDER, 'organizations'])];

try {
  const summary = await uow.transaction(async (tx) => {
    const found = await tx.db.execute<{
      id: string;
      display_name: string;
      status: string;
      // The raw driver hands timestamps back as strings on this path, so they
      // are coerced below rather than trusted to be Dates.
      closed_at: string | null;
      purge_after: string | null;
      closure_reason: string | null;
    }>(sql`
      SELECT id, display_name, status, closed_at, purge_after, closure_reason
        FROM organizations WHERE id = ${organizationId}::uuid
        FOR UPDATE
    `);
    const organization = found.rows[0];
    if (!organization) throw new Error(`Organization ${organizationId} not found`);

    if (organization.status !== 'CLOSED') {
      throw new Error(
        `Organization is ${organization.status}, not CLOSED. Only a closed account can be purged; ` +
          'the owner closes it from Settings, or an operator sets the status deliberately.',
      );
    }
    if (!organization.purge_after) {
      throw new Error('Organization is CLOSED but has no purge_after date');
    }
    const purgeAfter = new Date(organization.purge_after);
    const closedAt = organization.closed_at ? new Date(organization.closed_at) : null;
    if (purgeAfter.getTime() > Date.now()) {
      throw new Error(
        `Recovery window has not elapsed. Purge is permitted from ${purgeAfter.toISOString()}; ` +
          'the account is still recoverable by its owner until then.',
      );
    }

    const holds = await tx.db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM legal_holds
       WHERE organization_id = ${organizationId}::uuid AND released_at IS NULL
    `);
    if (Number(holds.rows[0]?.count ?? '0') > 0) {
      throw new Error(
        'An unreleased legal hold covers this organization. Retention jobs skip held data by ' +
          'design and so does this command; release the hold deliberately first.',
      );
    }

    // Counted before anything is destroyed, so the tombstone can say how much
    // went and a dry run can show the same numbers.
    const counts: Record<string, number> = {};
    for (const table of DELETE_ORDER) {
      const result = await tx.db.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM ${sql.identifier(table)}
             WHERE organization_id = ${organizationId}::uuid`,
      );
      counts[table] = Number(result.rows[0]?.count ?? '0');
    }

    if (dryRun) return { organization, counts, closedAt, purgeAfter, applied: false };

    for (const table of GUARDED_TABLES) {
      await tx.db.execute(sql`ALTER TABLE ${sql.identifier(table)} DISABLE TRIGGER USER`);
    }

    for (const table of DELETE_ORDER) {
      await tx.db.execute(
        sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id = ${organizationId}::uuid`,
      );
    }
    // Everything still referencing the organization goes with this row.
    await tx.db.execute(sql`DELETE FROM organizations WHERE id = ${organizationId}::uuid`);

    // The cascading deletes queue deferred constraint events, and PostgreSQL
    // refuses to ALTER a table that still has them pending. Forcing the checks
    // to run now empties that queue — and does it while we can still fail
    // cleanly, rather than at COMMIT when there is no transaction left to roll
    // back into.
    await tx.db.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);

    // Restored on the success path only. There is no `finally` here on purpose:
    // ALTER TABLE is transactional in PostgreSQL, so an abort rolls the guards
    // back on by itself, and a `finally` that runs against an already-aborted
    // transaction throws over the real error and hides it.
    for (const table of GUARDED_TABLES) {
      await tx.db.execute(sql`ALTER TABLE ${sql.identifier(table)} ENABLE TRIGGER USER`);
    }

    await tx.db.execute(sql`
      INSERT INTO purged_organizations (
        organization_id, display_name, closed_at, purge_after, closure_reason,
        operator, reason, deleted_counts
      ) VALUES (
        ${organizationId}::uuid, ${organization.display_name},
        ${closedAt?.toISOString() ?? null}::timestamptz,
        ${purgeAfter.toISOString()}::timestamptz, ${organization.closure_reason},
        ${operator}, ${reason}, ${JSON.stringify(counts)}::jsonb
      )
    `);

    return { organization, counts, closedAt, purgeAfter, applied: true };
  });

  const total = Object.values(summary.counts).reduce((sum, n) => sum + n, 0);
  const lines = Object.entries(summary.counts)
    .filter(([, n]) => n > 0)
    .map(([table, n]) => `      ${table.padEnd(30)} ${n}`);

  process.stdout.write(
    [
      '',
      dryRun ? '  DRY RUN — nothing was deleted' : '  Organization purged',
      '',
      `    organization: ${summary.organization.display_name} (${organizationId})`,
      `    closed:       ${summary.closedAt?.toISOString() ?? '—'}`,
      `    purgeable:    ${summary.purgeAfter.toISOString()}`,
      `    operator:     ${operator}`,
      `    reason:       ${reason}`,
      '',
      `    Rows ${dryRun ? 'that would be destroyed' : 'destroyed'} (${total} total):`,
      ...(lines.length > 0 ? lines : ['      (none)']),
      '',
      dryRun
        ? '    Re-run with --confirm <organization id> to carry it out.'
        : '    A record of this purge remains in `purged_organizations`.',
      '',
    ].join('\n'),
  );
} catch (error) {
  process.stderr.write(`${formatCliError('Purge failed', error, config.DATABASE_URL)}\n`);
  process.exitCode = 1;
} finally {
  await uow.pool.end();
}
