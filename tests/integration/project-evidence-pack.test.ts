import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { JobRow } from '@extrawork/db';
import type { Container } from '@extrawork/runtime';
import {
  createSentChangeOrder,
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';
import { workerContext } from '../../apps/worker/src/context.js';
import { generateExport } from '../../apps/worker/src/jobs/exports.js';
import type { PdfRenderer } from '../../apps/worker/src/pdf/renderer.js';

let container: Container;
let tenant: TenantFixture;
let renderedHtml = '';

const pdfStub: PdfRenderer = {
  render: async (html) => {
    renderedHtml = html;
    return Buffer.from('%PDF-1.7\ncombined project evidence test\n', 'utf8');
  },
  rendererVersion: async () => 'chromium/test',
  close: async () => undefined,
};

beforeAll(() => {
  container = createTestContainer();
});

afterAll(async () => {
  await container.close();
});

beforeEach(async () => {
  await truncateAll(container);
  tenant = await createTenant(container, { name: 'Combined Evidence Ltd' });
  renderedHtml = '';
});

function exportJob(exportId: string, payload: Record<string, unknown>): JobRow {
  return {
    id: randomUUID(),
    organizationId: tenant.organizationId,
    kind: 'generate_export',
    payload,
    attemptCount: 1,
    maxAttempts: 6,
    dedupeKey: `export:${exportId}`,
    createdAt: new Date(),
  };
}

async function requestPack(): Promise<string> {
  return container.uow.transaction((tx) =>
    container.repos.documents.requestExport(tx, tenant.owner.tenant, {
      projectId: tenant.projectId,
      kind: 'PROJECT_EVIDENCE_PACK',
      templateVersion: 'evidence-pack-v1',
    }),
  );
}

describe('combined project evidence export', () => {
  it('renders every frozen version into one PDF and stores a verifiable combined manifest', async () => {
    const first = await createSentChangeOrder(container, tenant, {
      title: 'Kitchen electrical variation',
    });
    const second = await createSentChangeOrder(container, tenant, {
      title: 'Programme extension',
      scheduleDeltaDays: 7,
    });
    const exportId = await requestPack();

    await generateExport(
      exportJob(exportId, { exportId, organizationId: tenant.organizationId }),
      workerContext(container, pdfStub),
    );

    const document = await container.repos.documents.findById(tenant.owner.tenant, exportId);
    expect(document).toMatchObject({
      id: exportId,
      kind: 'PROJECT_EVIDENCE_PACK',
      status: 'READY',
      rendererVersion: 'chromium/test',
      generatorVersion: 'project-evidence-generator-v1',
    });
    expect(document?.storageKey).toMatch(/\.pdf$/);
    expect(document?.manifestSha256).toHaveLength(32);

    const records = document?.manifest?.records as Array<Record<string, unknown>>;
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.versionId)).toEqual([
      first.changeOrder.version.id,
      second.changeOrder.version.id,
    ]);
    expect(records.every((record) => typeof record.manifestSha256 === 'string')).toBe(true);

    expect(renderedHtml).toContain('Complete project evidence pack');
    expect(renderedHtml).toContain('Kitchen electrical variation');
    expect(renderedHtml).toContain('Programme extension');
    expect(renderedHtml.match(/Change record/g)).toHaveLength(2);

    const stored = await container.appContext.objectStore.get(document!.storageKey!);
    expect(stored.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('produces an honest empty-project PDF instead of a CSV or a mislabeled ZIP', async () => {
    const exportId = await requestPack();

    await generateExport(
      exportJob(exportId, { exportId, organizationId: tenant.organizationId }),
      workerContext(container, pdfStub),
    );

    const document = await container.repos.documents.findById(tenant.owner.tenant, exportId);
    expect(document?.status).toBe('READY');
    expect(document?.storageKey).toMatch(/\.pdf$/);
    expect(document?.manifest?.records).toEqual([]);
    expect(renderedHtml).toContain('No frozen change records exist for this project yet.');
  });

  it('dead-letters the old documentId payload shape without issuing an invalid SQL lookup', async () => {
    const exportId = await requestPack();
    const run = generateExport(
      exportJob(exportId, { documentId: exportId, organizationId: tenant.organizationId }),
      workerContext(container, pdfStub),
    );

    await expect(run).rejects.toMatchObject({
      code: 'INVALID_JOB_PAYLOAD',
    });
    const document = await container.repos.documents.findById(tenant.owner.tenant, exportId);
    expect(document?.status).toBe('PENDING');
  });
});
