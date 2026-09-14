'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ALLOWED_UPLOAD_MIME_TYPES } from '@extrawork/contracts';
import { api, ApiError } from '@/lib/api';
import { preflightUpload } from './attachment-upload';
import { uploadAttachment } from './attachment-client';

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
}) {
  const [items, setItems] = useState<PickedAttachment[]>([]);

  useEffect(() => {
    onPendingChange(
      items.filter((item) => item.state === 'UPLOADING' || item.state === 'CHECKING').length,
    );
  }, [items, onPendingChange]);

  // Kept in sync so the unmount cleanup below can read whatever is current
  // at unmount time rather than closing over a stale render's `items`.
  const itemsRef = useRef<PickedAttachment[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Keys removed while their upload/scan was still in flight. An item can be
  // removed from `items` before it has a `fileObjectId` to send a DELETE
  // for, so `remove()` alone cannot stop a scan that later comes back CLEAN
  // from attaching itself anyway — the async branch below checks this set
  // before it POSTs the attachment or calls `onChange`.
  const removedKeysRef = useRef<Set<string>>(new Set());

  // Object URLs created for instant previews are only revoked in `remove()`.
  // Two paths never call it: the component unmounting with items still
  // pending or ready, and an item that lands in FAILED via the
  // pollScanStatus timeout branch and is never removed by hand. This catches
  // both by revoking whatever previews are still held when the component
  // goes away.
  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  const update = useCallback((key: string, patch: Partial<PickedAttachment>): void => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }, []);

  const handleFiles = useCallback(
    async (files: FileList): Promise<void> => {
      // `value` is captured once for this whole call. The loop below awaits
      // a network round trip per file, so a later iteration cannot see a
      // `value` the parent has not yet re-rendered with — reading it fresh
      // each time would make iteration 2's onChange overwrite whatever
      // iteration 1 already reported. Accumulate newly-ready ids locally
      // instead, and always send the original `value` plus everything
      // accumulated so far.
      const added: string[] = [];
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
              // ensureChangeOrderId returns null whenever the draft save it
              // depends on failed — offline, a lock/etag conflict, or any
              // other API error. The composer already shows the specific
              // reason in its own banner above, so this stays generic rather
              // than guessing at a cause (e.g. "save the draft first") that
              // may not be the real one.
              detail:
                'Could not save the draft, so this cannot be attached yet. See the message above.',
            });
            continue;
          }

          update(key, { state: 'CHECKING' });
          const { fileObjectId, scan } = await uploadAttachment(file, projectId);

          if (removedKeysRef.current.has(key)) {
            // The contractor removed this item while the upload/scan was
            // still running. Whatever the scan verdict, never attach a
            // photograph they already asked to take back.
            removedKeysRef.current.delete(key);
            continue;
          }

          if (scan?.scanStatus === 'CLEAN') {
            await api(`/v1/change-orders/${id}/attachments`, {
              method: 'POST',
              body: { fileObjectId },
            });
            update(key, { state: 'READY', fileObjectId, detail: null });
            added.push(fileObjectId);
            onChange([...value, ...added]);
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
      // Mark this before anything else: an upload/scan still in flight for
      // this key (no fileObjectId yet, so no DELETE to send) must not
      // attach itself once it resolves.
      removedKeysRef.current.add(item.key);
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
              // The @next/next/no-img-element rule is off project-wide (see
              // eslint.config.mjs) for the same reason request-summary.tsx
              // uses a plain <img>: these are signed/blob URLs Next's Image
              // optimizer cannot proxy.
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
