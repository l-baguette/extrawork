'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFieldArray, useForm, type Resolver } from 'react-hook-form';
import {
  ROOM_SUGGESTIONS,
  WORK_CATEGORY_LABELS,
  type ContactDto,
  type PreviewDto,
  type SendResultDto,
  type WorkCategory,
} from '@extrawork/contracts';
import { ApiError, api, apiRequest, newIdempotencyKey } from '@/lib/api';
import { formatMoney, formatScheduleDelta, parseMoneyToMinor } from '@/lib/format';
import { useOnlineStatus } from '@/components/offline-banner';
import {
  ComposerSchema,
  EMPTY_COMPOSER,
  STEPS,
  STEP_FIELDS,
  TAX_RATES,
  newLine,
  type ComposerValues,
} from './schema';
import { useDraftStore } from './draft-store';
import { SharePanel } from './share-panel';
import { AttachmentPicker } from './attachment-picker';

/**
 * The four-step mobile change composer — report §6.3.
 *
 *   1. What changed   2. Commercial effect   3. Time and approval   4. Preview
 *
 * Key rules implemented here:
 *  - autosaves locally and remotely;
 *  - the **send button is unavailable until the customer preview projection is
 *    successfully calculated by the backend** — the client never computes the
 *    authoritative total (ADR-005);
 *  - a draft carries a server `lockVersion`; an update conflict shows a
 *    comparison instead of overwriting;
 *  - monetary inputs serialise integer paise, quantities decimal strings;
 *  - a single scrolling page on desktop keeps the same state model.
 */

interface Props {
  projectId: string;
  projectCurrency: string;
  contacts: ContactDto[];
  defaultApproverContactId: string | null;
  /** Present when editing an existing draft rather than starting a new one. */
  existing?: {
    changeOrderId: string;
    lockVersion: number;
    values: ComposerValues;
  };
  /**
   * Present when the draft is a request somebody else raised for review (spec
   * 2026-10-12, D4): who raised it, how, and what they said, so the designer
   * prices it knowing where it came from.
   */
  review?: ReviewContext;
}

export interface ReviewContext {
  number: string;
  raisedBy: string | null;
  how: string;
  note: string | null;
  /** Files the raiser attached; the picker below only lists files added here. */
  attachments: Array<{ id: string; filename: string }>;
}

const AUTOSAVE_DEBOUNCE_MS = 1200;

