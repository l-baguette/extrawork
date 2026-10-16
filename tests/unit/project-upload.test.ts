import { describe, expect, it } from 'vitest';
import type { ProjectDocumentDto } from '@extrawork/contracts';
import { ApiError } from '../../apps/web/src/lib/api.js';
import {
  ProjectUploadError,
  describeUploadFailure,
  uploadProjectFile,
  type ProjectUploadDeps,
  type UploadProgress,
} from '../../apps/web/src/lib/project-upload.js';

/**
 * The project-folder upload sequence (spec 2026-10-12, D10–D11), driven with
 * fakes so the order of calls and what happens on refusal are pinned down.
 */

const FILE_ID = '00000000-0000-4000-8000-000000000001';
const target = {
  projectId: '00000000-0000-4000-8000-0000000000aa',
  folderId: '00000000-0000-4000-8000-0000000000bb',
};

function fakeFile(name: string, type: string, text = 'Item,Qty\nTiles,40\n') {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: () => Promise.resolve(bytes.buffer as ArrayBuffer),
  };
}

function harness(scans: Array<{ scanStatus: string; scanDetail: string | null }>) {
  const calls: Array<{ path: string; body?: unknown }> = [];
  let scanIndex = 0;
  const deps: ProjectUploadDeps = {
    poll: { attempts: 3, sleep: () => Promise.resolve() },
    put: (_upload, _bytes, onProgress) => {
      calls.push({ path: 'PUT' });
      onProgress(0.5);
      onProgress(1);
      return Promise.resolve();
    },
    api: (<T>(path: string, options: { body?: unknown } = {}) => {
      calls.push({ path, body: options.body });
      if (path === '/v1/uploads') {
        return Promise.resolve({
          fileObjectId: FILE_ID,
          uploadUrl: 'https://storage.example/put',
          method: 'PUT',
          headers: { 'Content-Type': 'text/csv' },
          expiresAt: new Date().toISOString(),
        } as T);
      }
      if (path === '/v1/uploads/complete') return Promise.resolve({ id: FILE_ID } as T);
      if (path === `/v1/files/${FILE_ID}`) {
        const scan = scans[Math.min(scanIndex, scans.length - 1)];
        scanIndex += 1;
        return Promise.resolve(scan as T);
      }
      if (path.endsWith('/documents')) {
        return Promise.resolve({ id: 'doc', title: 'boq.csv' } as unknown as T);
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    }) as ProjectUploadDeps['api'],
  };
  return { calls, deps };
}

describe('uploadProjectFile', () => {
  it('presigns, uploads, completes, waits for a clean scan, then files it', async () => {
    const { calls, deps } = harness([
      { scanStatus: 'PENDING', scanDetail: null },
      { scanStatus: 'CLEAN', scanDetail: null },
    ]);
    const stages: UploadProgress[] = [];
    const document = (await uploadProjectFile(
      fakeFile('boq.csv', 'text/csv'),
      target,
      (p) => stages.push(p),
      deps,
    )) as ProjectDocumentDto;

    expect(document.id).toBe('doc');
    expect(calls.map((c) => c.path)).toEqual([
      '/v1/uploads',
      'PUT',
      '/v1/uploads/complete',
      `/v1/files/${FILE_ID}`,
      `/v1/files/${FILE_ID}`,
      `/v1/projects/${target.projectId}/documents`,
    ]);
    expect(calls[0]?.body).toMatchObject({
      purpose: 'PROJECT_DOCUMENT',
      projectId: target.projectId,
      contentType: 'text/csv',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(calls.at(-1)?.body).toEqual({
      kind: 'FILE',
      folderId: target.folderId,
      fileObjectId: FILE_ID,
    });
    expect(stages.map((s) => s.stage)).toEqual([
      'UPLOADING',
      'UPLOADING',
      'UPLOADING',
      'CHECKING',
      'FILING',
      'DONE',
    ]);
    expect(stages[2]?.fraction).toBe(1);
  });

  it('never files a file the scan refused, and says why', async () => {
    const { calls, deps } = harness([
      {
        scanStatus: 'REJECTED',
        scanDetail:
          'Older .xls/.doc files can carry macros. Save it as .xlsx or .docx and upload it again.',
      },
    ]);
    const attempt = uploadProjectFile(
      fakeFile('boq.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      target,
      undefined,
      deps,
    );
    await expect(attempt).rejects.toMatchObject({ refused: true, message: /Save it as .xlsx/ });
    expect(calls.some((c) => c.path.endsWith('/documents'))).toBe(false);
  });

  it('files it anyway when the scan has no verdict in time', async () => {
    const { calls, deps } = harness([{ scanStatus: 'PENDING', scanDetail: null }]);
    await uploadProjectFile(fakeFile('notes.txt', 'text/plain'), target, undefined, deps);
    expect(calls.at(-1)?.path).toBe(`/v1/projects/${target.projectId}/documents`);
  });

  it('refuses before any network call when the type is not accepted', async () => {
    const { calls, deps } = harness([]);
    await expect(
      uploadProjectFile(fakeFile('macro.xlsm', ''), target, undefined, deps),
    ).rejects.toMatchObject({ refused: true, message: /without macros/ });
    await expect(
      uploadProjectFile(fakeFile('clip.mp4', 'video/mp4'), target, undefined, deps),
    ).rejects.toBeInstanceOf(ProjectUploadError);
    expect(calls).toEqual([]);
  });

  it('accepts a DWG the phone reported with no type', async () => {
    const { calls, deps } = harness([{ scanStatus: 'CLEAN', scanDetail: null }]);
    await uploadProjectFile(fakeFile('ground-floor.dwg', ''), target, undefined, deps);
    expect(calls[0]?.body).toMatchObject({ contentType: 'application/acad' });
  });
});

describe('describeUploadFailure', () => {
  it('turns a quota refusal into something a person can act on', () => {
    const error = describeUploadFailure(
      new ApiError(507, {
        code: 'STORAGE_QUOTA_EXCEEDED',
        message: 'quota',
        requestId: 'req_1',
      }),
    );
    expect(error.refused).toBe(true);
    expect(error.message).toMatch(/out of storage/);
  });

  it('keeps a reference for unexpected errors and marks them retryable', () => {
    const error = describeUploadFailure(
      new ApiError(500, { code: 'INTERNAL_ERROR', message: 'Boom.', requestId: 'req_2' }),
    );
    expect(error.refused).toBe(false);
    expect(error.message).toContain('req_2');
    expect(describeUploadFailure(new TypeError('network')).refused).toBe(false);
  });
});
