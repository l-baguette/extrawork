#!/usr/bin/env tsx
/**
 * Drops and recreates the public schema, then re-runs every migration.
 *
 * Refuses to run against production. Report §11.2 keeps production data
 * strictly separated from developer tooling, and this is exactly the kind of
 * command that must never be pointed at a live database by accident.
 */
import { loadConfig } from '@extrawork/config';
import { formatCliError } from './describe-error.js';
import { assertLocalDatabase } from './guards.js';
import { createPool } from '../client.js';
import { runMigrations } from '../migrate.js';

const config = loadConfig();

if (config.APP_ENV === 'production' || config.NODE_ENV === 'production') {
  process.stderr.write('Refusing to reset a production database.\n');
  process.exit(1);
}

const url = new URL(config.DATABASE_URL);
const databaseName = url.pathname.replace(/^\//, '');

// `APP_ENV` is the authoritative signal; the name check is a second guard for
// the environments where a mistake would actually cost something. Staging holds
// real migration rehearsals and synthetic-but-meaningful data (report §11.2),
// so it needs an explicit override.
const environmentAllowsReset = config.APP_ENV === 'local' || config.APP_ENV === 'preview';
if (!environmentAllowsReset && process.env.ALLOW_RESET !== '1') {
  process.stderr.write(
    `Refusing to reset "${databaseName}" with APP_ENV=${config.APP_ENV}.\n` +
      'Set ALLOW_RESET=1 to override.\n',
  );
  process.exit(1);
}

// The check above trusts APP_ENV, which describes the deployment rather than
// the database. `APP_ENV=local` with DATABASE_URL pointing at a managed host
// passes it while being the single most dangerous configuration there is, so
// the connection string gets the final say.
try {
  assertLocalDatabase(config.DATABASE_URL, {
    command: 'drop and recreate',
    overrideEnvVar: 'ALLOW_REMOTE_RESET',
  });
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
}

const pool = createPool({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_SSL,
  ...(config.DATABASE_CA_CERT ? { caCertPath: config.DATABASE_CA_CERT } : {}),
  applicationName: 'extrawork-reset',
  statementTimeoutMs: 600_000,
});

try {
  process.stdout.write(`Resetting schema in "${databaseName}"...\n`);
  // The runtime role has UPDATE/DELETE revoked on evidence tables by the
  // hardening migration; DROP SCHEMA as the owner clears that too.
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.query('GRANT ALL ON SCHEMA public TO public');

  const result = await runMigrations(pool, { log: (m) => process.stdout.write(`  ${m}\n`) });
  process.stdout.write(`Applied ${result.applied.length} migration(s).\n`);
} catch (error) {
  process.stderr.write(formatCliError('Reset failed', error, config.DATABASE_URL));
  process.exitCode = 1;
} finally {
  await pool.end();
}
