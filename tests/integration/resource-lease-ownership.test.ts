import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { JobRow } from '@extrawork/db';
import type { Container } from '@extrawork/runtime';
import {
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';
import { workerContext } from '../../apps/worker/src/context.js';
import { scanFile } from '../../apps/worker/src/jobs/files.js';
import type { PdfRenderer } from '../../apps/worker/src/pdf/renderer.js';

const pdfStub: PdfRenderer = {
  render: () => Promise.reject(new Error('file scans must not render PDFs')),
  rendererVersion: () => Promise.resolve('test-renderer'),
  close: () => Promise.resolve(),
};

function scanJob(fileObjectId: string, attemptCount: number): JobRow {
  return {
    id: randomUUID(),
    organizationId: tenant.organizationId,
    kind: 'scan_file',
    payload: { fileObjectId, organizationId: tenant.organizationId },
    attemptCount,
    maxAttempts: 6,
    dedupeKey: `scan:${fileObjectId}`,
    createdAt: new Date(),
  };
}

let container: Container;
let tenant: TenantFixture;

beforeAll(() => {
  container = createTestContainer();
});

afterAll(async () => {
  await container.close();
});

beforeEach(async () => {
  await truncateAll(container);
  tenant = await createTenant(container, { name: 'Lease Ownership Builders' });
});

describe('file scan lease ownership', () => {
  it('reclaims an expired scan and rejects the stale worker verdict', async () => {
    const file = await container.uow.transaction(async (tx) => {
      const registered = await container.repos.files.register(tx, tenant.owner.tenant, {
        projectId: tenant.projectId,
        storageKey: `quarantine/${tenant.organizationId}/lease-test.jpg`,
        filename: 'lease-test.jpg',
        declaredMimeType: 'image/jpeg',
        byteSize: 16n,
        purpose: 'CHANGE_ATTACHMENT',
        sha256: null,
      });
      await container.repos.files.markUploaded(tx, tenant.owner.tenant, registered.id);
      return registered;
    });

    await expect(
      container.repos.files.claimForScan(
        container.uow.db,
        tenant.organizationId,
        file.id,
        'scan-attempt-1',
        60,
      ),
    ).resolves.toBe(true);
    await container.uow.pool.query(
      `UPDATE file_objects SET scan_leased_until = now() - interval '1 second' WHERE id = $1`,
      [file.id],
    );
    await expect(
      container.repos.files.claimForScan(
        container.uow.db,
        tenant.organizationId,
        file.id,
        'scan-attempt-2',
        60,
      ),
    ).resolves.toBe(true);

    const verdict = {
      status: 'CLEAN' as const,
      detail: null,
      detectedMimeType: 'image/jpeg',
      sha256: Buffer.alloc(32, 1),
      promotedStorageKey: 'source/lease-test.jpg',
      derivativeStorageKey: null,
      imageWidth: null,
      imageHeight: null,
      storageVersion: 'version-2',
    };
    await expect(
      container.repos.files.recordScanResult(
        container.uow.db,
        tenant.organizationId,
        file.id,
        'scan-attempt-1',
        verdict,
      ),
    ).resolves.toBe(false);
    await expect(
      container.repos.files.recordScanResult(
        container.uow.db,
        tenant.organizationId,
        file.id,
        'scan-attempt-2',
        verdict,
      ),
    ).resolves.toBe(true);

    const stored = await container.repos.files.requireById(tenant.owner.tenant, file.id);
    expect(stored.scanStatus).toBe('CLEAN');
    expect(stored.scanLeaseToken).toBeNull();
    expect(stored.scanAttemptCount).toBe(2);
  });

  it('retries a scanner outage instead of completing the job with FAILED', async () => {
    const bytes = Buffer.from('%PDF-1.7\nstatic test document\n', 'utf8');
    const file = await container.uow.transaction(async (tx) => {
      const registered = await container.repos.files.register(tx, tenant.owner.tenant, {
        projectId: tenant.projectId,
        storageKey: `quarantine/${tenant.organizationId}/retry.pdf`,
        filename: 'retry.pdf',
        declaredMimeType: 'application/pdf',
        byteSize: BigInt(bytes.byteLength),
        purpose: 'CHANGE_ATTACHMENT',
        sha256: null,
      });
      await container.appContext.objectStore.put(registered.storageKey, bytes, 'application/pdf');
      await container.repos.files.markUploaded(tx, tenant.owner.tenant, registered.id);
      return registered;
    });

    let attempts = 0;
    container.appContext.scanner.scan = async () => {
      attempts += 1;
      return attempts === 1
        ? { verdict: 'FAILED', detail: 'clamd unavailable', scannerName: 'test-clamd' }
        : { verdict: 'CLEAN', detail: null, scannerName: 'test-clamd' };
    };

    await expect(scanFile(scanJob(file.id, 1), workerContext(container, pdfStub))).rejects.toThrow(
      'clamd unavailable',
    );
    expect((await container.repos.files.requireById(tenant.owner.tenant, file.id)).scanStatus).toBe(
      'FAILED',
    );

    await scanFile(scanJob(file.id, 2), workerContext(container, pdfStub));
    const recovered = await container.repos.files.requireById(tenant.owner.tenant, file.id);
    expect(recovered.scanStatus).toBe('CLEAN');
    expect(recovered.scanAttemptCount).toBe(2);
  });
});

describe('generated document lease ownership', () => {
  it('reclaims an expired generation and rejects stale ready/failure writes', async () => {
    const documentId = await container.uow.transaction((tx) =>
      container.repos.documents.requestExport(tx, tenant.owner.tenant, {
        projectId: tenant.projectId,
        kind: 'ACCOUNTING_CSV',
        templateVersion: 'accounting-csv-v1',
      }),
    );

    await expect(
      container.repos.documents.claimForGeneration(
        container.uow.db,
        tenant.organizationId,
        documentId,
        'document-attempt-1',
        60,
      ),
    ).resolves.toBe(true);
    await container.uow.pool.query(
      `UPDATE generated_documents
          SET generation_leased_until = now() - interval '1 second'
        WHERE id = $1`,
      [documentId],
    );
    await expect(
      container.repos.documents.claimForGeneration(
        container.uow.db,
        tenant.organizationId,
        documentId,
        'document-attempt-2',
        60,
      ),
    ).resolves.toBe(true);

    const ready = {
      storageKey: 'exports/current.csv',
      fileSha256: Buffer.alloc(32, 2),
      byteSize: 12n,
      rendererVersion: 'none',
      generatorVersion: 'test-v1',
      storageObjectVersion: 'object-v2',
      manifest: { kind: 'test' },
      manifestSha256: Buffer.alloc(32, 3),
    };
    await expect(
      container.repos.documents.markReady(
        container.uow.db,
        tenant.organizationId,
        documentId,
        'document-attempt-1',
        ready,
      ),
    ).resolves.toBe(false);
    await expect(
      container.repos.documents.markReady(
        container.uow.db,
        tenant.organizationId,
        documentId,
        'document-attempt-2',
        ready,
      ),
    ).resolves.toBe(true);
    await expect(
      container.repos.documents.markFailed(
        container.uow.db,
        tenant.organizationId,
        documentId,
        'document-attempt-1',
        'late stale failure',
      ),
    ).resolves.toBe(false);

    const stored = await container.repos.documents.findById(tenant.owner.tenant, documentId);
    expect(stored?.status).toBe('READY');
    expect(stored?.generationLeaseToken).toBeNull();
    expect(stored?.generationAttemptCount).toBe(2);
  });
});
