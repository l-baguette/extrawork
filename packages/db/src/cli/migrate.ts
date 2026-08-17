#!/usr/bin/env tsx
import { loadConfig } from '@extrawork/config';
import { formatCliError } from './describe-error.js';
import { createPool } from '../client.js';
import { runMigrations } from '../migrate.js';

const config = loadConfig();
const pool = createPool({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_SSL,
  ...(config.DATABASE_CA_CERT ? { caCertPath: config.DATABASE_CA_CERT } : {}),
  applicationName: 'extrawork-migrate',
  statementTimeoutMs: 600_000,
});

try {
  const result = await runMigrations(pool, { log: (m) => process.stdout.write(`  ${m}\n`) });
  if (result.applied.length === 0) {
    process.stdout.write(`No new migrations. ${result.skipped.length} already applied.\n`);
  } else {
    process.stdout.write(
      `Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}\n`,
    );
  }
} catch (error) {
  process.stderr.write(formatCliError('Migration failed', error, config.DATABASE_URL));
  process.exitCode = 1;
} finally {
  await pool.end();
}
