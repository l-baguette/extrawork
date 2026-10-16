'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CHANGE_ATTACHMENT_MIME_TYPES,
  ROOM_SUGGESTIONS,
  WORK_CATEGORY_LABELS,
  type ProposalResultDto,
  type WorkCategory,
} from '@extrawork/contracts';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { parseMoneyToMinor } from '@/lib/format';
import { preflightUpload } from '@/features/composer/attachment-upload';
import { uploadAttachment } from '@/features/composer/attachment-client';

/**
 * Raise a request for the design team to review — spec 2026-10-12, D4.
 *
 * Deliberately one short form, not the four-step composer: the person on site
 * says what and where, and, if they know it, roughly what it costs. Only the
 * description is required. The designer prices it, checks it and sends it to
 * the homeowner; nothing here reaches the homeowner directly.
 */

interface PickedFile {
  key: string;
  name: string;
  state: 'UPLOADING' | 'READY' | 'FAILED';
  fileObjectId: string | null;
  detail: string | null;
}

const MAX_FILES = 12;

/** What a request may carry: the change-attachment allowlist, not every upload type. */
const ACCEPT = [...CHANGE_ATTACHMENT_MIME_TYPES].join(',');

export function RaiseRequestForm({ projectId, currency }: { projectId: string; currency: string }) {
  const router = useRouter();
  const idempotencyKey = useRef(newIdempotencyKey());
  const [description, setDescription] = useState('');
  const [room, setRoom] = useState('');
  const [workCategory, setWorkCategory] = useState<WorkCategory | ''>('');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const uploading = files.some((f) => f.state === 'UPLOADING');
  const amountMinor = amount.trim() ? parseMoneyToMinor(amount, currency) : null;
  const amountInvalid = amount.trim() !== '' && (amountMinor === null || amountMinor < 0);
  const daysValue = days.trim() ? Number(days) : 0;
  const daysInvalid =
    days.trim() !== '' && (!Number.isInteger(daysValue) || Math.abs(daysValue) > 365);

  function pick(list: FileList | null): void {
    if (!list) return;
    const slots = MAX_FILES - files.length;
    for (const file of Array.from(list).slice(0, Math.max(0, slots))) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      const checked = preflightUpload(file);
      const reason = !checked.ok
        ? checked.reason
        : CHANGE_ATTACHMENT_MIME_TYPES.has(checked.contentType)
          ? null
          : 'That kind of file cannot be attached to a request. Add it to the project files instead.';
      if (reason) {
        setFiles((current) => [
          ...current,
          { key, name: file.name, state: 'FAILED', fileObjectId: null, detail: reason },
        ]);
        continue;
      }
      setFiles((current) => [
        ...current,
        { key, name: file.name, state: 'UPLOADING', fileObjectId: null, detail: null },
      ]);
      void uploadAttachment(file, projectId).then(
        ({ fileObjectId, scan }) => {
          // Only a scanned-clean file can be attached; the server refuses the
          // whole request otherwise, so say which file and why here instead.
          const clean = scan?.scanStatus === 'CLEAN';
          const detail = clean
            ? null
            : scan?.scanStatus === 'REJECTED'
              ? 'This file did not pass the safety check.'
              : 'The safety check has not finished. Remove it and try again in a moment.';
          setFiles((current) =>
            current.map((f) =>
              f.key === key
                ? {
                    ...f,
                    state: clean ? 'READY' : 'FAILED',
                    fileObjectId: clean ? fileObjectId : null,
                    detail,
                  }
                : f,
            ),
          );
        },
        (caught: unknown) => {
          setFiles((current) =>
            current.map((f) =>
              f.key === key
                ? {
                    ...f,
                    state: 'FAILED',
                    detail: caught instanceof Error ? caught.message : 'The upload failed.',
                  }
                : f,
            ),
          );
        },
      );
    }
  }

  async function submit(): Promise<void> {
    if (!description.trim() || amountInvalid || daysInvalid || uploading) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api<ProposalResultDto>(`/v1/projects/${projectId}/proposals`, {
        method: 'POST',
        idempotencyKey: idempotencyKey.current,
        body: {
          description: description.trim(),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(room.trim() ? { room: room.trim() } : {}),
          ...(workCategory ? { workCategory } : {}),
          ...(amountMinor !== null && amountMinor > 0 ? { amountMinor } : {}),
          ...(daysValue !== 0 ? { scheduleDeltaDays: daysValue } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          attachmentIds: files
            .filter((f) => f.state === 'READY' && f.fileObjectId)
            .map((f) => f.fileObjectId as string),
        },
      });
      router.push(`/app/changes/${created.changeOrderId}`);
    } catch (caught) {
      idempotencyKey.current = newIdempotencyKey();
      setError(caught instanceof ApiError ? caught.message : 'The request could not be raised.');
      setSubmitting(false);
    }
  }

  return (
    <form
      className="card stack"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      <div>
        <label htmlFor="rr-description">What needs to change?</label>
        <textarea
          id="rr-description"
          rows={4}
          required
          maxLength={20_000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Shift the wash basin 2 feet to the left to make room for a cabinet"
        />
      </div>

      <div className="grid-2">
        <div>
          <label htmlFor="rr-room">Room or area</label>
          <input
            id="rr-room"
            type="text"
            list="rr-room-suggestions"
            autoComplete="off"
            maxLength={80}
            value={room}
            onChange={(event) => setRoom(event.target.value)}
            placeholder="Master bathroom"
          />
          <datalist id="rr-room-suggestions">
            {ROOM_SUGGESTIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor="rr-type">Type of work</label>
          <select
            id="rr-type"
            value={workCategory}
            onChange={(event) => setWorkCategory(event.target.value as WorkCategory | '')}
          >
            <option value="">Not sure</option>
            {(Object.entries(WORK_CATEGORY_LABELS) as Array<[WorkCategory, string]>).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="rr-reason">Why is it needed? (optional)</label>
        <input
          id="rr-reason"
          type="text"
          maxLength={2000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Homeowner asked on the site visit"
        />
      </div>

      <div className="grid-2">
        <div>
          <label htmlFor="rr-amount">Rough cost, if you know it (₹)</label>
          <input
            id="rr-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={amountInvalid ? 'true' : undefined}
            placeholder="4500"
          />
          {amountInvalid ? (
            <p className="field-error" role="alert">
              Enter an amount like 4500 or 4500.50
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="rr-days">Extra days, if any</label>
          <input
            id="rr-days"
            type="number"
            inputMode="numeric"
            value={days}
            onChange={(event) => setDays(event.target.value)}
            aria-invalid={daysInvalid ? 'true' : undefined}
            placeholder="0"
          />
          {daysInvalid ? (
            <p className="field-error" role="alert">
              Whole days, up to 365
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <label htmlFor="rr-files">Photos or files (optional)</label>
        <input
          id="rr-files"
          type="file"
          multiple
          accept={ACCEPT}
          disabled={files.length >= MAX_FILES}
          onChange={(event) => {
            pick(event.target.files);
            event.target.value = '';
          }}
        />
        {files.length > 0 ? (
          <ul className="small" style={{ margin: 'var(--space-2) 0 0', paddingLeft: '1.2rem' }}>
            {files.map((file) => (
              <li key={file.key}>
                {file.name} —{' '}
                {file.state === 'UPLOADING' ? 'uploading…' : file.state === 'READY' ? 'ready' : ''}
                {file.state === 'FAILED' ? (
                  <span className="field-error">{file.detail}</span>
                ) : null}{' '}
                {file.state !== 'UPLOADING' ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() => setFiles((current) => current.filter((f) => f.key !== file.key))}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div>
        <label htmlFor="rr-note">Note for the designer (optional)</label>
        <input
          id="rr-note"
          type="text"
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Plumber is on site tomorrow morning"
        />
      </div>

      <p className="hint" style={{ marginBottom: 0 }}>
        This goes to the design team, not to the homeowner. They will check it, price it and send it
        on.
      </p>

      <div className="sticky-actions">
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={submitting || uploading || !description.trim() || amountInvalid || daysInvalid}
          aria-busy={submitting}
        >
          {submitting ? 'Raising…' : uploading ? 'Waiting for uploads…' : 'Send to the design team'}
        </button>
      </div>
    </form>
  );
}
