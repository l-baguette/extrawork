#!/usr/bin/env tsx
/**
 * Replay a dead-lettered outbox event or job — report §13.4: "Replay: operator
 * may replay one event or bounded batch through an audited command."
 *
 * Bounded on purpose. There is no "replay everything": a blanket replay after
 * an incident is how a customer receives forty duplicate reminders.
 *
 *   tsx src/cli/replay.ts outbox <eventId>
 *   tsx src/cli/replay.ts job <jobId>
 *   tsx src/cli/replay.ts outbox --topic message.send_requested.v1 --limit 25
 *   tsx src/cli/replay.ts job --kind generate_evidence --limit 10
 *   tsx src/cli/replay.ts list
 */
import { sql } from 'drizzle-orm';
import { loadConfig } from '@extrawork/config';
import { formatCliError } from './describe-error.js';
import { createUnitOfWork } from '../client.js';
import { replayJob } from '../jobs.js';
import { replayOutboxEvent } from '../outbox.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const [kind, maybeId] = process.argv.slice(2);
const limit = Math.min(Number.parseInt(arg('limit') ?? '10', 10), 100);
const topic = arg('topic');
const jobKind = arg('kind');

const config = loadConfig();
const uow = createUnitOfWork({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_SSL,
  applicationName: 'extrawork-replay',
});

try {
  if (kind === 'list') {
    const outbox = await uow.db.execute<{
      id: string;
      topic: string;
      attempt_count: number;
      last_error_code: string | null;
    }>(sql`
      SELECT id, topic, attempt_count, last_error_code
        FROM outbox_events WHERE dead_lettered_at IS NOT NULL
       ORDER BY created_at DESC LIMIT 50
    `);
    const jobs = await uow.db.execute<{
      id: string;
      kind: string;
      attempt_count: number;
      last_error: string | null;
    }>(sql`
      SELECT id, kind, attempt_count, last_error
        FROM job_queue WHERE status = 'DEAD_LETTER'
       ORDER BY last_error_at DESC LIMIT 50
    `);

    process.stdout.write(`Dead-lettered outbox events (${outbox.rows.length}):\n`);
    for (const row of outbox.rows) {
      process.stdout.write(
        `  ${row.id}  ${row.topic}  attempts=${row.attempt_count}  ${row.last_error_code ?? ''}\n`,
      );
    }
    process.stdout.write(`\nDead-lettered jobs (${jobs.rows.length}):\n`);
    for (const row of jobs.rows) {
      process.stdout.write(
        `  ${row.id}  ${row.kind}  attempts=${row.attempt_count}  ${(row.last_error ?? '').slice(0, 90)}\n`,
      );
    }
  } else if (kind === 'outbox') {
    if (maybeId && !maybeId.startsWith('--')) {
      const ok = await replayOutboxEvent(uow.db, maybeId);
      process.stdout.write(
        ok ? `Replayed outbox event ${maybeId}\n` : `Not found or already published: ${maybeId}\n`,
      );
    } else {
      const candidates = await uow.db.execute<{ id: string }>(sql`
        SELECT id FROM outbox_events
         WHERE dead_lettered_at IS NOT NULL
           ${topic ? sql`AND topic = ${topic}` : sql``}
         ORDER BY created_at DESC LIMIT ${limit}
      `);
      let replayed = 0;
      for (const row of candidates.rows) {
        if (await replayOutboxEvent(uow.db, row.id)) replayed += 1;
      }
      process.stdout.write(`Replayed ${replayed} of ${candidates.rows.length} outbox event(s)\n`);
    }
  } else if (kind === 'job') {
    if (maybeId && !maybeId.startsWith('--')) {
      const ok = await replayJob(uow.db, maybeId);
      process.stdout.write(
        ok ? `Replayed job ${maybeId}\n` : `Not found or not dead-lettered: ${maybeId}\n`,
      );
    } else {
      const candidates = await uow.db.execute<{ id: string }>(sql`
        SELECT id FROM job_queue
         WHERE status = 'DEAD_LETTER'
           ${jobKind ? sql`AND kind = ${jobKind}` : sql``}
         ORDER BY last_error_at DESC LIMIT ${limit}
      `);
      let replayed = 0;
      for (const row of candidates.rows) {
        if (await replayJob(uow.db, row.id)) replayed += 1;
      }
      process.stdout.write(`Replayed ${replayed} of ${candidates.rows.length} job(s)\n`);
    }
  } else {
    process.stderr.write(
      'usage:\n' +
        '  replay.ts list\n' +
        '  replay.ts outbox <eventId>\n' +
        '  replay.ts outbox [--topic <topic>] [--limit <n>]\n' +
        '  replay.ts job <jobId>\n' +
        '  replay.ts job [--kind <kind>] [--limit <n>]\n',
    );
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(formatCliError('Replay failed', error, config.DATABASE_URL));
  process.exitCode = 1;
} finally {
  await uow.close();
}