export function Composer({
  projectId,
  projectCurrency,
  contacts,
  defaultApproverContactId,
  existing,
  review,
}: Props) {
  const router = useRouter();
  const online = useOnlineStatus();
  const draftKey = existing ? existing.changeOrderId : `new:${projectId}`;
  const getDraft = useDraftStore((state) => state.getDraft);
  const hydrateDraft = useDraftStore((state) => state.hydrate);
  const setDraft = useDraftStore((state) => state.setDraft);
  const markDraftSynced = useDraftStore((state) => state.markSynced);
  const clearDraft = useDraftStore((state) => state.clearDraft);

  const [step, setStep] = useState(1);
  const [changeOrderId, setChangeOrderId] = useState<string | null>(
    existing?.changeOrderId ?? null,
  );
  const [preview, setPreview] = useState<PreviewDto | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<SendResultDto | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState(0);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const sendKey = useRef<string>(newIdempotencyKey());
  const changeOrderIdRef = useRef<string | null>(existing?.changeOrderId ?? null);
  const lockVersionRef = useRef<number | null>(existing?.lockVersion ?? null);
  const etagRef = useRef<string | null>(null);
  const pendingSaveRef = useRef<ComposerValues | null>(null);
  const saveLoopRef = useRef<Promise<string | null> | null>(null);
  const lastSavedRef = useRef<string | null>(existing ? JSON.stringify(existing.values) : null);
  const previewInputRef = useRef<string | null>(null);

  const form = useForm<ComposerValues>({
    // Shared Zod schema from packages/contracts-derived types (report §6.3).
    resolver: zodResolver(ComposerSchema),
    defaultValues: existing?.values ??
      getDraft(draftKey) ?? {
        ...EMPTY_COMPOSER,
        approverContactId: defaultApproverContactId ?? '',
      },
    mode: 'onBlur',
  });

  const lines = useFieldArray({ control: form.control, name: 'lineItems' });
  const values = form.watch();
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // Restore a locally persisted draft on first mount (report §6.8).
  useEffect(() => {
    if (existing) return;
    const hydrated = hydrateDraft(draftKey);
    if (!form.formState.isDirty) {
      form.reset(
        hydrated ?? {
          ...EMPTY_COMPOSER,
          approverContactId: defaultApproverContactId ?? '',
        },
      );
      // A local draft may be newer than the server. It must be saved before a
      // preview can represent it.
      lastSavedRef.current = null;
    }
  }, [defaultApproverContactId, draftKey, existing, form, hydrateDraft]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // --- Autosave ------------------------------------------------------------
  const save = useCallback(
    (payload: ComposerValues): Promise<string | null> => {
      pendingSaveRef.current = payload;
      if (saveLoopRef.current) return saveLoopRef.current;

      const loop = (async (): Promise<string | null> => {
        while (pendingSaveRef.current) {
          const current = pendingSaveRef.current;
          pendingSaveRef.current = null;

          if (!online) {
            // Queue locally only. Report §6.8 forbids an offline send, not an
            // offline draft edit.
            setDraft(draftKey, current, lockVersionRef.current);
            setSaveState('idle');
            return null;
          }

          setSaveState('saving');
          try {
            let id = changeOrderIdRef.current;
            if (!id) {
              const created = await api<{ id: string; number: string; lockVersion: number }>(
                `/v1/projects/${projectId}/change-orders`,
                {
                  method: 'POST',
                  idempotencyKey: newIdempotencyKey(),
                  body: toApiPayload(current, projectCurrency, 'create'),
                },
              );
              id = created.id;
              changeOrderIdRef.current = created.id;
              lockVersionRef.current = created.lockVersion;
              setChangeOrderId(created.id);
            } else {
              const { data, etag: nextEtag } = await apiRequest<{ lockVersion: number }>(
                `/v1/change-orders/${id}/draft`,
                {
                  method: 'PATCH',
                  ifMatch: etagRef.current ?? `"${id}:${lockVersionRef.current ?? 1}"`,
                  body: toApiPayload(current, projectCurrency, 'update'),
                },
              );
              lockVersionRef.current = data.lockVersion;
              etagRef.current = nextEtag;
            }
            setDraft(draftKey, current, lockVersionRef.current);
            markDraftSynced(draftKey);
            lastSavedRef.current = JSON.stringify(current);
            setSaveState('saved');
            setConflict(null);
          } catch (caught) {
            if (
              caught instanceof ApiError &&
              (caught.code === 'LOCK_CONFLICT' || caught.code === 'ETAG_MISMATCH')
            ) {
              // Report §6.3: show a comparison instead of overwriting.
              setConflict(
                'This draft was changed somewhere else — another device, or a colleague. ' +
                  'Your edits here have NOT been saved. Reload to see the current version before editing again.',
              );
            } else {
              setError(caught instanceof ApiError ? caught.message : 'Could not save the draft.');
            }
            setSaveState('error');
            pendingSaveRef.current = null;
            // The local copy is still kept so nothing typed is lost.
            setDraft(draftKey, current, lockVersionRef.current);
            return null;
          }
        }
        return changeOrderIdRef.current;
      })();

      saveLoopRef.current = loop;
      const clearSaveLoop = () => {
        if (saveLoopRef.current === loop) saveLoopRef.current = null;
      };
      void loop.then(clearSaveLoop, clearSaveLoop);
      return loop;
    },
    [draftKey, markDraftSynced, online, projectCurrency, projectId, setDraft],
  );

  /**
   * Forces the draft to exist on the server and resolves its id.
   *
   * The composer creates the change order lazily on first autosave, so a
   * photograph chosen in the first few seconds has nothing to attach to yet.
   * Delegates to `save`, so it returns null in every case `save` does: not
   * just offline (report §6.8 allows an offline draft edit but forbids
   * anything needing the network) but also a lock/etag conflict or any other
   * API error — each of which `save` has already surfaced via `setConflict`
   * or `setError` above this component's own banners.
   */
  const ensureChangeOrderId = useCallback(async (): Promise<string | null> => {
    if (changeOrderIdRef.current) return changeOrderIdRef.current;
    return save(form.getValues());
  }, [form, save]);

  // Debounced so typing does not produce a request per keystroke.
  const serialized = JSON.stringify(values);
  useEffect(() => {
    if (!form.formState.isDirty || serialized === lastSavedRef.current) return;
    const timer = setTimeout(() => {
      void save(valuesRef.current);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [form.formState.isDirty, save, serialized]);

  // --- Preview -------------------------------------------------------------
  const runPreview = useCallback(async (): Promise<void> => {
    const current = form.getValues();
    const currentSerialized = JSON.stringify(current);
    const id =
      changeOrderIdRef.current && lastSavedRef.current === currentSerialized
        ? changeOrderIdRef.current
        : await save(current);
    if (!id) return;

    setPreviewing(true);
    setPreview(null);
    setError(null);
    try {
      const result = await api<PreviewDto>(`/v1/change-orders/${id}/preview`, { method: 'POST' });
      setPreview(result);
      previewInputRef.current = currentSerialized;
    } catch (caught) {
      setPreview(null);
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'The preview could not be calculated, so this cannot be sent yet.',
      );
    } finally {
      setPreviewing(false);
    }
  }, [form, save]);

  useEffect(() => {
    if (step === 4) void runPreview();
  }, [runPreview, step]);

  // --- Navigation ----------------------------------------------------------
  async function next(): Promise<void> {
    const fields = STEP_FIELDS[step] ?? [];
    const valid = await form.trigger(fields as never);
    if (!valid) {
      // Report §6.9: move focus to the first error rather than silently failing.
      const firstError = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      firstError?.focus();
      return;
    }
    setStep((current) => Math.min(current + 1, 4));
  }

  // --- Send ----------------------------------------------------------------
  // The gate the report asks for: the backend preview must have succeeded and
  // reported no blockers before a send is even possible.
  const canSend =
    online &&
    preview !== null &&
    previewInputRef.current === serialized &&
    preview.blockers.length === 0 &&
    !previewing &&
    !conflict &&
    pendingAttachments === 0;

  async function send(): Promise<void> {
    if (!changeOrderId || !canSend || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await api<SendResultDto>(`/v1/change-orders/${changeOrderId}/send`, {
        method: 'POST',
        idempotencyKey: sendKey.current,
        body: { channel: 'WHATSAPP_NATIVE_SHARE' },
      });
      setSendResult(result);
      clearDraft(draftKey);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? `${caught.message} (reference ${caught.requestId})`
          : 'The request could not be sent.',
      );
    } finally {
      setSending(false);
    }
  }

  if (sendResult && changeOrderId) {
    return (
      <SharePanel
        result={sendResult}
        changeOrderId={changeOrderId}
        onDone={() => router.push(`/app/changes/${changeOrderId}`)}
      />
    );
  }

  const currency = projectCurrency;

  return (
    <div>
      <ol className="stepper" aria-label="Progress">
        {STEPS.map((s) => (
          <li
            key={s.id}
            className="stepper-step"
            data-state={s.id < step ? 'done' : s.id === step ? 'current' : 'todo'}
          >
            <span className="sr-only">
              {`Step ${s.id} of ${STEPS.length}: ${s.label}${s.id === step ? ' (current)' : ''}`}
            </span>
          </li>
        ))}
      </ol>

      <div className="row-between" style={{ marginBottom: 'var(--space-3)' }}>
        <h1 ref={headingRef} tabIndex={-1} style={{ fontSize: '1.25rem' }}>
          {STEPS[step - 1]?.label}
        </h1>
        <SaveIndicator state={saveState} online={online} />
      </div>

      {conflict ? (
        <div className="banner banner-warn" role="alert">
          {conflict}
          <div style={{ marginTop: 'var(--space-2)' }}>
            <button type="button" className="btn" onClick={() => router.refresh()}>
              Reload the current version
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      {review ? (
        <div className="banner banner-info" role="status">
          <p style={{ marginBottom: review.note || review.attachments.length ? 'var(--space-2)' : 0 }}>
            <strong>{review.number}</strong> was raised{' '}
            {review.raisedBy ? (
              <>
                by <strong>{review.raisedBy}</strong>{' '}
              </>
            ) : null}
            {review.how}. Check it, price it and send it — or dismiss it from the request page.
          </p>
          {review.note ? (
            <p style={{ marginBottom: review.attachments.length ? 'var(--space-2)' : 0 }}>
              <strong>Their note:</strong> {review.note}
            </p>
          ) : null}
          {review.attachments.length ? (
            <p className="small" style={{ marginBottom: 0 }}>
              Attached: {review.attachments.map((a) => a.filename).join(', ')}
            </p>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={(event) => event.preventDefault()}>
        {step === 1 ? (
          <section className="card stack">
            <div>
              <label htmlFor="title">Short title</label>
              <input
                id="title"
                type="text"
                {...form.register('title')}
                aria-invalid={form.formState.errors.title ? 'true' : undefined}
                placeholder="Additional electrical wiring for the kitchen"
              />
              <FieldError message={form.formState.errors.title?.message} />
            </div>

            <div>
              <label htmlFor="scope">What exactly is being done?</label>
              <textarea
                id="scope"
                rows={7}
                {...form.register('scope')}
                aria-invalid={form.formState.errors.scope ? 'true' : undefined}
                placeholder="Supply and install two new 16A circuits from the distribution board…"
              />
              <p className="hint">
                The customer sees this text exactly as written. Be specific: this is the record you
                will rely on later.
              </p>
              <FieldError message={form.formState.errors.scope?.message} />
            </div>

            <div className="grid-2">
              <div>
                <label htmlFor="room">Room or area</label>
                <input
                  id="room"
                  type="text"
                  list="composer-room-suggestions"
                  autoComplete="off"
                  {...form.register('room')}
                  aria-invalid={form.formState.errors.room ? 'true' : undefined}
                  placeholder="Master bedroom"
                />
                <datalist id="composer-room-suggestions">
                  {ROOM_SUGGESTIONS.map((room) => (
                    <option key={room} value={room} />
                  ))}
                </datalist>
                <FieldError message={form.formState.errors.room?.message} />
              </div>
              <div>
                <label htmlFor="workCategory">Type of work</label>
                <select id="workCategory" {...form.register('workCategory')}>
                  <option value="">Not set</option>
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
              <label htmlFor="reason">Justification — why is it needed? (optional)</label>
              <input
                id="reason"
                type="text"
                {...form.register('reason')}
                placeholder="Requested by the customer on site on 12 August"
              />
              <p className="hint">
                The homeowner reads this next to the price, so say what made the change necessary.
              </p>
            </div>
          </section>
        ) : null}

        {/*
         * Deliberately mounted for the composer's whole lifetime, not just
         * while step === 1: an upload/scan started here has to keep running
         * while the contractor moves on to cost and schedule, and unmounting
         * this component would freeze `pendingAttachments` at whatever count
         * it last reported (its `onPendingChange` effect can never fire
         * again), locking the send button forever with no way out except an
         * undiscoverable trip back to step 1. `hidden` removes it from
         * layout, the accessibility tree, and tab order without tearing down
         * its state or in-flight requests.
         */}
        <div className="card stack" hidden={step !== 1}>
          <AttachmentPicker
            projectId={projectId}
            changeOrderId={changeOrderId}
            ensureChangeOrderId={ensureChangeOrderId}
            value={form.watch('attachmentIds')}
            onChange={(ids) => form.setValue('attachmentIds', ids, { shouldDirty: true })}
            onPendingChange={setPendingAttachments}
            disabled={!online}
            disabledReason="Photographs need a connection. You can keep typing — the draft is saved on this device."
          />
        </div>

        {step === 2 ? (
          <section className="card">
            {lines.fields.length === 0 ? (
              <p className="muted">
                No priced items yet. Add one, or leave this empty if only the schedule changes.
              </p>
            ) : null}

            {lines.fields.map((field, index) => (
              <fieldset
                key={field.id}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-3)',
                  marginBottom: 'var(--space-3)',
                }}
              >
                <legend className="small muted">
                  {values.lineItems?.[index]?.direction === -1 ? 'Deduction' : 'Addition'}{' '}
                  {index + 1}
                </legend>

                <div className="stack">
                  <div>
                    <label htmlFor={`line-${index}-desc`}>Description</label>
                    <input
                      id={`line-${index}-desc`}
                      type="text"
                      {...form.register(`lineItems.${index}.description`)}
                      aria-invalid={
                        form.formState.errors.lineItems?.[index]?.description ? 'true' : undefined
                      }
                    />
                    <FieldError
                      message={form.formState.errors.lineItems?.[index]?.description?.message}
                    />
                  </div>

                  <div className="grid-2">
                    <div>
                      <label htmlFor={`line-${index}-qty`}>Quantity</label>
                      <input
                        id={`line-${index}-qty`}
                        type="text"
                        inputMode="decimal"
                        {...form.register(`lineItems.${index}.quantity`)}
                        aria-invalid={
                          form.formState.errors.lineItems?.[index]?.quantity ? 'true' : undefined
                        }
                      />
                      <FieldError
                        message={form.formState.errors.lineItems?.[index]?.quantity?.message}
                      />
                    </div>
                    <div>
                      <label htmlFor={`line-${index}-unit`}>Unit</label>
                      <input
                        id={`line-${index}-unit`}
                        type="text"
                        placeholder="sq m, point, lot"
                        {...form.register(`lineItems.${index}.unit`)}
                      />
                    </div>
                  </div>

                  <div className="grid-2">
                    <div>
                      <label htmlFor={`line-${index}-price`}>Rate per unit (₹)</label>
                      <input
                        id={`line-${index}-price`}
                        type="text"
                        inputMode="decimal"
                        {...form.register(`lineItems.${index}.unitPrice`)}
                        aria-invalid={
                          form.formState.errors.lineItems?.[index]?.unitPrice ? 'true' : undefined
                        }
                      />
                      <FieldError
                        message={form.formState.errors.lineItems?.[index]?.unitPrice?.message}
                      />
                    </div>
                    <div>
                      <label htmlFor={`line-${index}-tax`}>GST</label>
                      <select
                        id={`line-${index}-tax`}
                        {...form.register(`lineItems.${index}.taxRateBps`, { valueAsNumber: true })}
                      >
                        {TAX_RATES.map((rate) => (
                          <option key={rate.bps} value={rate.bps}>
                            {rate.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="row-between">
                    <span className="small muted tabular">
                      Line total {estimateLine(values.lineItems?.[index], currency)}
                    </span>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => lines.remove(index)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </fieldset>
            ))}

            <div className="row">
              <button type="button" className="btn" onClick={() => lines.append(newLine(1))}>
                Add an item
              </button>
              <button type="button" className="btn" onClick={() => lines.append(newLine(-1))}>
                Add a deduction
              </button>
            </div>

            <FieldError message={form.formState.errors.lineItems?.message} />

            <p className="hint" style={{ marginTop: 'var(--space-3)' }}>
              ExtraWork calculates the totals on the server so the figure the customer sees is the
              figure that gets recorded. The line total above is only an on-screen estimate.
            </p>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="card stack">
            <div>
              <label htmlFor="schedule">Days added to the programme</label>
              <input
                id="schedule"
                type="number"
                inputMode="numeric"
                {...form.register('scheduleDeltaDays', { valueAsNumber: true })}
              />
              <p className="hint">
                {formatScheduleDelta(values.scheduleDeltaDays ?? 0)}. Use a negative number if this
                saves time.
              </p>
            </div>

            <div>
              <label htmlFor="approver">Who approves this?</label>
              <select
                id="approver"
                {...form.register('approverContactId')}
                aria-invalid={form.formState.errors.approverContactId ? 'true' : undefined}
              >
                <option value="">Choose a contact…</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                    {contact.phoneE164 ? ` · ${contact.phoneE164}` : ''}
                  </option>
                ))}
              </select>
              <FieldError message={form.formState.errors.approverContactId?.message} />
              <p className="hint">
                Only send to someone authorised to increase the contract value. ExtraWork records
                who you addressed it to, not who actually opened the link.
              </p>
            </div>

            <div>
              <label htmlFor="expires">Link expires on (optional)</label>
              <input id="expires" type="date" {...form.register('expiresAt')} />
              <p className="hint">Defaults to 14 days from sending.</p>
            </div>
          </section>
        ) : null}

        {step === 4 ? (
          <section className="card">
            <h2>What the customer will see</h2>

            {form.watch('attachmentIds').length === 0 ? (
              <div className="banner banner-warn" role="status">
                <p style={{ marginBottom: 0 }}>
                  No photograph attached. A change with a site photograph is far harder to dispute
                  later. You can still send this.
                </p>
              </div>
            ) : null}

            {previewing ? (
              <p className="muted" aria-live="polite">
                <span className="spinner" aria-hidden="true" /> Calculating the totals…
              </p>
            ) : preview ? (
              <>
                {preview.blockers.length > 0 ? (
                  <div className="banner banner-warn" role="alert">
                    <strong>Resolve these before sending:</strong>
                    <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: '1.2rem' }}>
                      {preview.blockers.map((blocker) => (
                        <li key={blocker.code}>{blocker.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <table className="totals">
                  <tbody>
                    <tr className="sub">
                      <td>Subtotal</td>
                      <td>{formatMoney(preview.totals.subtotalDeltaMinor, currency)}</td>
                    </tr>
                    <tr className="sub">
                      <td>Tax</td>
                      <td>{formatMoney(preview.totals.taxDeltaMinor, currency)}</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>This change</strong>
                      </td>
                      <td>
                        <strong>{formatMoney(preview.totals.totalDeltaMinor, currency)}</strong>
                      </td>
                    </tr>
                    <tr className="sub">
                      <td>Original contract</td>
                      <td>{formatMoney(preview.totals.baselineTotalMinor, currency)}</td>
                    </tr>
                    <tr className="sub">
                      <td>Previously approved</td>
                      <td>{formatMoney(preview.totals.priorApprovedDeltaMinor, currency)}</td>
                    </tr>
                    <tr className="grand">
                      <td>Revised contract total</td>
                      <td>
                        {formatMoney(preview.totals.revisedContractTotalMinor ?? 0, currency)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <p className="small muted" style={{ marginTop: 'var(--space-4)' }}>
                  Sending freezes this exact version. After it is sent you cannot edit it — you
                  create a new version instead.
                </p>
              </>
            ) : (
              <div className="banner banner-error" role="alert">
                The totals could not be calculated, so this cannot be sent yet. Fix the errors above
                and try again.
              </div>
            )}
          </section>
        ) : null}

        <div className="sticky-actions">
          {step > 1 ? (
            <button type="button" className="btn" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          ) : null}

          {step < 4 ? (
            <button type="button" className="btn btn-primary btn-block" onClick={() => void next()}>
              Continue
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => void send()}
              disabled={!canSend || sending}
              aria-busy={sending}
              // Explains the disabled state to assistive technology rather than
              // leaving a dead control.
              aria-describedby="send-help"
            >
              {sending ? 'Freezing and sending…' : 'Freeze and send to customer'}
            </button>
          )}
        </div>

        {step === 4 && !canSend ? (
          <p id="send-help" className="small muted" style={{ marginTop: 'var(--space-3)' }}>
            {!online
              ? 'Sending needs a connection: the record has to be timestamped by the server.'
              : pendingAttachments > 0
                ? 'One or more photographs are still being checked. Send becomes available when they finish.'
                : previewing
                  ? 'Waiting for the server to confirm the totals.'
                  : 'The server must confirm the totals before this can be sent.'}
          </p>
        ) : null}
      </form>
    </div>
  );
}

function SaveIndicator({ state, online }: { state: string; online: boolean }) {
  if (!online) return <span className="chip chip-pending">Saved on this device</span>;
  if (state === 'saving') return <span className="small muted">Saving…</span>;
  if (state === 'saved') return <span className="small muted">Saved</span>;
  if (state === 'error') return <span className="chip chip-declined">Not saved</span>;
  return null;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="field-error" role="alert">
      {message}
    </p>
  );
}

/** On-screen estimate only; the server total is authoritative (ADR-005). */
function estimateLine(
  line:
    | { quantity?: string; unitPrice?: string; taxRateBps?: number; direction?: number }
    | undefined,
  currency: string,
): string {
  if (!line?.quantity || !line?.unitPrice) return '—';
  const priceMinor = parseMoneyToMinor(line.unitPrice, currency);
  const quantity = Number(line.quantity);
  if (priceMinor === null || !Number.isFinite(quantity)) return '—';
  const subtotal = Math.round(quantity * priceMinor) * (line.direction ?? 1);
  const tax = Math.round((subtotal * (line.taxRateBps ?? 0)) / 10_000);
  return formatMoney(subtotal + tax, currency);
}

/**
 * Converts form values into the API contract: integer paise, decimal strings.
 * Room and type of work are omitted on create when empty, and sent as null on
 * an update so clearing the field clears it on the server.
 */
function toApiPayload(values: ComposerValues, currency: string, mode: 'create' | 'update') {
  const room = values.room?.trim() || null;
  const workCategory = values.workCategory || null;
  return {
    type: values.type,
    title: values.title,
    scope: values.scope,
    ...(values.reason ? { reason: values.reason } : {}),
    ...(mode === 'update'
      ? { room, workCategory }
      : { ...(room ? { room } : {}), ...(workCategory ? { workCategory } : {}) }),
    lineItems: values.lineItems.map((line) => ({
      description: line.description,
      quantity: Number(line.quantity).toFixed(3),
      ...(line.unit ? { unit: line.unit } : {}),
      unitPriceMinor: parseMoneyToMinor(line.unitPrice, currency) ?? 0,
      taxRateBps: line.taxRateBps,
      direction: line.direction,
    })),
    scheduleDeltaDays: values.scheduleDeltaDays,
    approverContactId: values.approverContactId,
    ...(values.expiresAt
      ? { expiresAt: new Date(`${values.expiresAt}T18:30:00Z`).toISOString() }
      : {}),
    assuranceRequired: values.assuranceRequired,
  };
}

/**
 * Minimal Zod resolver. Avoids a dependency on `@hookform/resolvers` for the
 * one function actually needed, and keeps the shared contract schema as the
 * single source of validation truth.
 */
function zodResolver(schema: typeof ComposerSchema): Resolver<ComposerValues> {
  return async (values) => {
    const result = schema.safeParse(values);
    if (result.success) return { values: result.data as ComposerValues, errors: {} };

    const errors: Record<string, unknown> = {};
    for (const issue of result.error.issues) {
      // Build the nested shape react-hook-form expects from a dotted path.
      let cursor = errors;
      issue.path.forEach((segment, index) => {
        const key = String(segment);
        if (index === issue.path.length - 1) {
          cursor[key] = { type: issue.code, message: issue.message };
        } else {
          cursor[key] ??= {};
          cursor = cursor[key] as Record<string, unknown>;
        }
      });
    }
    return { values: {} as ComposerValues, errors: errors as never };
  };
}
