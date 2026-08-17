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
