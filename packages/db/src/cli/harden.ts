#!/usr/bin/env tsx
/**
 * Deployment-time database hardening — report §9.6 and §12.1.
 *
 * Migration 0003 installs triggers that reject any rewrite of frozen evidence.
 * This command adds the second layer the report asks for: a dedicated *runtime*
 * role that does not hold UPDATE or DELETE on the append-only tables at all, so
 * a SQL-injection or a compromised application credential cannot even attempt
 * the write.
 *
 * It is a separate command rather than a migration because it needs a superuser
 * and a role name that varies per environment.
 *
 *   pnpm db:harden --role extrawork_runtime --password "$RUNTIME_DB_PASSWORD"
 *
 * Run it as an administrator connection (DATABASE_MAINTENANCE_URL if set).
 */
import { loadConfig } from '@extrawork/config';
import { formatCliError } from './describe-error.js';
import { createPool } from '../client.js';

/** Tables the runtime role may INSERT into but never UPDATE or DELETE. */
const APPEND_ONLY_TABLES = ['audit_events', 'decisions', 'repair_events'];

/** Columns of a sent version that must never change (enforced by trigger too). */
const FROZEN_TABLES = ['change_order_versions', 'line_items', 'version_attachments'];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const config = loadConfig();
const roleName = arg('role') ?? process.env.RUNTIME_DB_ROLE ?? 'extrawork_runtime';
const password = arg('password') ?? process.env.RUNTIME_DB_PASSWORD;
const dryRun = process.argv.includes('--dry-run');

if (!/^[a-z_][a-z0-9_]{2,62}$/.test(roleName)) {
  process.stderr.write(`Invalid role name: ${roleName}\n`);
  process.exit(1);
}

const adminUrl = config.DATABASE_MAINTENANCE_URL ?? config.DATABASE_URL;
const pool = createPool({
  connectionString: adminUrl,
  ssl: config.DATABASE_SSL,
  ...(config.DATABASE_CA_CERT ? { caCertPath: config.DATABASE_CA_CERT } : {}),
  applicationName: 'extrawork-harden',
  statementTimeoutMs: 120_000,
});

const statements: string[] = [];

if (password) {
  statements.push(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN
         CREATE ROLE ${roleName} LOGIN PASSWORD ${literal(password)};
       ELSE
         ALTER ROLE ${roleName} LOGIN PASSWORD ${literal(password)};
       END IF;
     END $$;`,
  );
} else {
  statements.push(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN
         CREATE ROLE ${roleName} LOGIN;
       END IF;
     END $$;`,
  );
}

statements.push(
  `GRANT CONNECT ON DATABASE ${quoteIdent(databaseNameOf(adminUrl))} TO ${roleName}`,
  `GRANT USAGE ON SCHEMA public TO ${roleName}`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${roleName}`,
  `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${roleName}`,
  // Future tables default to the same baseline.
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${roleName}`,
);

// Now take the dangerous privileges back off the evidence tables.
for (const table of APPEND_ONLY_TABLES) {
  statements.push(`REVOKE UPDATE, DELETE ON ${table} FROM ${roleName}`);
}
// Frozen versions still need UPDATE (status transitions, viewed_at), so the
// trigger — not the privilege — is what protects the frozen columns. DELETE is
// never legitimate.
for (const table of FROZEN_TABLES) {
  statements.push(`REVOKE DELETE ON ${table} FROM ${roleName}`);
}
// The runtime role must never be able to disable the repair guard.
statements.push(
  `REVOKE ALL ON FUNCTION repair_mode_enabled() FROM ${roleName}`,
  `GRANT EXECUTE ON FUNCTION repair_mode_enabled() TO ${roleName}`,
);

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
function databaseNameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

try {
  if (dryRun) {
    process.stdout.write(`${statements.join(';\n')};\n`);
  } else {
    for (const statement of statements) {
      await pool.query(statement);
    }
    process.stdout.write(
      `Hardened: role "${roleName}" has no UPDATE/DELETE on ${APPEND_ONLY_TABLES.join(', ')} ` +
        `and no DELETE on ${FROZEN_TABLES.join(', ')}.\n` +
        `Point DATABASE_URL at this role and keep the owner credential for migrations only.\n`,
    );
  }
} catch (error) {
  process.stderr.write(formatCliError('Hardening failed', error, config.DATABASE_URL));
  process.exitCode = 1;
} finally {
  await pool.end();
}
