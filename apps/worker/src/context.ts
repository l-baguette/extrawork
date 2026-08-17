import type { AppContext, Services } from '@extrawork/application';
import type { Database, Repositories } from '@extrawork/db';
import type { Container } from '@extrawork/runtime';
import type { Logger } from '@extrawork/observability';
import type { Env } from '@extrawork/config';
import type { PdfRenderer } from './pdf/renderer.js';

/**
 * What a job handler is given. Deliberately narrow: handlers get the same
 * application services the API uses, so domain rules cannot diverge between the
 * two processes (report §5.2 — the worker must not accept customer decisions or
 * re-implement domain state).
 */
export interface WorkerContext {
  env: Env;
  db: Database;
  repos: Repositories;
  services: Services;
  app: AppContext;
  logger: Logger;
  pdf: PdfRenderer;
}

export function workerContext(container: Container, pdf: PdfRenderer): WorkerContext {
  return {
    env: container.env,
    db: container.uow.db,
    repos: container.repos,
    services: container.services,
    app: container.appContext,
    logger: container.logger,
    pdf,
  };
}
