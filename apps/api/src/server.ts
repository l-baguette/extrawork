import { buildApp } from './app.js';
import { createContainer } from '@extrawork/runtime';

/**
 * API process entry point. The worker is a separate process from the same
 * image (report §5.1, §11.1).
 */
const container = createContainer({ applicationName: 'extrawork-api' });

// Establish the small baseline pool before accepting traffic. With a remote
// database, letting the first dashboard request open these connections makes
// that user pay several seconds of TLS setup even though the query is fast.
await container.uow.warm();

const app = await buildApp({
  env: container.env,
  uow: container.uow,
  repos: container.repos,
  services: container.services,
  appContext: container.appContext,
  logger: container.logger,
});

async function shutdown(signal: string): Promise<void> {
  container.logger.info({ signal }, 'shutting down api');
  try {
    // Stop accepting connections first, then drain the pool, so an in-flight
    // decision transaction is allowed to commit.
    await app.close();
    await container.close();
    process.exit(0);
  } catch (error) {
    container.logger.error({ err: error }, 'shutdown failed');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  container.logger.error({ err: reason }, 'unhandled rejection');
});

try {
  await app.listen({ port: container.env.API_PORT, host: container.env.API_HOST });
  container.logger.info(
    {
      port: container.env.API_PORT,
      environment: container.env.APP_ENV,
      storage: container.env.STORAGE_DRIVER,
      whatsapp: container.env.WHATSAPP_DRIVER,
      auth: container.env.AUTH_DRIVER,
    },
    'extrawork api listening',
  );
} catch (error) {
  container.logger.fatal({ err: error }, 'failed to start api');
  process.exit(1);
}
