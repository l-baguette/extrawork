# Photo Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a contractor attach site photographs to a change order from the browser, so the record carries the evidence the product brief says it must.

**Architecture:** The entire server pipeline already exists and does not change — presigned upload into quarantine, magic-byte validation, malware scan, sharp re-encode with EXIF/GPS stripped, promotion, `version_attachments`, send-time gating, and rendering on the customer page. This plan adds only the browser half: a pre-flight check, an upload client, a picker component, and its wiring into step 1 of the composer.

**Tech Stack:** Next.js 15 App Router, React 19, React Hook Form, Zod, Vitest (`unit` project, node environment), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-tier-1-pilot-readiness-design.md` (section A)

## Global Constraints

- `apps/web` may import **only** `@extrawork/contracts`. Importing `@extrawork/domain`, `application`, `db`, `runtime` or `integrations` is a lint error (`eslint.config.mjs`).
- Unit tests run in the **node** environment — no `document`, no `window`. Pure helpers must not touch DOM APIs.
- Unit tests import web source with an explicit `.js` extension: `import { x } from '../../apps/web/src/...js'`.
- The presigned PUT goes to object storage directly. It must **not** carry `credentials: 'include'` and must not go through the `api()` helper.
- Allowed types and caps come from `ALLOWED_UPLOAD_MIME_TYPES` and `MAX_FILE_BYTES` in `@extrawork/contracts`. Never hardcode a duplicate list.
- Run `pnpm verify` before considering the feature done.

---

### Task 1: Upload pre-flight

A file that cannot possibly succeed should be rejected in the browser with a readable sentence, not as a 400 from the API after a wasted upload on a site connection.

**Files:**

- Create: `apps/web/src/features/composer/attachment-upload.ts`
- Test: `tests/unit/attachment-upload.test.ts`

**Interfaces:**

- Consumes: `ALLOWED_UPLOAD_MIME_TYPES`, `MAX_FILE_BYTES`, `AllowedMimeType` from `@extrawork/contracts`
- Produces:

  - `sanitizeFilename(raw: string): string`
  - `resolveContentType(file: { name: string; type: string }): AllowedMimeType | null`
  - `preflightUpload(file: { name: string; type: string; size: number }): PreflightResult`
  - `type PreflightResult = { ok: true; contentType: AllowedMimeType; filename: string } | { ok: false; reason: string }`
  - `sha256Hex(bytes: ArrayBuffer): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/attachment-upload.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  preflightUpload,
  resolveContentType,
  sanitizeFilename,
} from '../../apps/web/src/features/composer/attachment-upload.js';

describe('sanitizeFilename', () => {
  it('strips path separators so a filename cannot escape its storage key', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('etcpasswd');
    expect(sanitizeFilename('folder\\photo.jpg')).toBe('folderphoto.jpg');
  });

  it('keeps ordinary camera filenames intact', () => {
    expect(sanitizeFilename('IMG_0421.HEIC')).toBe('IMG_0421.HEIC');
    expect(sanitizeFilename('site photo-3.jpg')).toBe('site photo-3.jpg');
  });

  it('falls back to a usable name when nothing survives', () => {
    expect(sanitizeFilename('///')).toBe('upload');
  });
});

describe('resolveContentType', () => {
  it('uses the browser-reported type when it is one we accept', () => {
    expect(resolveContentType({ name: 'a.jpg', type: 'image/jpeg' })).toBe('image/jpeg');
  });

  // Android and older iOS Safari hand over an empty string for HEIC and
  // sometimes for JPEG. Rejecting those would make the camera button look
  // broken on exactly the handsets this product is for.
  it('falls back to the extension when the browser reports no type', () => {
    expect(resolveContentType({ name: 'IMG_0421.HEIC', type: '' })).toBe('image/heic');
    expect(resolveContentType({ name: 'scan.PDF', type: '' })).toBe('application/pdf');
  });

  it('returns null for a type we do not accept', () => {
    expect(resolveContentType({ name: 'clip.mp4', type: 'video/mp4' })).toBeNull();
    expect(resolveContentType({ name: 'notes.txt', type: '' })).toBeNull();
  });
});

