import { sql } from 'drizzle-orm';
import { SYSTEM_SCOPE, runInScope } from './tenant-scope.js';
import type { UnitOfWork } from './client.js';

/**
 * Refuses to start in production if row-level security cannot actually bite.
 *
 * PostgreSQL exempts superusers and roles with BYPASSRLS from every policy,
 * unconditionally — `FORCE ROW LEVEL SECURITY` does not change that. So the
 * same deployment that passes every test can have its tenant isolation quietly
 * reduced to "the repositories remember their WHERE clauses" by nothing more
 * than a connection string pointing at the wrong role.
 *
 * That failure is invisible: the application behaves identically either way.
 * The only moment it becomes visible is the one where a query is missing its
 * tenant filter and returns another customer's records. This check converts an
 * invisible misconfiguration into a refusal to boot.
 *
 * Run `pnpm db:harden` to create the restricted runtime role.
 */
export async function assertRlsEnforceable(uow: UnitOfWork, appEnv: string): Promise<void> {
  if (appEnv !== 'production') return;

  const result = await runInScope(SYSTEM_SCOPE, () =>
    uow.db.execute<{ user_name: string; is_super: boolean; bypasses: boolean }>(sql`
      SELECT current_user AS user_name,
             rolsuper     AS is_super,
             rolbypassrls AS bypasses
        FROM pg_roles WHERE rolname = current_user
    `),
  );
  const role = result.rows[0];
  if (!role) throw new Error('Could not determine the database role; refusing to start.');

  if (role.is_super || role.bypasses) {
    throw new Error(
      `Database role "${role.user_name}" ${role.is_super ? 'is a superuser' : 'has BYPASSRLS'}, ` +
        'so row-level security would not be enforced and tenant isolation would rest on ' +
        'application code alone. Run `pnpm db:harden` and point DATABASE_URL at the ' +
        'restricted runtime role.',
    );
  }

  // A policy that was never applied is the same hole by a different route.
  const unprotected = await runInScope(SYSTEM_SCOPE, () =>
    uow.db.execute<{ relname: string }>(sql`
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND a.attnum > 0
         )
         AND c.relname <> 'purged_organizations'
         AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
    `),
  );
  if (unprotected.rows.length > 0) {
    throw new Error(
      'These tenant tables are missing enforced row-level security: ' +
        `${unprotected.rows.map((r) => r.relname).join(', ')}. Run pending migrations.`,
    );
  }
}
