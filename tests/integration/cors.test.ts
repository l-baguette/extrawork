import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import type { Container } from '@extrawork/runtime';
import { createTestContainer } from '@extrawork/testkit';

/**
 * The web app calls the API from another origin, so every method a browser
 * uses must pass the CORS preflight. PUT was missing: saving notification
 * preferences and uploading to the local storage driver's signed URL both
 * failed in the browser with nothing in the API log, because the preflight
 * refusal never reaches a route. Found by the photo-attachment e2e spec.
 */

let container: Container;
let app: FastifyInstance;

beforeAll(async () => {
  container = createTestContainer();
  app = await buildApp({
    env: container.env,
    uow: container.uow,
    repos: container.repos,
    services: container.services,
    appContext: container.appContext,
    logger: container.logger,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await container.close();
});

function preflight(url: string, method: string, origin: string) {
  return app.inject({
    method: 'OPTIONS',
    url,
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': 'content-type,x-csrf-token',
    },
  });
}

describe('CORS preflight from the web app', () => {
  it.each([
    ['GET', '/v1/notifications'],
    ['POST', '/v1/uploads'],
    ['PATCH', '/v1/change-orders/00000000-0000-0000-0000-000000000000/draft'],
    ['PUT', '/v1/notifications/preferences'],
    ['PUT', '/v1/files/local/some-signed-key'],
    ['DELETE', '/v1/portal-links/00000000-0000-0000-0000-000000000000'],
  ])('allows %s %s with credentials', async (method, url) => {
    const origin = container.env.CORS_ALLOWED_ORIGINS[0] as string;
    const response = await preflight(url, method, origin);

    expect(response.statusCode).toBeLessThan(300);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(String(response.headers['access-control-allow-methods'])).toContain(method);
  });

  it('does not grant another origin', async () => {
    const response = await preflight(
      '/v1/notifications/preferences',
      'PUT',
      'https://evil.example',
    );
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
