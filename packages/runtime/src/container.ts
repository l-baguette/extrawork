import { loadConfig, type Env } from '@extrawork/config';
import {
  createRepositories,
  createUnitOfWork,
  type PostgresUnitOfWork,
  type Repositories,
} from '@extrawork/db';
import { createObjectStore, createScanner } from '@extrawork/files';
import { createIntegrations } from '@extrawork/integrations';
import { createLogger, type Logger } from '@extrawork/observability';
import {
  createServices,
  systemClock,
  type AppContext,
  type Clock,
  type Services,
} from '@extrawork/application';

/**
 * Composition root. Everything concrete is chosen here and injected downwards,
 * which is what keeps the dependency direction in report §14.2 enforceable.
 */

export interface Container {
  env: Env;
  logger: Logger;
  uow: PostgresUnitOfWork;
  repos: Repositories;
  services: Services;
  appContext: AppContext;
  close(): Promise<void>;
}

export interface ContainerOptions {
  env?: Env;
  logger?: Logger;
  clock?: Clock;
  applicationName?: string;
  onOtpCode?: (phoneE164: string, code: string) => void;
}

export function createContainer(options: ContainerOptions = {}): Container {
  const env = options.env ?? loadConfig();
  const logger =
    options.logger ??
    createLogger({
      service: options.applicationName ?? env.SERVICE_NAME,
      environment: env.APP_ENV,
      level: env.LOG_LEVEL,
      pretty: env.LOG_PRETTY,
    });

  const uow = createUnitOfWork({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    min: Math.min(env.DATABASE_POOL_MIN, env.DATABASE_POOL_MAX),
    idleTimeoutMs: env.DATABASE_IDLE_TIMEOUT_MS,
    connectionTimeoutMs: env.DATABASE_CONNECTION_TIMEOUT_MS,
    ssl: env.DATABASE_SSL,
    ...(env.DATABASE_CA_CERT ? { caCertPath: env.DATABASE_CA_CERT } : {}),
    applicationName: options.applicationName ?? env.SERVICE_NAME,
  });

  const repos = createRepositories(uow.db, {
    rateLimitEnabled: env.RATE_LIMIT_ENABLED,
    // The local API talks across continents to hosted Postgres. A page-view
    // counter does not need that trip; production keeps the distributed limit
    // until an edge limiter replaces it.
    localAuthenticatedReads: env.APP_ENV === 'local',
  });
  const objectStore = createObjectStore(env);
  const scanner = createScanner();
  const integrations = createIntegrations(
    env,
    options.onOtpCode ? { onOtpCode: options.onOtpCode } : {},
  );

  const appContext: AppContext = {
    env,
    uow,
    repos,
    integrations,
    objectStore,
    scanner,
    logger,
    clock: options.clock ?? systemClock,
  };

  const services = createServices(appContext);

  return {
    env,
    logger,
    uow,
    repos,
    services,
    appContext,
    close: async () => {
      await uow.close();
    },
  };
}
