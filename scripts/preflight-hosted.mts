#!/usr/bin/env tsx
/**
 * Checks that a hosted Postgres and object store are actually usable, before
 * `db:migrate` gets halfway and leaves you guessing.
 *
 * Every check answers a question that has a specific, actionable fix, and the
 * output says which. Nothing here writes application data: the storage check
 * puts one small object under a `preflight/` prefix and deletes it.
 */
import { loadConfig } from '@extrawork/config';
import { createPool } from '@extrawork/db';
import { createObjectStore } from '@extrawork/files';

type Result = { ok: boolean; label: string; detail: string; fix?: string };

const results: Result[] = [];
function record(ok: boolean, label: string, detail: string, fix?: string): void {
  results.push(ok ? { ok, label, detail } : { ok, label, detail, ...(fix ? { fix } : {}) });
}

/** Hides the password before anything reaches a terminal or a log. */
function redact(url: string): string {
  return url.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/, '$1••••••$2');
}

async function main(): Promise<void> {
  const config = loadConfig();

  // --- Database ---------------------------------------------------------------

  const pool = createPool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL,
    ...(config.DATABASE_CA_CERT ? { caCertPath: config.DATABASE_CA_CERT } : {}),
    applicationName: 'extrawork-preflight',
    statementTimeoutMs: 15_000,
  });

  try {
    const { rows } = await pool.query<{ version: string; db: string }>(
      'SELECT version() AS version, current_database() AS db',
    );
    record(true, 'Database reachable', `${rows[0]?.db} · ${rows[0]?.version?.slice(0, 40)}…`);
  } catch (error) {
    record(
      false,
      'Database reachable',
      `${redact(config.DATABASE_URL)} — ${(error as Error).message}`,
      'Check DATABASE_URL, and that DATABASE_SSL=true for a hosted database.',
    );
  }

  if (results[0]?.ok) {
    // The transaction pooler hands a different backend to each statement, which
    // silently breaks the worker's FOR UPDATE SKIP LOCKED leases. Port 6543 is
    // Supabase's pooler; catching it here saves an intermittent failure later.
    const usesPooler = /:6543\//.test(config.DATABASE_URL);
    record(
      !usesPooler,
      'Connection mode',
      usesPooler ? 'port 6543 — transaction pooler' : 'direct/session connection',
      'Use the direct connection string (port 5432). Transaction pooling breaks row locks.',
    );

    const required = ['pgcrypto', 'pg_trgm', 'unaccent'];
    const { rows } = await pool.query<{ extname: string }>(
      'SELECT extname FROM pg_extension WHERE extname = ANY($1)',
      [required],
    );
    const present = new Set(rows.map((r) => r.extname));
    const missing = required.filter((name) => !present.has(name));
    record(
      missing.length === 0,
      'Extensions',
      missing.length === 0 ? required.join(', ') : `missing: ${missing.join(', ')}`,
      'Enable them in Supabase under Database → Extensions, then re-run.',
    );

    // A superuser bypasses rolcreaterole entirely, so checking that flag alone
    // reports "no" for an account that plainly can.
    const { rows: roleRows } = await pool.query<{ super: boolean; createrole: boolean }>(
      'SELECT rolsuper AS "super", rolcreaterole AS createrole FROM pg_roles WHERE rolname = current_user',
    );
    const canCreateRole = Boolean(roleRows[0]?.super || roleRows[0]?.createrole);
    record(
      canCreateRole,
      'Can create roles',
      roleRows[0]?.super ? 'yes (superuser)' : canCreateRole ? 'yes' : 'no',
      'pnpm db:harden needs CREATE ROLE. Connect as the project owner role.',
    );

    const { rows: sslRows } = await pool.query<{ ssl: boolean }>(
      'SELECT COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl',
    );
    record(
      Boolean(sslRows[0]?.ssl),
      'Connection encrypted',
      sslRows[0]?.ssl ? 'TLS' : 'plaintext',
      'Set DATABASE_SSL=true. A hosted database must never be reached in the clear.',
    );

    const { rows: migRows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'schema_migrations'`,
    );
    const applied =
      migRows[0]?.count === '0'
        ? 'none yet — this is a fresh database'
        : (
            await pool.query<{ count: string }>(
              'SELECT count(*)::text AS count FROM schema_migrations',
            )
          ).rows[0]?.count + ' applied';
    record(true, 'Migrations', String(applied));
  }

  await pool.end();

  // --- Object storage ---------------------------------------------------------

  if (config.STORAGE_DRIVER !== 's3') {
    record(
      false,
      'Storage driver',
      `${config.STORAGE_DRIVER} — still writing to this machine`,
      'Set STORAGE_DRIVER=s3 with the R2 values from the runbook.',
    );
  } else {
    record(true, 'Storage driver', `s3 → ${config.STORAGE_ENDPOINT ?? 'aws'}`);

    // Exercised through the application's own ObjectStore rather than a raw SDK
    // call: a check that passes against a different code path proves nothing
    // about whether the app can read and write.
    const store = createObjectStore(config);
    const key = `preflight/${Date.now()}.txt`;
    const body = Buffer.from('extrawork preflight', 'utf8');

    try {
      await store.put(key, body, 'text/plain');
      record(true, 'Bucket writable', config.STORAGE_BUCKET);

      const read = await store.get(key);
      record(
        read.equals(body),
        'Bucket readable',
        read.equals(body) ? 'wrote and read back identical bytes' : 'read back different bytes',
        'The API token needs Object Read as well as Write.',
      );

      // Presigned GET. The customer's evidence pack is served this way, so a
      // provider that cannot sign a download is unusable regardless of how well
      // it stores bytes. Fetched, not just generated — a URL that 403s would
      // otherwise look like a pass.
      const url = await store.createDownload(key, 60);
      const signed = await fetch(url);
      record(
        signed.ok,
        'Presigned download',
        signed.ok ? `${new URL(url).host} → ${signed.status}` : `HTTP ${signed.status}`,
        'This provider cannot sign downloads the way the evidence pack needs.',
      );

      // Presigned PUT. Uploads from the browser go straight to the store using
      // one of these, never through the API.
      const uploadKey = `preflight/${Date.now()}-upload.txt`;
      const upload = await store.createUpload({
        key: uploadKey,
        contentType: 'text/plain',
        byteSize: body.byteLength,
        ttlSeconds: 60,
      });
      const put = await fetch(upload.url, {
        method: upload.method,
        headers: upload.headers,
        body,
      });
      record(
        put.ok,
        'Presigned upload',
        put.ok ? `${upload.method} → ${put.status}` : `HTTP ${put.status}`,
        'Browser uploads need a presigned PUT. This provider rejected one.',
      );

      // CopyObject, used to promote a file out of quarantine once it has passed
      // the malware scan. Not every S3-compatible provider implements it.
      const movedKey = `preflight/${Date.now()}-moved.txt`;
      try {
        await store.move(uploadKey, movedKey);
        record(true, 'Copy / move', 'promoted an object between keys');
        await store.delete(movedKey);
      } catch (error) {
        record(
          false,
          'Copy / move',
          (error as Error).name,
          'Uploads are promoted out of quarantine with CopyObject; this provider lacks it.',
        );
        await store.delete(uploadKey).catch(() => undefined);
      }

      await store.delete(key);
      record(true, 'Cleanup', 'test objects removed');
    } catch (error) {
      record(
        false,
        'Bucket usable',
        `${(error as Error).name}: ${(error as Error).message.slice(0, 80)}`,
        'Check the bucket name, endpoint, region=auto, and that the token covers this bucket.',
      );
    }
  }

  // --- Report -----------------------------------------------------------------

  process.stdout.write('\n  ExtraWork hosted preflight\n\n');
  for (const r of results) {
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${r.label.padEnd(22)} ${r.detail}\n`);
    if (!r.ok && r.fix) process.stdout.write(`     ${' '.repeat(22)} → ${r.fix}\n`);
  }

  const failed = results.filter((r) => !r.ok).length;
  process.stdout.write(
    failed === 0
      ? '\n  All checks passed. Safe to run pnpm db:migrate.\n\n'
      : `\n  ${failed} check(s) failed. Fix the arrows above, then re-run.\n\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

await main();
