#!/usr/bin/env tsx
/**
 * `pnpm db:seed` — loads demonstration data into the configured database.
 *
 * Refuses to run against production, and refuses to run twice into the same
 * database unless `--force` is given, because the seed creates a fresh
 * organization each time and duplicates make the demo confusing.
 */
import { loadConfig } from '@extrawork/config';
import { createContainer } from '@extrawork/runtime';
import { seed } from './seed.js';

const config = loadConfig();

if (config.APP_ENV === 'production') {
  process.stderr.write('Refusing to seed a production database.\n');
  process.exit(1);
}

const force = process.argv.includes('--force');
const asJson = process.argv.includes('--json');

const container = createContainer({ env: config, applicationName: 'extrawork-seed' });

try {
  const { rows } = await container.uow.pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM organizations',
  );
  const existing = Number(rows[0]?.count ?? '0');
  if (existing > 0 && !force) {
    process.stderr.write(
      `Database already contains ${existing} organization(s).\n` +
        'Run `pnpm db:reset && pnpm db:migrate` for a clean slate, or pass --force to add another.\n',
    );
    process.exit(1);
  }

  const result = await seed(container);

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`
Seeded ExtraWork demonstration data
===================================

Organization   Shree Interiors  (${result.organizationId})

Sign in with a magic link (AUTH_DRIVER=local writes the link to the mail outbox
at ${config.EMAIL_OUTBOX_DIR} and to the API log):

  Owner            ${result.ownerEmail}
  Project manager  ${result.projectManagerEmail}
  Finance          ${result.financeEmail}

Projects
${result.projects.map((p) => `  ${p.number}  ${p.title}`).join('\n')}

Change orders
${result.changeOrders.map((c) => `  ${c.number.padEnd(8)} ${c.status}`).join('\n')}

Live approval links (open on a phone-sized viewport):
${
  result.openApprovalUrls.length > 0
    ? result.openApprovalUrls.map((l) => `  ${l.changeNumber.padEnd(10)} ${l.url}`).join('\n')
    : '  (none)'
}

These links are shown once here because only their SHA-256 is stored
(report §3.4). Re-seed if you lose them.
`);
  }
} catch (error) {
  process.stderr.write(`Seed failed: ${(error as Error).stack ?? (error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await container.close();
}
