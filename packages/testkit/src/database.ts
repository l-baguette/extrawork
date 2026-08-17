import { loadConfig, type Env } from '@extrawork/config';
import { createContainer, type Container } from '@extrawork/runtime';
import { createPool, runMigrations } from '@extrawork/db';
import { createSilentLogger } from '@extrawork/observability';

/**
 * Integration-test harness against a **real** PostgreSQL instance.
 *
 * Report §14.5 requires "an ephemeral real PostgreSQL instance" and lists
 * Testcontainers as the tool. Testcontainers needs a Docker daemon; this
 * harness talks to whatever `TEST_DATABASE_URL` points at, so it works with a
 * Testcontainers-managed container in CI, the Docker Compose service in
 * `infra/docker`, or a local cluster on a developer machine without Docker.
 * What it never does is substitute an in-memory fake: the locking, constraint,
 * trigger and index behaviour under test only exists in real PostgreSQL.
 */

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/extrawork_test';

/**
 * Refuses to run the suite against anything that is not a test database.
 *
 * `truncateAll` empties every table between tests. That is correct for a
 * throwaway database and catastrophic anywhere else, so the harness proves the
 * target is disposable before it is handed to a test.
 *
 * This previously fell back to `DATABASE_URL`, which was harmless while that
 * pointed at localhost and became a live hazard the moment it pointed at a
 * hosted database. The suite only avoided wiping production because this module
 * happens to be evaluated before `.env` is loaded — a guarantee no one should
 * have to rely on. The fallback is gone, and this check is the backstop.
 */
function assertDisposable(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a valid URL: ${url}`);
  }

  const database = parsed.pathname.replace(/^\//, '');
  const host = parsed.hostname;
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'postgres';
  const namedForTests = /(^|[_-])test(s)?$/.test(database);

  if (!isLocal || !namedForTests) {
    throw new Error(
      `Refusing to run the test suite against "${database}" on "${host}".\n` +
        'The suite truncates every table between tests. It will only run against a ' +
        'local database whose name ends in "_test".\n' +
        'Set TEST_DATABASE_URL to something like ' +
        'postgres://postgres@127.0.0.1:5432/extrawork_test',
    );
  }
}

assertDisposable(TEST_DATABASE_URL);

let migrated = false;

/** Applies migrations once per process. */
export async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  const pool = createPool({
    connectionString: TEST_DATABASE_URL,
    applicationName: 'extrawork-test-migrate',
    statementTimeoutMs: 120_000,
  });
  try {
    await runMigrations(pool);
    migrated = true;
  } finally {
    await pool.end();
  }
}

/**
 * Tables never truncated between tests: the migration ledger, and nothing else.
 * Everything else is cleared so each test starts from a known empty state.
 */
const PRESERVED_TABLES = new Set(['schema_migrations']);

let cachedTableList: string[] | null = null;

export async function truncateAll(container: Container): Promise<void> {
  if (!cachedTableList) {
    const { rows } = await container.uow.pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    cachedTableList = rows.map((r) => r.tablename).filter((t) => !PRESERVED_TABLES.has(t));
  }
  if (cachedTableList.length === 0) return;
  // TRUNCATE does not fire the per-row append-only triggers, which is exactly
  // why test teardown can clear evidence tables that the application may not.
  await container.uow.pool.query(
    `TRUNCATE TABLE ${cachedTableList.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

export interface TestContainerOptions {
  /** Overrides merged over the environment before validation. */
  env?: Partial<Record<string, string>>;
  onOtpCode?: (phoneE164: string, code: string) => void;
  clock?: Container['appContext']['clock'];
}

/**
 * Builds a fully wired container pointed at the test database, with drivers
 * that keep side effects local: filesystem object store, file-based mail, and
 * a console OTP sender whose codes are captured by `onOtpCode`.
 */
export function createTestContainer(options: TestContainerOptions = {}): Container {
  const env: Env = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'local',
    DATABASE_URL: TEST_DATABASE_URL,
    SESSION_SECRET: 'test-session-secret-test-session-secret-0001',
    PRIVACY_HASH_SECRET: 'test-privacy-secret-test-privacy-secret-0002',
    STORAGE_URL_SECRET: 'test-storage-secret-test-storage-secret-0003',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_ROOT: './.data/test-storage',
    EMAIL_DRIVER: 'file',
    EMAIL_OUTBOX_DIR: './.data/test-mail',
    OTP_DRIVER: 'console',
    WHATSAPP_DRIVER: 'native-share',
    LOG_LEVEL: 'silent',
    LOG_PRETTY: 'false',
    RATE_LIMIT_ENABLED: 'false',
    WEB_PUBLIC_URL: 'http://localhost:3000',
    API_PUBLIC_URL: 'http://localhost:4000',
    ...options.env,
  } as NodeJS.ProcessEnv);

  return createContainer({
    env,
    logger: createSilentLogger(),
    applicationName: 'extrawork-test',
    ...(options.onOtpCode ? { onOtpCode: options.onOtpCode } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
  });
}

/**
 * Convenience wrapper: migrate, build a container, clear state, run the body,
 * then close the pool. Used by suites that want one container per file.
 */
export async function withTestContainer<T>(
  body: (container: Container) => Promise<T>,
  options: TestContainerOptions = {},
): Promise<T> {
  await ensureMigrated();
  const container = createTestContainer(options);
  try {
    await truncateAll(container);
    return await body(container);
  } finally {
    await container.close();
  }
}