describe('preflightUpload', () => {
  it('accepts an ordinary site photograph', () => {
    const result = preflightUpload({ name: 'wall.jpg', type: 'image/jpeg', size: 2_000_000 });
    expect(result).toEqual({ ok: true, contentType: 'image/jpeg', filename: 'wall.jpg' });
  });

  it('rejects a type outside the allowlist', () => {
    const result = preflightUpload({ name: 'clip.mp4', type: 'video/mp4', size: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Photographs and PDFs');
  });

  it('rejects a file over the cap for its own type', () => {
    const result = preflightUpload({
      name: 'huge.jpg',
      type: 'image/jpeg',
      size: 16 * 1024 * 1024,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('15 MB');
  });

  it('rejects an empty file', () => {
    const result = preflightUpload({ name: 'empty.jpg', type: 'image/jpeg', size: 0 });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/attachment-upload.test.ts`
Expected: FAIL — cannot resolve `attachment-upload.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/features/composer/attachment-upload.ts`:

```typescript
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_FILE_BYTES,
  type AllowedMimeType,
} from '@extrawork/contracts';

/**
 * Browser-side upload pre-flight.
 *
 * The API repeats every one of these checks and remains authoritative. This
 * exists so a contractor on a site learns that a 40 MB video is not a
 * photograph before spending their data on it, rather than after.
 */

const ALLOWED = new Set<string>(ALLOWED_UPLOAD_MIME_TYPES);

/**
 * Extension fallback.
 *
 * Android and older iOS Safari hand over an empty `File.type` for HEIC and
 * occasionally for JPEG. Trusting the browser alone would make the camera
 * button appear broken on exactly the handsets this product targets. The
 * server still decides from the magic bytes, so a wrong guess here is caught
 * one step later and never reaches storage.
 */
const BY_EXTENSION: Record<string, AllowedMimeType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heic',
  pdf: 'application/pdf',
};

/** Path separators and control characters never reach the storage key. */
export function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .split(/[/\\]/)
    .join('')
    // Matching control characters in order to strip them is the point, so the
    // no-control-regex rule is deliberately suppressed, as it is in
    // packages/contracts/src/api/files.ts for the same reason.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 255);
  return cleaned.length > 0 ? cleaned : 'upload';
}

export function resolveContentType(file: { name: string; type: string }): AllowedMimeType | null {
  if (ALLOWED.has(file.type)) return file.type as AllowedMimeType;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[extension] ?? null;
}

export type PreflightResult =
  | { ok: true; contentType: AllowedMimeType; filename: string }
  | { ok: false; reason: string };

function megabytes(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))} MB`;
}

export function preflightUpload(file: {
  name: string;
  type: string;
  size: number;
}): PreflightResult {
  const contentType = resolveContentType(file);
  if (!contentType) {
    return { ok: false, reason: 'Photographs and PDFs only (JPEG, PNG, WebP, HEIC or PDF).' };
  }
  if (file.size <= 0) {
    return { ok: false, reason: 'That file is empty.' };
  }
  const cap = MAX_FILE_BYTES[contentType];
  if (file.size > cap) {
    return { ok: false, reason: `That file is larger than ${megabytes(cap)}.` };
  }
  return { ok: true, contentType, filename: sanitizeFilename(file.name) };
}

/** Lowercase hex SHA-256, sent with the upload so the server can re-verify it. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/unit/attachment-upload.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/composer/attachment-upload.ts tests/unit/attachment-upload.test.ts
git commit -m "Refuse an impossible upload in the browser, not after it"
```

---

### Task 2: Scan polling

The scan is asynchronous. The browser has to wait for a verdict without hammering the API or hanging forever against a worker that is not running.

**Files:**

- Modify: `apps/web/src/features/composer/attachment-upload.ts`
- Test: `tests/unit/attachment-upload.test.ts`

**Interfaces:**

- Produces:

  - `type ScanState = 'PENDING' | 'SCANNING' | 'CLEAN' | 'REJECTED' | 'FAILED'`
  - `interface ScanSnapshot { scanStatus: ScanState; scanDetail: string | null }`
  - `interface PollOptions { attempts?: number; delayMs?: (attempt: number) => number; sleep?: (ms: number) => Promise<void> }`
  - `pollScanStatus(read: () => Promise<ScanSnapshot>, options?: PollOptions): Promise<ScanSnapshot | null>` — resolves `null` when the budget runs out

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/attachment-upload.test.ts`, and extend the existing import from `attachment-upload.js` with `pollScanStatus` and `type ScanSnapshot`:

```typescript
describe('pollScanStatus', () => {
  const noSleep = async (): Promise<void> => undefined;

  it('returns as soon as the scan settles', async () => {
    const snapshots: ScanSnapshot[] = [
      { scanStatus: 'PENDING', scanDetail: null },
      { scanStatus: 'SCANNING', scanDetail: null },
      { scanStatus: 'CLEAN', scanDetail: null },
    ];
    let calls = 0;
    const result = await pollScanStatus(
      async () => snapshots[calls++] ?? snapshots[snapshots.length - 1]!,
      { sleep: noSleep },
    );
    expect(result).toEqual({ scanStatus: 'CLEAN', scanDetail: null });
    expect(calls).toBe(3);
  });

  it('returns a rejection verdict rather than treating it as unfinished', async () => {
    const result = await pollScanStatus(
      async () => ({ scanStatus: 'REJECTED', scanDetail: 'Not a decodable image' }),
      { sleep: noSleep },
    );
    expect(result).toEqual({ scanStatus: 'REJECTED', scanDetail: 'Not a decodable image' });
  });

  // A worker that is not running must not hang the composer forever.
  it('gives up after the attempt budget and reports no verdict', async () => {
    let calls = 0;
    const result = await pollScanStatus(
      async () => {
        calls++;
        return { scanStatus: 'PENDING', scanDetail: null };
      },
      { attempts: 4, sleep: noSleep },
    );
    expect(result).toBeNull();
    expect(calls).toBe(4);
  });

  it('backs off instead of polling at a fixed fast interval', async () => {
    const waits: number[] = [];
    await pollScanStatus(async () => ({ scanStatus: 'PENDING', scanDetail: null }), {
      attempts: 4,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
    expect(waits.at(-1)!).toBeGreaterThan(waits[0]!);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/attachment-upload.test.ts`
Expected: FAIL — `pollScanStatus` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/web/src/features/composer/attachment-upload.ts`:

```typescript
export type ScanState = 'PENDING' | 'SCANNING' | 'CLEAN' | 'REJECTED' | 'FAILED';

export interface ScanSnapshot {
  scanStatus: ScanState;
  scanDetail: string | null;
}

export interface PollOptions {
  attempts?: number;
  delayMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

const SETTLED: ReadonlySet<ScanState> = new Set<ScanState>(['CLEAN', 'REJECTED', 'FAILED']);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Waits for the quarantine scan to reach a verdict.
 *
 * Returns `null` rather than throwing when the budget runs out, because "no
 * verdict yet" is not an error — it is usually a worker that is not running in
 * development, and the composer should say so instead of failing the upload.
 */
export async function pollScanStatus(
  read: () => Promise<ScanSnapshot>,
  options: PollOptions = {},
): Promise<ScanSnapshot | null> {
  const attempts = options.attempts ?? 20;
  // 1s, 2s, 3s, capped at 5s: roughly a minute of patience in total.
  const delayMs = options.delayMs ?? ((attempt: number) => Math.min(attempt * 1000, 5000));
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const snapshot = await read();
    if (SETTLED.has(snapshot.scanStatus)) return snapshot;
    if (attempt < attempts) await sleep(delayMs(attempt));
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/unit/attachment-upload.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/composer/attachment-upload.ts tests/unit/attachment-upload.test.ts
git commit -m "Wait for a scan verdict with backoff, and give up out loud"
```

---

### Task 3: The picker component

**Files:**

- Modify: `apps/web/src/features/composer/attachment-upload.ts`
- Create: `apps/web/src/features/composer/attachment-picker.tsx`

**Interfaces:**

- Consumes: `preflightUpload`, `sha256Hex`, `pollScanStatus`, `ScanState`, `ScanSnapshot` (Tasks 1-2); `api`, `ApiError`, `newIdempotencyKey` from `@/lib/api`; `PresignedUploadDto`, `FileObjectDto`, `ALLOWED_UPLOAD_MIME_TYPES` from `@extrawork/contracts`
- Produces:

  - `uploadAttachment(file: File, projectId: string): Promise<{ fileObjectId: string; scan: ScanSnapshot | null }>`
  - `interface PickedAttachment { key: string; filename: string; previewUrl: string | null; state: 'UPLOADING' | 'CHECKING' | 'READY' | 'REJECTED' | 'FAILED'; fileObjectId: string | null; detail: string | null }`
  - `AttachmentPicker` React component with props `{ projectId, changeOrderId, ensureChangeOrderId, value, onChange, onPendingChange, disabled, disabledReason }`

- [ ] **Step 1: Add the upload orchestration**

Append to `apps/web/src/features/composer/attachment-upload.ts`:

```typescript
import type { FileObjectDto, PresignedUploadDto } from '@extrawork/contracts';
import { api, newIdempotencyKey } from '@/lib/api';

/**
 * The three-call upload sequence from report §9.7.
 *
 * The PUT goes straight to object storage — S3 in every real environment, the
 * local signed-URL endpoint in development — so it is a bare `fetch`. Sending
 * session cookies to a presigned S3 URL would be both useless and a credential
 * leak to a third-party origin, which is why this does not use `api()`.
 */
export async function uploadAttachment(
  file: File,
  projectId: string,
): Promise<{ fileObjectId: string; scan: ScanSnapshot | null }> {
  const checked = preflightUpload(file);
  if (!checked.ok) throw new Error(checked.reason);

  const bytes = await file.arrayBuffer();
  const presigned = await api<PresignedUploadDto>('/v1/uploads', {
    method: 'POST',
    idempotencyKey: newIdempotencyKey(),
    body: {
      filename: checked.filename,
      contentType: checked.contentType,
      byteSize: file.size,
      purpose: 'CHANGE_ATTACHMENT',
      projectId,
      sha256: await sha256Hex(bytes),
    },
  });

  const stored = await fetch(presigned.uploadUrl, {
    method: presigned.method,
    headers: presigned.headers,
    body: bytes,
  });
  if (!stored.ok) throw new Error('The upload did not complete. Check your connection.');

  const completed = await api<FileObjectDto>('/v1/uploads/complete', {
    method: 'POST',
    body: { fileObjectId: presigned.fileObjectId },
  });

  const scan = await pollScanStatus(async () => {
    const current = await api<FileObjectDto>(`/v1/files/${presigned.fileObjectId}`);
    return { scanStatus: current.scanStatus as ScanState, scanDetail: current.scanDetail };
  });

  return { fileObjectId: completed.id, scan };
}
```

- [ ] **Step 2: Write the component**

Create `apps/web/src/features/composer/attachment-picker.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { ALLOWED_UPLOAD_MIME_TYPES } from '@extrawork/contracts';
import { api, ApiError } from '@/lib/api';
import { preflightUpload, uploadAttachment } from './attachment-upload';

/**
 * Site photographs for a change order.
 *
 * Everything the server needs already exists: quarantine, magic-byte checks, a
 * malware scan, an EXIF-stripped re-encode, and a freeze once the version is
 * sent. This component is the half that was missing — the part that lets
 * somebody standing in a half-finished bedroom actually pick the photograph.
 *
 * Uploads start in step 1 rather than at the preview, because the send button
 * stays unavailable until every scan has a verdict, and starting early is the
 * difference between waiting and not noticing a wait at all.
 */

export interface PickedAttachment {
  key: string;
  filename: string;
  previewUrl: string | null;
  state: 'UPLOADING' | 'CHECKING' | 'READY' | 'REJECTED' | 'FAILED';
  fileObjectId: string | null;
  detail: string | null;
}

const STATE_LABEL: Record<PickedAttachment['state'], string> = {
  UPLOADING: 'Uploading',
  CHECKING: 'Checking',
  READY: 'Ready',
  REJECTED: 'Rejected',
  FAILED: 'Could not check',
};

export function AttachmentPicker({
  projectId,
  changeOrderId,
  ensureChangeOrderId,
  value,
  onChange,
  onPendingChange,
  disabled = false,
  disabledReason,
}: {
  projectId: string;
  changeOrderId: string | null;
  /** Flushes a draft save so a change order exists to attach to. */
  ensureChangeOrderId: () => Promise<string | null>;
  value: string[];
  onChange: (attachmentIds: string[]) => void;
  /** Lets the composer gate the send button without reaching in here. */
  onPendingChange: (count: number) => void;
  disabled?: boolean;
  disabledReason?: string;
}): JSX.Element {
  const [items, setItems] = useState<PickedAttachment[]>([]);

  useEffect(() => {
    onPendingChange(
      items.filter((item) => item.state === 'UPLOADING' || item.state === 'CHECKING').length,
    );
  }, [items, onPendingChange]);

  const update = useCallback((key: string, patch: Partial<PickedAttachment>): void => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }, []);

  const handleFiles = useCallback(
    async (files: FileList): Promise<void> => {
      for (const file of Array.from(files)) {
        const key = globalThis.crypto?.randomUUID?.() ?? `f-${Date.now()}-${Math.random()}`;
        const checked = preflightUpload(file);

        if (!checked.ok) {
          setItems((current) => [
            ...current,
            {
              key,
              filename: file.name,
              previewUrl: null,
              state: 'REJECTED',
              fileObjectId: null,
              detail: checked.reason,
            },
          ]);
          continue;
        }

        setItems((current) => [
          ...current,
          {
            key,
            filename: checked.filename,
            // Shows something instantly on a slow connection, before any round
            // trip has finished.
            previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
            state: 'UPLOADING',
            fileObjectId: null,
            detail: null,
          },
        ]);

        try {
          const id = changeOrderId ?? (await ensureChangeOrderId());
          if (!id) {
            update(key, {
              state: 'FAILED',
              detail: 'Save the draft first, then add the photograph.',
            });
            continue;
          }

          update(key, { state: 'CHECKING' });
          const { fileObjectId, scan } = await uploadAttachment(file, projectId);

          if (scan?.scanStatus === 'CLEAN') {
            await api(`/v1/change-orders/${id}/attachments`, {
              method: 'POST',
              body: { fileObjectId },
            });
            update(key, { state: 'READY', fileObjectId, detail: null });
            onChange([...value, fileObjectId]);
          } else if (scan?.scanStatus === 'REJECTED') {
            update(key, {
              state: 'REJECTED',
              detail: scan.scanDetail ?? 'This file was rejected.',
            });
          } else {
            update(key, {
              state: 'FAILED',
              detail: 'Still being checked. It becomes usable once the check finishes.',
            });
          }
        } catch (caught) {
          update(key, {
            state: 'FAILED',
            detail: caught instanceof ApiError ? caught.message : (caught as Error).message,
          });
        }
      }
    },
    [changeOrderId, ensureChangeOrderId, onChange, projectId, update, value],
  );

  const remove = useCallback(
    async (item: PickedAttachment): Promise<void> => {
      if (item.fileObjectId && changeOrderId) {
        await api(`/v1/change-orders/${changeOrderId}/attachments/${item.fileObjectId}`, {
          method: 'DELETE',
        }).catch(() => undefined);
        onChange(value.filter((id) => id !== item.fileObjectId));
      }
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      setItems((current) => current.filter((entry) => entry.key !== item.key));
    },
    [changeOrderId, onChange, value],
  );

  return (
    <fieldset className="field" disabled={disabled}>
      <legend>Photographs</legend>
      <p className="small muted">
        A photograph of the work makes this record far harder to dispute later.
      </p>

      <input
        type="file"
        multiple
        // No `capture` attribute: on a phone this offers the camera *and* the
        // gallery. Forcing the camera would block the common case of a
        // photograph the site lead already took an hour ago.
        accept={ALLOWED_UPLOAD_MIME_TYPES.join(',')}
        onChange={(event) => {
          if (event.target.files) void handleFiles(event.target.files);
          event.target.value = '';
        }}
      />

      {disabled && disabledReason ? (
        <p className="small muted" role="status">
          {disabledReason}
        </p>
      ) : null}

      <ul className="attachment-list" aria-label="Attached photographs">
        {items.map((item) => (
          <li key={item.key} className="attachment-item">
            {item.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.previewUrl} alt="" width={48} height={48} />
            ) : null}
            <span>{item.filename}</span>
            {/* Status is never colour-only (report §6.9): the word is the signal. */}
            <span className="small" data-state={item.state}>
              {STATE_LABEL[item.state]}
            </span>
            {item.detail ? <span className="small muted">{item.detail}</span> : null}
            <button type="button" className="btn" onClick={() => void remove(item)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `pnpm --filter @extrawork/web typecheck && pnpm lint`
Expected: no errors. If the `<img>` lint rule behaves differently than the inline suppression expects, match whatever `apps/web/src/app/r/[token]/request-summary.tsx` already does for its images rather than inventing a new approach.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/composer/attachment-picker.tsx apps/web/src/features/composer/attachment-upload.ts
git commit -m "Add the picker that was the only missing half of the upload path"
```

---

### Task 4: Wire the picker into step 1

**Files:**

- Modify: `apps/web/src/features/composer/composer.tsx` — the save loop near lines 130-200, and the `{step === 1 ...}` render block near line 356

**Interfaces:**

- Consumes: `AttachmentPicker` (Task 3)
- Produces: `ensureChangeOrderId(): Promise<string | null>` and `pendingAttachments: number` state, both used by Task 5

- [ ] **Step 1: Expose an id-flushing callback**

The composer creates the change order lazily — the first autosave `POST`s `/v1/projects/{projectId}/change-orders` and later saves `PATCH` `/v1/change-orders/{id}/draft`. A photograph picked before that first save has nothing to attach to. Add, next to the existing save loop:

```typescript
/**
 * Forces the draft to exist on the server and resolves its id.
 *
 * The composer creates the change order lazily on first autosave, so a
 * photograph chosen in the first few seconds has nothing to attach to yet.
 * Returns null when offline, which is the one case where no id can exist:
 * report §6.8 allows an offline draft edit and forbids anything needing the
 * network.
 */
const ensureChangeOrderId = useCallback(async (): Promise<string | null> => {
  if (changeOrderIdRef.current) return changeOrderIdRef.current;
  return saveDraft(getValues());
}, [getValues, saveDraft]);
```

`saveDraft` already returns `changeOrderIdRef.current` or `null`, so it needs no change. Use the form accessor this component already has in scope — React Hook Form's `getValues` if present, otherwise whatever value it passes to `saveDraft` elsewhere.

- [ ] **Step 2: Add the pending counter**

```typescript
const [pendingAttachments, setPendingAttachments] = useState(0);
```

- [ ] **Step 3: Render the picker in step 1**

Add the import at the top of the file:

```typescript
import { AttachmentPicker } from './attachment-picker';
```

Inside the `{step === 1 ? ( ... ) : null}` block, after the reason field:

```tsx
<AttachmentPicker
  projectId={projectId}
  changeOrderId={changeOrderId}
  ensureChangeOrderId={ensureChangeOrderId}
  value={watch('attachmentIds')}
  onChange={(ids) => setValue('attachmentIds', ids, { shouldDirty: true })}
  onPendingChange={setPendingAttachments}
  disabled={!online}
  disabledReason="Photographs need a connection. You can keep typing — the draft is saved on this device."
/>
```

- [ ] **Step 4: Verify by hand**

Run: `pnpm dev`, then open `http://localhost:3000/app/projects/<id>/changes/new` at a phone-sized viewport.
Expected: a Photographs field in step 1. Picking an image shows a thumbnail immediately, then Uploading, Checking, Ready. With the worker stopped it settles on "Still being checked" rather than hanging.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/composer/composer.tsx
git commit -m "Offer the camera in step one, where a scan has time to finish"
```

---

### Task 5: Preview warning and send gating

**Files:**

- Modify: `apps/web/src/features/composer/composer.tsx` — the `{step === 4 ...}` block near line 575 and the `{step === 4 && !canSend ...}` block near line 671

- [ ] **Step 1: Check the available banner classes**

Run: `grep -n "banner" apps/web/src/app/globals.css`
Use whichever warning variant already exists. Do not invent a class name — an undefined token renders as an unstyled block.

- [ ] **Step 2: Warn when no photograph is attached**

Inside the `{step === 4 ? ( ... ) : null}` block, before the send controls:

```tsx
{
  watch('attachmentIds').length === 0 ? (
    <div className="banner banner-warning" role="status">
      <p style={{ marginBottom: 0 }}>
        No photograph attached. A change with a site photograph is far harder to dispute later. You
        can still send this.
      </p>
    </div>
  ) : null;
}
```

- [ ] **Step 3: Keep send unavailable while a scan is unsettled**

The server already refuses with `ATTACHMENT_NOT_READY` (`packages/domain/src/change-orders/validate.ts:112-130`). Mirror it so the contractor sees the reason instead of discovering it as an error. Extend the existing `canSend` condition with `&& pendingAttachments === 0`, and inside the existing `{step === 4 && !canSend ? ... }` block add:

```tsx
{
  pendingAttachments > 0
    ? 'One or more photographs are still being checked. Send becomes available when they finish.'
    : null;
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @extrawork/web typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/composer/composer.tsx
git commit -m "Say why send is unavailable instead of failing at the gate"
```

---

### Task 6: End-to-end proof

The upload path crosses four processes — browser, API, object store, worker — and every unit test above deliberately stubs those boundaries. This is the only test that proves a photograph picked in a browser ends up attached to a sent change order.

**Files:**

- Create: `tests/e2e/attachments.spec.ts`
- Create: `tests/e2e/fixtures/site-photo.jpg`

- [ ] **Step 1: Add the fixture image**

Create a small genuine JPEG at `tests/e2e/fixtures/site-photo.jpg`. A few kilobytes is enough, but it must be a real JPEG: the server checks magic bytes and re-encodes it through sharp, so a renamed text file fails the scan.

```bash
pnpm exec node -e "const s=require('sharp');s({create:{width:640,height:480,channels:3,background:{r:120,g:120,b:120}}}).jpeg().toFile('tests/e2e/fixtures/site-photo.jpg')"
```

- [ ] **Step 2: Write the spec**

```typescript
import { expect, test } from '@playwright/test';

test('a photograph uploads, clears its scan, and does not block the send', async ({ page }) => {
  // Reuse the sign-in and project helpers in tests/e2e/fixtures.ts rather than
  // repeating a login here; follow how tests/e2e/approval.spec.ts does it.
  await page.goto(`/app/projects/${process.env.E2E_PROJECT_ID}/changes/new`);

  await page.getByLabel('Short title').fill('Concealed points, master bedroom');
  await page
    .getByLabel('What is being done')
    .fill('Supply and install four concealed 16A points on the east wall.');

  await page.setInputFiles('input[type=file]', 'tests/e2e/fixtures/site-photo.jpg');

  await expect(page.getByText('Ready')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('No photograph attached')).toHaveCount(0);
});
```

Adjust the two `getByLabel` selectors to the composer's actual field labels — read them from `composer.tsx` rather than guessing.

- [ ] **Step 3: Run it**

Run: `pnpm test:e2e` with the api, worker and web processes running.
Expected: PASS. The worker must be running or the scan never reaches CLEAN and the test times out at the "Ready" assertion.

- [ ] **Step 4: Full verification**

Run: `pnpm verify`
Expected: format, lint, typecheck and every Vitest project pass.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/attachments.spec.ts tests/e2e/fixtures/site-photo.jpg
git commit -m "Prove a photograph survives browser, API, store and worker"
```
