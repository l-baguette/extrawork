import { beforeAll } from 'vitest';
import { ensureMigrated } from '@extrawork/testkit';

/**
 * Applies migrations once per worker process before any database-backed test.
 * Individual suites create their own container and truncate between tests.
 */
beforeAll(async () => {
  await ensureMigrated();
}, 120_000);
