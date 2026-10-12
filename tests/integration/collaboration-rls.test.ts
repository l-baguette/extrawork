import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Container } from '@extrawork/runtime';
import { runInScope, tenantScope } from '@extrawork/db';
import {
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * The invitation flow with row-level security switched on.
 *
 * Accepting is the one write path where the caller is not yet a member of the
 * workspace being written to: the token lookups run system-scoped and the
 * acceptance runs scoped to the host organization the token resolved to. The
 * rest of the suite connects as a superuser, for whom RLS is inert, so only a
 * restricted login role (as production uses, `pnpm db:harden`) can show that
 * those scopes are right — a missing one would make acceptance fail closed
 * here and nowhere else. Mirrors `row-level-security.test.ts`.
 */

let owner: Container;
let restricted: Container;
let alpha: TenantFixture;
let beta: TenantFixture;

const roleName = `ew_rls_collab_${randomUUID().replaceAll('-', '')}`;
const rolePassword = 'rls-collab-test-password';

beforeAll(async () => {
  owner = createTestContainer();
  await owner.uow.pool.query(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${rolePassword}'`);
  await owner.uow.pool.query(`GRANT USAGE ON SCHEMA public TO "${roleName}"`);
  await owner.uow.pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${roleName}"`,
  );
  await owner.uow.pool.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${roleName}"`,
  );
  const url = new URL(owner.env.DATABASE_URL);
  url.username = roleName;
  url.password = rolePassword;
  restricted = createTestContainer({ env: { DATABASE_URL: url.toString() } });

  await truncateAll(owner);
  alpha = await createTenant(owner, { name: 'RLS Alpha Studio' });
  beta = await createTenant(owner, { name: 'RLS Beta Studio' });
});

afterAll(async () => {
  await restricted.close();
  await owner.uow.pool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${roleName}"`);
  await owner.uow.pool.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "${roleName}"`);
  await owner.uow.pool.query(`REVOKE USAGE ON SCHEMA public FROM "${roleName}"`);
  await owner.uow.pool.query(`DROP ROLE IF EXISTS "${roleName}"`);
  await owner.close();
});

describe('invitations under row-level security', () => {
  it('invites, previews, lists and accepts with the policies enforced', async () => {
    const email = `rls-${randomUUID().slice(0, 8)}@example.test`;
    const person = await owner.uow.transaction((tx) =>
      owner.repos.identity.upsertUser(tx, {
        provider: 'local',
        subject: `local|rls-${randomUUID()}`,
        email,
        displayName: 'RLS Contractor',
      }),
    );

    // The designer's side runs in their own tenant scope, as requireAuth sets it.
    const invited = await runInScope(tenantScope(alpha.organizationId), () =>
      restricted.services.collaboration.invite(alpha.owner, alpha.projectId, {
        email,
        party: 'CONSTRUCTION',
      }),
    );
    const token = invited.inviteUrl.slice(invited.inviteUrl.lastIndexOf('/') + 1);

    // The invitee's side starts with no scope at all, as their request does.
    const preview = await restricted.services.collaboration.preview(token);
    expect(preview).toMatchObject({
      organizationName: 'RLS Alpha Studio',
      status: 'PENDING',
    });
    const pending = await restricted.services.collaboration.listPending(person.id);
    expect(pending.map((p) => p.id)).toEqual([invited.invitation.id]);

    const accepted = await restricted.services.collaboration.accept(person.id, token, 'req-rls');
    expect(accepted).toEqual({ organizationId: alpha.organizationId, projectId: alpha.projectId });

    // Written into the host tenant, visible there and nowhere else.
    const people = await runInScope(tenantScope(alpha.organizationId), () =>
      restricted.repos.collaboration.projectPeople(alpha.owner.tenant, alpha.projectId),
    );
    expect(people.find((p) => p.userId === person.id)).toMatchObject({ role: 'COLLABORATOR' });

    const fromBeta = await runInScope(tenantScope(beta.organizationId), () =>
      restricted.repos.collaboration.listForProject(beta.owner.tenant, alpha.projectId),
    );
    expect(fromBeta).toEqual([]);
  });

  it('shows another tenant none of a workspace’s invitations, even by id', async () => {
    const invited = await runInScope(tenantScope(alpha.organizationId), () =>
      restricted.services.collaboration.invite(alpha.owner, alpha.projectId, {
        email: `hidden-${randomUUID().slice(0, 8)}@example.test`,
        party: 'OTHER',
      }),
    );
    // Deliberately the alpha id under the beta scope: RLS, not the WHERE
    // clause, is what this proves.
    const seen = await runInScope(tenantScope(beta.organizationId), () =>
      restricted.repos.collaboration.findById(
        { ...beta.owner.tenant, organizationId: alpha.organizationId },
        invited.invitation.id,
      ),
    );
    expect(seen).toBeNull();
  });
});
