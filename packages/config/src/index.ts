import path from 'node:path';
import { z } from 'zod';
import { loadEnvFile } from './dotenv.js';

/**
 * Central typed configuration. Secrets are never defaulted to a usable value in
 * production: `assertProductionSafe` refuses to boot with development stand-ins.
 * Report §11.3 (secrets live in the deployment provider's secret manager).
 */

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const csv = z.string().transform((s) =>
  s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean),
);

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'preview', 'staging', 'production']).default('local'),

  // --- Network -------------------------------------------------------------
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  /** Absolute origin the API is reachable at, used to build links. */
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  /** Absolute origin of the Next.js app; approval links are built from this. */
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  /** Origins allowed to make cookie-authenticated cross-origin calls. */
  CORS_ALLOWED_ORIGINS: csv.default('http://localhost:3000'),
  /** Trust X-Forwarded-For. Only enable behind a known proxy. */
  TRUST_PROXY: booleanish.default(false),

  // --- Database ------------------------------------------------------------
  DATABASE_URL: z.string().min(1),
  /** Optional separate role used by maintenance/repair commands (report §9.6). */
  DATABASE_MAINTENANCE_URL: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  DATABASE_POOL_MIN: z.coerce.number().int().min(0).max(20).default(3),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(300_000),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(10_000),
  DATABASE_SSL: booleanish.default(false),
  /**
   * Path to the provider's CA certificate, for hosts whose chain is not in
   * Node's default trust store. Supabase signs with its own CA and publishes
   * the certificate under Project Settings → Database → SSL Configuration.
   *
   * The alternative is `rejectUnauthorized: false`, which reduces TLS to
   * encryption without authentication: anything able to intercept the
   * connection could present its own certificate and read every query. For a
   * database reached across the public internet that is not a trade worth
   * making, so the CA is supplied and verification stays on.
   */
  DATABASE_CA_CERT: z.string().optional(),

  // --- Secrets -------------------------------------------------------------
  /** Signs session cookies and public approval sessions. 32+ bytes. */
  SESSION_SECRET: z.string().min(32),
  /** Keyed hash for IP pseudonymisation in evidence (report §12.3). */
  PRIVACY_HASH_SECRET: z.string().min(32),
  /** Signs local object-store URLs when STORAGE_DRIVER=local. */
  STORAGE_URL_SECRET: z.string().min(32),

  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(12),
  PUBLIC_SESSION_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(60),

  // --- Auth ----------------------------------------------------------------
  /** `local` = first-party magic link (dev/self-host). `supabase`/`clerk` = managed. */
  AUTH_DRIVER: z.enum(['local', 'supabase', 'clerk']).default('local'),
  AUTH_JWKS_URL: z.string().url().optional(),
  AUTH_JWT_ISSUER: z.string().optional(),
  AUTH_JWT_AUDIENCE: z.string().optional(),
  AUTH_WEBHOOK_SECRET: z.string().optional(),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  /**
   * "Continue with Google". Absent means the button is not offered — the sign-in
   * page asks the API what is configured rather than showing a control that
   * cannot work.
   */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // --- Object storage ------------------------------------------------------
  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  STORAGE_BUCKET: z.string().default('extrawork-local'),
  STORAGE_REGION: z.string().default('ap-south-1'),
  STORAGE_ENDPOINT: z.string().url().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_FORCE_PATH_STYLE: booleanish.default(true),
  /** Filesystem root when STORAGE_DRIVER=local. Never web-served directly. */
  STORAGE_LOCAL_ROOT: z.string().default('./.data/storage'),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(15 * 1024 * 1024),
  MAX_ATTACHMENTS_PER_VERSION: z.coerce.number().int().min(1).max(50).default(12),

  // --- Messaging -----------------------------------------------------------
  /**
   * MVP default is native share; report §10.3 Phase 0. `simulator` records
   * outbound messages to disk and accepts injected inbound ones so the whole
   * WhatsApp flow is runnable without a Meta account. It is rejected in
   * production by `assertProductionSafe`.
   */
  WHATSAPP_DRIVER: z.enum(['native-share', 'cloud-api', 'simulator']).default('native-share'),
  /** Where the simulator writes `outbox.jsonl`. */
  WHATSAPP_SIMULATOR_DIR: z.string().default('./.data/whatsapp'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),

  EMAIL_DRIVER: z.enum(['console', 'file', 'smtp']).default('console'),
  EMAIL_FROM: z.string().default('ExtraWork <no-reply@extrawork.local>'),
  EMAIL_OUTBOX_DIR: z.string().default('./.data/mail'),
  SMTP_URL: z.string().optional(),

  OTP_DRIVER: z.enum(['console', 'sms-provider']).default('console'),
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),

  PAYMENTS_DRIVER: z.enum(['disabled', 'razorpay']).default('disabled'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  ESIGN_DRIVER: z.enum(['disabled']).default('disabled'),

  // --- Worker --------------------------------------------------------------
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  /** Enables the in-process scheduler that enqueues recurring maintenance jobs. */
  WORKER_SCHEDULER_ENABLED: booleanish.default(true),
  PDF_TIMEOUT_MS: z.coerce.number().int().min(5000).max(600_000).default(120_000),

  // --- Policy defaults -----------------------------------------------------
  APPROVAL_TOKEN_MAX_LIFETIME_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /**
   * How long an approval link stays usable. Seven days: long enough for a
   * customer who is travelling, short enough that a forgotten link does not
   * stay live for a fortnight. The message renders the resulting date rather
   * than the word "week", so the two can never disagree.
   */
  DEFAULT_REQUEST_EXPIRY_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  REMINDER_LOCAL_HOUR_START: z.coerce.number().int().min(0).max(23).default(9),
  REMINDER_LOCAL_HOUR_END: z.coerce.number().int().min(0).max(23).default(20),

  // --- Observability -------------------------------------------------------
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: booleanish.default(false),
  SERVICE_NAME: z.string().default('extrawork'),
  RATE_LIMIT_ENABLED: booleanish.default(true),
});

