#!/usr/bin/env tsx
/**
 * The documented repair command for a project projection — report §9.6 and §13.3.
 *
 * Report §9.6 requires a repair to:
 *   - record before/after digests,
 *   - emit an immutable repair event,
 *   - rebuild affected projections,
 *   - never rewrite the original canonical snapshot or decision.
 *
 * This command does exactly that and nothing more. It recomputes from the
 * approved versions, which are themselves append-only, so the repair can only
 * move the projection back into agreement with the evidence — never the other
 * way around.
 *
 *   pnpm --filter @extrawork/db exec tsx src/cli/repair-project-totals.ts \
 *     --project <projectId> --operator "ops@example.com" --reason "INC-123"
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { loadConfig } from '@extrawork/config';
import { formatCliError } from './describe-error.js';
import { createUnitOfWork } from '../client.js';
import { newId } from '../ids.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const projectId = arg('project');
const operator = arg('operator');
const reason = arg('reason');
const dryRun = process.argv.includes('--dry-run');

if (!projectId || !operator || !reason) {
  process.stderr.write(
    'usage: repair-project-totals.ts --project <uuid> --operator <email> --reason <text> [--dry-run]\n',
  );
  process.exit(1);
}

const config = loadConfig();
// Repairs run as the maintenance role: the runtime role is deliberately unable
// to write repair events or disable the append-only guard (report §9.6).
const uow = createUnitOfWork({
  connectionString: config.DATABASE_MAINTENANCE_URL ?? config.DATABASE_URL,
  ssl: config.DATABASE_SSL,
  applicationName: 'extrawork-repair',
  statementTimeoutMs: 120_000,
});

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

try {
  const result = await uow.transaction(async (tx) => {
    const before = await tx.db.execute<{
      id: string;
      organization_id: string;
      project_number: string;
      status: string;
      baseline_total_minor: string;
      approved_delta_minor: string;
      revised_total_minor: string;
      approved_schedule_delta_days: number;
    }>(sql`
      SELECT id, organization_id, project_number, status, baseline_total_minor,
             approved_delta_minor, revised_total_minor, approved_schedule_delta_days
        FROM projects WHERE id = ${projectId}::uuid
        FOR UPDATE
    `);
    const current = before.rows[0];
    if (!current) throw new Error(`Project ${projectId} not found`);

    const recomputedResult = await tx.db.execute<{
      approved_delta_minor: string;
      approved_schedule_delta_days: number;
    }>(sql`SELECT * FROM project_recomputed_totals(${projectId}::uuid)`);
    const recomputed = recomputedResult.rows[0];
    if (!recomputed) throw new Error('Recomputation returned no rows');

    const drift = BigInt(recomputed.approved_delta_minor) - BigInt(current.approved_delta_minor);

    if (dryRun) {
      return { current, recomputed, drift, applied: false };
    }

    await tx.db.execute(sql`
      UPDATE projects
         SET approved_delta_minor = ${recomputed.approved_delta_minor}::bigint,
             revised_total_minor = baseline_total_minor + ${recomputed.approved_delta_minor}::bigint,
             approved_schedule_delta_days = ${recomputed.approved_schedule_delta_days},
             -- Only clear the review flag; never move a project out of CLOSED.
             status = CASE WHEN status = 'INTEGRITY_REVIEW'
                           THEN 'ACTIVE'::project_status ELSE status END,
             lock_version = lock_version + 1
       WHERE id = ${projectId}::uuid
    `);

    // The repair event is immutable evidence that this happened, who did it and
    // what changed. It is written in the same transaction as the change.
    await tx.db.execute(sql`
      INSERT INTO repair_events
        (id, organization_id, actor, reason, details, before_digest, after_digest)
      VALUES (
        ${newId()}::uuid, ${current.organization_id}::uuid, ${operator}, ${reason},
        ${JSON.stringify({
          command: 'repair-project-totals',
          projectId,
          projectNumber: current.project_number,
          storedApprovedDeltaMinor: current.approved_delta_minor,
          recomputedApprovedDeltaMinor: recomputed.approved_delta_minor,
          driftMinor: drift.toString(),
        })}::jsonb,
        ${digest(current)}, ${digest(recomputed)}
      )
    `);

    return { current, recomputed, drift, applied: true };
  });

  process.stdout.write(
    `${dryRun ? '[dry run] ' : ''}project ${result.current.project_number}\n` +
      `  stored     ${result.current.approved_delta_minor}\n` +
      `  recomputed ${result.recomputed.approved_delta_minor}\n` +
      `  drift      ${result.drift.toString()}\n` +
      `  ${result.applied ? 'repaired and recorded in repair_events' : 'no changes written'}\n`,
  );

  if (result.applied) {
    process.stdout.write('\nNow run: pnpm db:verify-chain --org <organizationId>\n');
  }
} catch (error) {
  process.stderr.write(formatCliError('Repair failed', error, config.DATABASE_URL));
  process.exitCode = 1;
} finally {
  await uow.close();
}
