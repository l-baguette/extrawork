#!/usr/bin/env tsx
/**
 * Creates a ready-to-use test account with a password, and gives it the same
 * demo organization the seed builds — projects, customers, change orders and a
 * registered WhatsApp employee.
 *
 * Separate from `pnpm db:seed` because it puts a *password* on an account, and
 * that only makes sense for a named tester. Re-running it is safe: it reuses
 * the existing organization rather than creating a second one.
 */
import { loadConfig } from '@extrawork/config';
import { createContainer } from '@extrawork/runtime';
import { hashPassword, normalizeEmail } from '@extrawork/domain';
import { localAuthSubject } from '@extrawork/application';
import { actorContext } from '@extrawork/testkit';
import { sql } from 'drizzle-orm';

const EMAIL = process.env.TEST_ACCOUNT_EMAIL ?? 'test@gmail.com';
const PASSWORD = process.env.TEST_ACCOUNT_PASSWORD ?? 'Test123';
const DISPLAY_NAME = 'Test Owner';

const config = loadConfig();
if (config.APP_ENV === 'production') {
  process.stderr.write('Refusing to create a known-password account in production.\n');
  process.exit(1);
}

const container = createContainer({ env: config, applicationName: 'extrawork-test-account' });

try {
  const email = normalizeEmail(EMAIL);

  // The password policy rejects anything under 8 characters. This account is
  // created deliberately for a named tester, so it bypasses the form's rule
  // rather than weakening the rule for everybody.
  const passwordHash = await hashPassword(PASSWORD);

  const user = await container.uow.transaction(async (tx) => {
    const created = await container.repos.identity.upsertUser(tx, {
      provider: 'local',
      subject: localAuthSubject(email),
      email,
      displayName: DISPLAY_NAME,
    });
    await container.repos.identity.setPassword(tx, created.id, passwordHash);
    return created;
  });

  // Reuse the demo organization the seed already built, so the tester lands on
  // populated projects instead of an empty shell.
  const orgs = await container.uow.db.execute<{ id: string; display_name: string }>(
    sql`SELECT id, display_name FROM organizations ORDER BY created_at LIMIT 1`,
  );
  const organization = orgs.rows[0];
  if (!organization) {
    process.stderr.write('No organization found. Run `pnpm db:seed` first.\n');
    process.exit(1);
  }

  // `memberships_single_owner_idx` allows exactly one OWNER per organization,
  // and the seed's own owner already holds it. ADMIN carries every permission
  // except transferring ownership, so the tester can do everything that
  // matters — manage projects, employees, templates and requests — without
  // displacing the existing owner.
  const existing = await container.repos.identity.getMembership(organization.id, user.id);
  const role = existing?.role ?? 'ADMIN';
  if (!existing) {
    await container.uow.transaction(async (tx) => {
      await container.repos.organizations.addMembership(tx, {
        organizationId: organization.id,
        userId: user.id,
        role: 'ADMIN',
      });
    });
  }

  const tenant = actorContext({
    userId: user.id,
    organizationId: organization.id,
    role,
  });

  // A WhatsApp employee to send from, if the seed did not leave one.
  const employees = await container.repos.employees.list(tenant.tenant);
  if (employees.length === 0) {
    await container.uow.transaction((tx) =>
      container.repos.employees.create(tx, tenant.tenant, {
        name: 'Ramesh Patil',
        phoneE164: '+919876543210',
        roleNote: 'Site supervisor',
        allProjects: true,
        maxRequestMinor: 5_000_000n,
        projectIds: [],
      }),
    );
  }

  const projects = await container.repos.projects.list(tenant.tenant, { limit: 50 });
  const roster = await container.repos.employees.list(tenant.tenant);

  process.stdout.write(
    [
      '',
      '  Test account ready',
      '',
      `    email:     ${email}`,
      `    password:  ${PASSWORD}`,
      `    org:       ${organization.display_name}`,
      `    role:      ${role}`,
      `    projects:  ${projects.items.length}`,
      `    employees: ${roster.map((e) => `${e.name} (${e.phoneE164})`).join(', ') || 'none'}`,
      '',
    ].join('\n'),
  );
} finally {
  await container.close();
}