export type Env = z.infer<typeof EnvSchema>;

/** Values that must never appear in a production deployment. */
const DEVELOPMENT_PLACEHOLDERS = new Set([
  'change-me-change-me-change-me-32b!',
  'dev-session-secret-not-for-production-use',
  'dev-privacy-secret-not-for-production-use',
  'dev-storage-secret-not-for-production-use',
]);

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function assertProductionSafe(env: Env): void {
  if (env.APP_ENV !== 'production') return;
  const problems: string[] = [];

  for (const key of ['SESSION_SECRET', 'PRIVACY_HASH_SECRET', 'STORAGE_URL_SECRET'] as const) {
    if (DEVELOPMENT_PLACEHOLDERS.has(env[key])) {
      problems.push(`${key} still holds a development placeholder`);
    }
  }
  if (env.STORAGE_DRIVER === 'local') {
    problems.push('STORAGE_DRIVER=local is not permitted in production; use S3-compatible storage');
  }
  if (env.EMAIL_DRIVER === 'console' || env.EMAIL_DRIVER === 'file') {
    problems.push(`EMAIL_DRIVER=${env.EMAIL_DRIVER} cannot deliver mail in production`);
  }
  if (env.AUTH_DRIVER === 'local') {
    problems.push(
      'AUTH_DRIVER=local is a self-host/dev driver; use a managed provider in production',
    );
  }
  if (!env.DATABASE_SSL) {
    problems.push('DATABASE_SSL must be enabled in production (report §11.3)');
  }
  if (env.WHATSAPP_DRIVER === 'cloud-api' && !env.WHATSAPP_APP_SECRET) {
    problems.push('WHATSAPP_APP_SECRET is required to verify Cloud API webhooks');
  }
  if (env.WHATSAPP_DRIVER === 'simulator') {
    // The simulator accepts unauthenticated inbound messages by design. In
    // production that is an open door to raise a request as anybody.
    problems.push('WHATSAPP_DRIVER=simulator accepts unsigned inbound messages; use cloud-api');
  }
  if (env.PAYMENTS_DRIVER === 'razorpay' && !env.RAZORPAY_WEBHOOK_SECRET) {
    problems.push('RAZORPAY_WEBHOOK_SECRET is required to verify payment webhooks');
  }

  if (problems.length > 0) {
    throw new ConfigError(`Unsafe production configuration:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * Local-filesystem paths that must mean the same directory in every process.
 *
 * The api, worker and web processes each run with their own working directory,
 * so a relative path like `./.data/whatsapp` resolves to three different
 * folders. That is invisible until one process writes a file another is trying
 * to read — the worker delivers a WhatsApp message to `apps/worker/.data` while
 * the api serves the outbox from `apps/api/.data`, and the message looks lost.
 *
 * Anchoring these to the directory holding `.env` gives every process the same
 * answer, because they already all agree on which `.env` they loaded. Absolute
 * paths are left exactly as given.
 */
const REPO_RELATIVE_PATHS = [
  'STORAGE_LOCAL_ROOT',
  'EMAIL_OUTBOX_DIR',
  'WHATSAPP_SIMULATOR_DIR',
  // Each CLI runs from its own package directory, so a repo-relative cert path
  // resolves differently for `db:migrate` than for the root scripts.
  'DATABASE_CA_CERT',
] as const;

function anchorLocalPaths(env: Env, envFilePath: string | null): Env {
  if (!envFilePath) return env;
  const root = path.dirname(envFilePath);
  const anchored: Record<string, unknown> = { ...env };
  for (const key of REPO_RELATIVE_PATHS) {
    const value = env[key];
    if (typeof value === 'string' && value.length > 0 && !path.isAbsolute(value)) {
      anchored[key] = path.resolve(root, value);
    }
  }
  return anchored as Env;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Env {
  const envFilePath = source === process.env ? loadEnvFile() : null;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${detail}`);
  }
  const env = anchorLocalPaths(parsed.data, envFilePath);
  assertProductionSafe(env);
  return env;
}

let cached: Env | undefined;

/** Memoised config for long-lived processes. */
export function config(): Env {
  cached ??= loadConfig();
  return cached;
}

/** Test helper: drop the memoised value so a new env can be loaded. */
export function resetConfigCache(): void {
  cached = undefined;
}

export { loadEnvFile } from './dotenv.js';
