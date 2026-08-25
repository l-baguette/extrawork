import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JOB_KINDS } from '@extrawork/contracts';
import {
  claimJobs,
  completeJob,
  enqueueJob,
  failJob,
  heartbeatJob,
  reclaimExpiredLeases,
} from '@extrawork/db';
import type { Container } from '@extrawork/runtime';
import { createTestContainer, truncateAll } from '@extrawork/testkit';

let container: Container;

beforeAll(() => {
  container = createTestContainer();
});

afterAll(async () => {
  await container.close();
});

beforeEach(async () => {
  await truncateAll(container);
});

describe('job lease ownership', () => {
  it('prevents an expired worker from heartbeating, completing or failing a reclaimed job', async () => {
    await enqueueJob(
      { db: container.uow.db },
      {
        kind: JOB_KINDS.EXPIRE_REQUESTS,
        organizationId: null,
        payload: {},
      },
    );
    const [first] = await claimJobs(container.uow.db, {
      limit: 1,
      leaseSeconds: 60,
      workerId: 'worker-a',
    });
    expect(first).toBeDefined();

    await container.uow.pool.query(
      `UPDATE job_queue SET leased_until = now() - interval '1 second' WHERE id = $1`,
      [first!.id],
    );
    expect(await reclaimExpiredLeases(container.uow.db)).toBe(1);
    const [second] = await claimJobs(container.uow.db, {
      limit: 1,
      leaseSeconds: 60,
      workerId: 'worker-b',
    });
    expect(second?.id).toBe(first!.id);

    await expect(heartbeatJob(container.uow.db, first!.id, 60, 'worker-a')).resolves.toBe(false);
    await expect(completeJob(container.uow.db, first!.id, 'worker-a')).resolves.toBe(false);
    await expect(failJob(container.uow.db, first!, 'late failure', 'worker-a')).resolves.toBe(
      'LEASE_LOST',
    );

    await expect(heartbeatJob(container.uow.db, second!.id, 60, 'worker-b')).resolves.toBe(true);
    await expect(completeJob(container.uow.db, second!.id, 'worker-b')).resolves.toBe(true);
    const row = await container.uow.pool.query<{ status: string }>(
      'SELECT status FROM job_queue WHERE id = $1',
      [second!.id],
    );
    expect(row.rows[0]?.status).toBe('COMPLETED');
  });
});
