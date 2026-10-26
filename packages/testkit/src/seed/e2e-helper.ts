#!/usr/bin/env tsx
/**
 * Out-of-process helpers for the Playwright suite.
 *
 * Playwright compiles test files to CommonJS, which cannot load the ESM
 * workspace packages directly. Running these operations as a subprocess also
 * keeps the E2E tests honest: they drive the product from the outside and only
 * reach into the system through a documented command.
 *
 *   tsx e2e-helper.ts seed
 *   tsx e2e-helper.ts supersede <changeOrderId> <organizationId>
 *   tsx e2e-helper.ts count-decisions <organizationId>
 *   tsx e2e-helper.ts sign-in <userId> <organizationId>
 */
import { loadConfig } from '@extrawork/config';
import { createContainer } from '@extrawork/runtime';
import { createSilentLogger } from '@extrawork/observability';
import { actorContext } from '../context.js';
import { seed } from './seed.js';

const [command, ...args] = process.argv.slice(2);
const config = loadConfig();

if (config.APP_ENV === 'production') {
  process.stderr.write('Refusing to run E2E helpers against production.\n');
  process.exit(1);
}

const container = createContainer({
  env: config,
  logger: createSilentLogger(),
  applicationName: 'extrawork-e2e-helper',
});

function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

try {
  switch (command) {
    case 'seed': {
      const result = await seed(container);
      emit({
        organizationId: result.organizationId,
        ownerUserId: result.ownerUserId,
        organizationName: 'Shree Interiors',
        pendingLinks: result.openApprovalUrls,
        projects: result.projects,
      });
      break;
    }

    case 'sign-in': {
      // Mints a real session the same way `startSessionFor` does for every
      // sign-in route (password, magic link, Google) — see
      // apps/api/src/routes/auth.ts. Driving this through a browser form
      // would need a password on the seeded owner or a mail outbox to read a
      // magic link from; minting the session directly keeps this a black-box
      // driver of the same application service instead of a parallel login
      // implementation.
      const [userId, organizationId] = args;
      if (!userId || !organizationId) {
        throw new Error('usage: sign-in <userId> <organizationId>');
      }
      const session = await container.services.auth.startSessionFor(
        { provider: 'local', subject: userId, email: '', displayName: '', userId },
        { ipHash: null, userAgent: null },
      );

      // `startSessionFor` resolves the session's active organization by
      // picking one deterministically from every ACTIVE membership the user
      // has in the whole database (ordered by org display name, then id) —
      // correct for a real sign-in, but this database accumulates a fresh
      // "Shree Interiors" organization from every past seed() call this
      // fixed-email owner has ever been a member of, so that pick is almost
      // never the organization *this* scenario just created. Point the
      // session at the right one explicitly, exactly as
      // `/v1/auth/switch-organization` does after a real sign-in.
      const resolved = await container.repos.identity.resolveSession(session.sessionToken);
      if (!resolved) throw new Error('Session vanished immediately after being minted');
      const membership = await container.repos.identity.getMembership(organizationId, userId);
      if (!membership || membership.status !== 'ACTIVE') {
        throw new Error(`User ${userId} has no active membership in org ${organizationId}`);
      }
      await container.uow.transaction((tx) =>
        container.repos.identity.setActiveOrganization(tx, resolved.id, organizationId),
      );

      emit({
        sessionToken: session.sessionToken,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt.toISOString(),
      });
      break;
    }

    case 'supersede': {
      const [changeOrderId, organizationId, ownerUserId] = args;
      if (!changeOrderId || !organizationId || !ownerUserId) {
        throw new Error('usage: supersede <changeOrderId> <organizationId> <ownerUserId>');
      }
      await container.services.changeOrders.createRevision(
        actorContext({ userId: ownerUserId, organizationId, role: 'OWNER' }),
        changeOrderId,
      );
      emit({ superseded: changeOrderId });
      break;
    }

    case 'count-decisions': {
      const [changeOrderId] = args;
      if (!changeOrderId) throw new Error('usage: count-decisions <changeOrderId>');
      const { rows } = await container.uow.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM decisions d
           JOIN change_order_versions v ON v.id = d.version_id
          WHERE v.change_order_id = $1`,
        [changeOrderId],
      );
      emit({ count: Number(rows[0]?.count ?? '0') });
      break;
    }

    default:
      throw new Error(`Unknown command: ${command ?? '(none)'}`);
  }
} catch (error) {
  process.stderr.write(`${(error as Error).stack ?? (error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await container.close();
}
