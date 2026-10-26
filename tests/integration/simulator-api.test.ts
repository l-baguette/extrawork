import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import type { Container } from '@extrawork/runtime';
import {
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * The development-only WhatsApp simulator (spec 2026-10-12, D6): it must drive
 * the same intake path as the real webhook, attachments included — staged
 * through the simulator gateway and fetched by media id once the message is
 * filed — so the whole channel can be demonstrated without Meta.
 */

let container: Container;
let app: FastifyInstance;
let tenant: TenantFixture;
const simulatorDir = mkdtempSync(join(tmpdir(), 'extrawork-sim-'));

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

beforeAll(async () => {
  container = createTestContainer({
    env: { WHATSAPP_DRIVER: 'simulator', WHATSAPP_SIMULATOR_DIR: simulatorDir },
  });
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
  rmSync(simulatorDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAll(container);
  tenant = await createTenant(container, { name: 'Simulated Interiors' });
});

async function addEmployee(phoneE164: string) {
  return container.uow.transaction((tx) =>
    container.repos.employees.create(tx, tenant.owner.tenant, {
      name: 'Ramesh Patil',
      phoneE164,
      roleNote: null,
      allProjects: true,
      maxRequestMinor: null,
      projectIds: [],
    }),
  );
}

function post(payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/webhooks/v1/simulator/whatsapp',
    headers: { 'content-type': 'application/json' },
    payload,
  });
}

describe('the WhatsApp simulator', () => {
  it('files a photo through the real fetch-and-quarantine path', async () => {
    await addEmployee('+919811100001');

    const response = await post({
      from: '98111 00001',
      body: 'Kitchen tiling progress',
      media: [{ base64: JPEG.toString('base64'), mimeType: 'image/jpeg', filename: 'kitchen.jpg' }],
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; mediaStored: number; reply: string }>();
    expect(body.status).toBe('SAVED');
    expect(body.mediaStored).toBe(1);
    expect(body.reply).toContain('Saved your file');

    const { rows } = await container.uow.pool.query<{
      original_filename: string;
      purpose: string;
      storage_key: string;
      title: string;
      notes: string | null;
    }>(
      `SELECT f.original_filename, f.purpose, f.storage_key, d.title, d.notes
         FROM file_objects f
         JOIN project_documents d ON d.file_object_id = f.id AND d.organization_id = f.organization_id
        WHERE f.organization_id = $1`,
      [tenant.organizationId],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        original_filename: 'kitchen.jpg',
        purpose: 'PROJECT_DOCUMENT',
        title: 'kitchen.jpg',
        notes: 'Kitchen tiling progress',
      }),
    ]);
    expect(rows[0]?.storage_key).toContain('quarantine/');
  });

  it('refuses an empty message but accepts a photo on its own', async () => {
    await addEmployee('+919811100002');
    const empty = await post({ from: '+919811100002', body: '' });
    expect(empty.statusCode).toBe(400);

    const photoOnly = await post({
      from: '+919811100002',
      media: [{ base64: JPEG.toString('base64'), mimeType: 'image/jpeg' }],
    });
    expect(photoOnly.statusCode).toBe(200);
    expect(photoOnly.json<{ status: string }>().status).toBe('SAVED');
  });

  it('refuses more than 2 MB of attachments', async () => {
    await addEmployee('+919811100003');
    const big = Buffer.alloc(2 * 1024 * 1024 + 16, 1).toString('base64');
    const response = await post({
      from: '+919811100003',
      body: 'too big',
      media: [{ base64: big, mimeType: 'image/jpeg' }],
    });
    expect(response.statusCode).toBe(400);
    const { rows } = await container.uow.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM file_objects',
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('lists homeowners as senders alongside site team', async () => {
    await addEmployee('+919811100004');
    const response = await app.inject({ method: 'GET', url: '/webhooks/v1/simulator/senders' });
    expect(response.statusCode).toBe(200);
    const items = response.json<{ items: Array<{ kind: string; name: string }> }>().items;
    expect(items.map((i) => i.kind).sort()).toEqual(['CONTACT', 'EMPLOYEE']);
    expect(items.find((i) => i.kind === 'CONTACT')?.name).toBe(tenant.approverName);
  });
});
