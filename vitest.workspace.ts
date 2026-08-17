import { defineWorkspace } from 'vitest/config';

/**
 * Test projects mirror report §14.5.
 *
 *  unit         pure domain: money, tax, rounding, canonical JSON, state
 *               transitions, authorization matrix, tokens, reminders
 *  property     randomised invariants (§14.5 "Property-based tests")
 *  integration  a REAL PostgreSQL instance: constraints, row-lock races,
 *               tenant isolation, outbox atomicity, job leases, migrations
 *  security     IDOR corpus, token leakage, CSRF, malicious files, webhook
 *               forgery, rate limits
 *  golden       canonical JSON, expected digest, rendered PDF text extraction
 *
 * The database-backed projects run one file at a time: they share a single test
 * database and truncate between tests, so parallel files would race. Unit and
 * property tests stay fully parallel.
 */
const database = {
  environment: 'node' as const,
  testTimeout: 60_000,
  hookTimeout: 60_000,
  // One process, one file at a time. These suites share a single test database
  // and truncate between tests, so two files running concurrently would delete
  // each other's fixtures mid-test and deadlock on the TRUNCATE.
  fileParallelism: false,
  pool: 'forks' as const,
  poolOptions: { forks: { singleFork: true } },
  setupFiles: ['tests/setup/database.ts'],
};

export default defineWorkspace([
  {
    test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
  },
  {
    test: {
      name: 'property',
      include: ['tests/property/**/*.test.ts'],
      environment: 'node',
      testTimeout: 60_000,
    },
  },
  { test: { ...database, name: 'integration', include: ['tests/integration/**/*.test.ts'] } },
  { test: { ...database, name: 'security', include: ['tests/security/**/*.test.ts'] } },
  {
    test: {
      ...database,
      name: 'golden',
      include: ['tests/golden/**/*.test.ts'],
      testTimeout: 180_000,
      hookTimeout: 180_000,
    },
  },
]);
