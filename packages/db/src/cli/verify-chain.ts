#!/usr/bin/env tsx
/**
 * Audit-chain verification — report §8.5, §11.6 and §13.5.
 *
 * Recomputes every aggregate's hash chain and reports the first break.
 * Run it:
 *  - after a database restore, before reopening writes (report §11.6);
 *  - as the nightly integrity job (report §13.5 alerts on invalid chains);
 *  - on demand during a dispute, to show the history has not been rewritten.
 *
 *   pnpm db:verify-chain                # every organization
 *   pnpm db:verify-chain --org <uuid>   # one tenant
 */
import { loadConfig } from '@extrawork/config';
import { formatCliError } from './describe-error.js';
import { createUnitOfWork } from '../client.js';
import { listAggregatesForOrganization, verifyAggregateChain } from '../repositories/audit.js';
import { systemTenantContext } from '@extrawork/domain';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const config = loadConfig();
const uow = createUnitOfWork({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_SSL,
  applicationName: 'extrawork-verify-chain',
  statementTimeoutMs: 600_000,
});
const { db, pool } = uow;

const organizationFilter = arg('org') ?? null;
const asJson = process.argv.includes('--json');

interface Failure {
  organizationId: string;
  aggregateType: string;
  aggregateId: string;
  failedAtSequence: number | null;
  reason: string | null;
}

try {
  const { rows: organizations } = await pool.query<{ id: string; display_name: string }>(
    organizationFilter
      ? 'SELECT id, display_name FROM organizations WHERE id = $1'
      : 'SELECT id, display_name FROM organizations ORDER BY created_at',
    organizationFilter ? [organizationFilter] : [],
  );

  const failures: Failure[] = [];
  let checked = 0;

  for (const organization of organizations) {
    const aggregates = await listAggregatesForOrganization(db, organization.id);
    for (const aggregate of aggregates) {
      checked += 1;
      const result = await verifyAggregateChain(
        db,
        systemTenantContext(organization.id, 'cli-verify-chain'),
        aggregate.aggregateType,
        aggregate.aggregateId,
      );
      if (!result.valid) {
        failures.push({
          organizationId: organization.id,
          aggregateType: aggregate.aggregateType,
          aggregateId: aggregate.aggregateId,
          failedAtSequence: result.failedAtSequence,
          reason: result.reason,
        });
      }
    }
  }

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ organizations: organizations.length, aggregates: checked, failures }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(
      `Verified ${checked} aggregate chain(s) across ${organizations.length} organization(s).\n`,
    );
    for (const failure of failures) {
      process.stdout.write(
        `  BROKEN ${failure.aggregateType}:${failure.aggregateId} ` +
          `at sequence ${failure.failedAtSequence ?? '?'} — ${failure.reason ?? 'unknown'}\n`,
      );
    }
    process.stdout.write(
      failures.length === 0
        ? 'All chains verified.\n'
        : `${failures.length} chain(s) FAILED verification.\n`,
    );
  }

  // Non-zero exit so CI and the nightly job can alert (report §13.5).
  if (failures.length > 0) process.exitCode = 2;
} catch (error) {
  process.stderr.write(
    formatCliError('Chain verification failed to run', error, config.DATABASE_URL),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
