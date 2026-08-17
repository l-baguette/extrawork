import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@extrawork/application';
import { oldestUnpublishedAgeSeconds, queueDepth } from '@extrawork/db';
import { metrics, METRIC } from '@extrawork/observability';

/**
 * Health and metrics — report §11.5 and §13.5.
 *
 *  /healthz  liveness: is the process up? Never touches the database, so a
 *            database blip does not cause the orchestrator to kill a healthy
 *            process that could still serve cached reads.
 *  /readyz   readiness: can this instance serve traffic? Checks the database.
 *  /metrics  Prometheus exposition of the SLIs the report lists.
 */
export async function registerHealthRoutes(
  app: FastifyInstance,
  appContext: AppContext,
): Promise<void> {
  const startedAt = Date.now();

  app.get('/', async () => ({
    status: 'ok',
    service: `${app.env.SERVICE_NAME}-api`,
    message: 'ExtraWork API is running. Open the web application to use ExtraWork.',
    webApplication: app.env.WEB_PUBLIC_URL,
    health: `${app.env.API_PUBLIC_URL}/healthz`,
    readiness: `${app.env.API_PUBLIC_URL}/readyz`,
  }));

  app.get('/healthz', async () => ({
    status: 'ok',
    service: `${app.env.SERVICE_NAME}-api`,
    environment: app.env.APP_ENV,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }));

  app.get('/readyz', async (_request, reply) => {
    const database = await appContext.uow.healthCheck();
    const ready = database.ok;
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not-ready',
      checks: {
        database: { ok: database.ok, latencyMs: database.latencyMs },
        storage: { driver: app.env.STORAGE_DRIVER },
        messaging: { whatsapp: app.env.WHATSAPP_DRIVER, email: app.env.EMAIL_DRIVER },
      },
    });
  });

  app.get('/metrics', async (_request, reply) => {
    // Refresh the gauges that describe queue health (report §13.5 SLIs).
    const [oldestOutbox, depths] = await Promise.all([
      oldestUnpublishedAgeSeconds(appContext.uow.db),
      queueDepth(appContext.uow.db),
    ]);
    metrics.gauge(
      METRIC.OUTBOX_OLDEST_SECONDS,
      'Age of the oldest unpublished outbox event',
      oldestOutbox,
    );
    for (const depth of depths) {
      metrics.gauge(METRIC.JOB_QUEUE_DEPTH, 'Pending jobs by kind', depth.pending, {
        kind: depth.kind,
        state: 'pending',
      });
      metrics.gauge(METRIC.JOB_QUEUE_DEPTH, 'Pending jobs by kind', depth.deadLetter, {
        kind: depth.kind,
        state: 'dead_letter',
      });
      metrics.gauge(
        METRIC.JOB_OLDEST_SECONDS,
        'Age of the oldest available job',
        depth.oldestAvailableSeconds,
        { kind: depth.kind },
      );
    }

    return reply
      .header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(metrics.render());
  });
}
