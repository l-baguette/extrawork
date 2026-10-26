'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CustomerDto, CustomerSummaryDto, ProjectWorkspaceDto } from '@extrawork/contracts';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { parseMoneyToMinor } from '@/lib/format';
import { formatBytes } from '@/lib/files-display';
import {
  UPLOAD_STAGE_LABELS,
  describeUploadFailure,
  uploadProjectFile,
  type UploadStage,
} from '@/lib/project-upload';
import {
  PROJECT_FILE_TYPES,
  acceptAttribute,
  preflightUpload,
} from '@/features/composer/attachment-upload';

interface PickedFile {
  key: string;
  file: File;
  /** Set when the pre-flight already knows this file cannot be added. */
  refusal: string | null;
}

interface FileProgress {
  key: string;
  name: string;
  stage: UploadStage;
  fraction: number | null;
  error: string | null;
}

/**
 * Project and original-baseline creation — report §4.1.
 *
 * The baseline is the anchor for every revised total, so it is captured once
 * here and locked as soon as the first change is sent. Tax is entered
 * separately from the subtotal because the database enforces
 * `total = subtotal + tax`.
 *
 * Spec 2026-10-12 ("uploads when building a new project"): plans, drawings,
 * BOQs and photos can be chosen here. They are uploaded into the project's
 * Plans & drawings folder only after the project exists, so a failed upload
 * can never cost anyone the project — the page says what failed and links to
 * the Files tab to try again.
 */
export default function NewProjectPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerSummaryDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<'existing' | 'new'>('new');
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [authorityNote, setAuthorityNote] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [start, setStart] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [created, setCreated] = useState<{ id: string } | null>(null);
  const [progress, setProgress] = useState<FileProgress[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [subtotal, setSubtotal] = useState('');
  const [tax, setTax] = useState('');
  const [completion, setCompletion] = useState('');

  useEffect(() => {
    void api<{ items: CustomerSummaryDto[] }>('/v1/customers?limit=100')
      .then((result) => {
        setCustomers(result.items);
        if (result.items.length > 0) setMode('existing');
      })
      .catch(() => undefined);
  }, []);

  const subtotalMinor = parseMoneyToMinor(subtotal || '0');
  const taxMinor = parseMoneyToMinor(tax || '0');
  const totalMinor = subtotalMinor !== null && taxMinor !== null ? subtotalMinor + taxMinor : null;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || created) return;
    if (subtotalMinor === null || taxMinor === null || totalMinor === null) {
      setError('Enter the original contract value as a number, for example 1820000.');
      return;
    }
    if (mode === 'new' && !contactPhone.trim() && !contactEmail.trim()) {
      setError('Enter at least a WhatsApp number or an email address for the approver.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let resolvedCustomerId = customerId;
      let approverContactId = '';

      if (mode === 'new') {
        const customer = await api<{
          id: string;
          displayName: string;
          defaultApproverContactId: string | null;
        }>('/v1/customers', {
          method: 'POST',
          idempotencyKey: newIdempotencyKey(),
          body: {
            displayName: customerName.trim(),
            contacts: [
              {
                name: contactName.trim(),
                ...(contactPhone.trim() ? { phoneE164: contactPhone.trim() } : {}),
                ...(contactEmail.trim() ? { email: contactEmail.trim() } : {}),
                isDefaultApprover: true,
                ...(authorityNote.trim() ? { authorityNote: authorityNote.trim() } : {}),
              },
            ],
          },
        });
        resolvedCustomerId = customer.id;
        approverContactId = customer.defaultApproverContactId ?? '';
      } else {
        const customer = await api<CustomerDto>(`/v1/customers/${customerId}`);
        approverContactId =
          customer.contacts.find((c) => c.isDefaultApprover)?.id ?? customer.contacts[0]?.id ?? '';
      }

      if (!approverContactId) {
        setError('This customer has no contact who can approve changes. Add one first.');
        return;
      }

      const project = await api<{ id: string }>('/v1/projects', {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: {
          customerId: resolvedCustomerId,
          title: title.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(addressLine.trim() || city.trim()
            ? {
                siteAddress: {
                  ...(addressLine.trim() ? { line1: addressLine.trim() } : {}),
                  ...(city.trim() ? { city: city.trim() } : {}),
                  country: 'IN',
                },
              }
            : {}),
          ...(start ? { startDate: start } : {}),
          currency: 'INR',
          timezone: 'Asia/Kolkata',
          baseline: { subtotalMinor, taxMinor, totalMinor },
          ...(completion ? { expectedCompletionDate: completion } : {}),
          defaultApproverContactId: approverContactId,
        },
      });

      const toUpload = files.filter((picked) => picked.refusal === null);
      if (toUpload.length === 0) {
        router.push(`/app/projects/${project.id}`);
        return;
      }
      // From here on the project exists: nothing below may send anyone back
      // to the form, or a retry would create it twice.
      setCreated({ id: project.id });
      const allAdded = await uploadIntoPlans(project.id, toUpload);
      if (allAdded) router.push(`/app/projects/${project.id}`);
    } catch (caught) {
      setError(projectFormError(caught));
    } finally {
      setBusy(false);
    }
  }

  function pick(list: FileList | null): void {
    if (!list) return;
    const added = Array.from(list).map((file) => {
      const checked = preflightUpload(file, { allowed: PROJECT_FILE_TYPES });
      return {
        key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        refusal: checked.ok ? null : checked.reason,
      };
    });
    setFiles((current) => [...current, ...added]);
  }

  /** Uploads into the Plans & drawings folder; true when every file was added. */
  async function uploadIntoPlans(projectId: string, picked: PickedFile[]): Promise<boolean> {
    setUploading(true);
    setFilesError(null);
    setProgress(
      picked.map((p) => ({
        key: p.key,
        name: p.file.name,
        stage: 'WAITING',
        fraction: null,
        error: null,
      })),
    );
    const update = (key: string, next: Partial<FileProgress>) =>
      setProgress((items) => items.map((item) => (item.key === key ? { ...item, ...next } : item)));
    try {
      // Reading the workspace is what creates the default folders.
      const workspace = await api<ProjectWorkspaceDto>(`/v1/projects/${projectId}/workspace`);
      const plans = workspace.folders.find((folder) => folder.systemKey === 'PLANS');
      if (!plans) throw new Error('no plans folder');
      let failures = 0;
      // One at a time: on a site connection parallel uploads only slow each other.
      for (const item of picked) {
        try {
          await uploadProjectFile(item.file, { projectId, folderId: plans.id }, (p) =>
            update(item.key, { stage: p.stage, fraction: p.fraction }),
          );
        } catch (caught) {
          failures += 1;
          update(item.key, {
            stage: 'FAILED',
            fraction: null,
            error: describeUploadFailure(caught).message,
          });
        }
      }
      return failures === 0;
    } catch {
      setFilesError('The project was created, but its folders could not be opened to add files.');
      return false;
    } finally {
      setUploading(false);
    }
  }

  if (created) {
    const failed = progress.filter((item) => item.stage === 'FAILED');
    return (
      <main className="page">
        <h1 style={{ marginBottom: 'var(--space-4)' }}>New project</h1>
        <div className="banner banner-success" role="status">
          <strong>The project is created.</strong>{' '}
          {uploading ? 'Adding your files to Plans & drawings…' : null}
        </div>
        {filesError ? (
          <div className="banner banner-error" role="alert">
            {filesError}
          </div>
        ) : null}
        <section className="card">
          <h2>Plans, drawings, BOQs, photos</h2>
          <ul className="files-queue" aria-live="polite">
            {progress.map((item) => (
              <li key={item.key} data-stage={item.stage}>
                <span className="files-queue-name">{item.name}</span>
                <span />
                <span className="small files-queue-stage">
                  {UPLOAD_STAGE_LABELS[item.stage]}
                  {item.stage === 'UPLOADING' && item.fraction !== null
                    ? ` ${Math.trunc(item.fraction * 100)}%`
                    : ''}
                </span>
                {item.stage === 'UPLOADING' ? (
                  <progress
                    max={1}
                    value={item.fraction ?? 0}
                    aria-label={`Uploading ${item.name}`}
                  />
                ) : null}
                {item.error ? (
                  <span className="field-error files-queue-error">{item.error}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {!uploading && (failed.length > 0 || filesError) ? (
            <p className="small" style={{ marginTop: 'var(--s3)' }}>
              {failed.length > 0
                ? `${failed.length} file${failed.length === 1 ? ' was' : 's were'} not added. `
                : ''}
              You can add {failed.length === 1 ? 'it' : 'them'} again from the project&apos;s{' '}
              <Link href={`/app/projects/${created.id}/files`}>Files tab</Link>.
            </p>
          ) : null}
        </section>
        {!uploading ? (
          <div className="actions">
            <Link className="btn btn-primary" href={`/app/projects/${created.id}`}>
              Go to the project
            </Link>
            <Link className="btn" href={`/app/projects/${created.id}/files`}>
              Open Files
            </Link>
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <main className="page">
      <h1 style={{ marginBottom: 'var(--space-4)' }}>New project</h1>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      <form onSubmit={submit}>
        <section className="card stack">
          <h2>Customer</h2>

          {customers.length > 0 ? (
            <div className="row">
              <label className="checkbox">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'existing'}
                  onChange={() => setMode('existing')}
                />
                <span>Existing customer</span>
              </label>
              <label className="checkbox">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'new'}
                  onChange={() => setMode('new')}
                />
                <span>New customer</span>
              </label>
            </div>
          ) : null}

          {mode === 'existing' ? (
            <div>
              <label htmlFor="customer">Customer</label>
              <select
                id="customer"
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                required
              >
                <option value="">Choose…</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.displayName}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="customer-name">Customer name</label>
                <input
                  id="customer-name"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="contact-name">Who approves changes?</label>
                <input
                  id="contact-name"
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  required
                />
              </div>
              <div className="grid-2">
                <div>
                  <label htmlFor="contact-phone">WhatsApp number</label>
                  <input
                    id="contact-phone"
                    type="tel"
                    inputMode="tel"
                    placeholder="+91 98765 43210"
                    value={contactPhone}
                    onChange={(event) => setContactPhone(event.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="contact-email">Email</label>
                  <input
                    id="contact-email"
                    type="email"
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="authority">Their authority (optional)</label>
                <input
                  id="authority"
                  placeholder="Flat owner; sole decision maker on scope and cost"
                  value={authorityNote}
                  onChange={(event) => setAuthorityNote(event.target.value)}
                />
                <p className="hint">
                  Recording this helps later if someone disputes who was allowed to approve.
                </p>
              </div>
            </>
          )}
        </section>

        <section className="card stack">
          <h2>Project</h2>
          <div>
            <label htmlFor="title">Project title</label>
            <input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="3BHK interior fit-out, Tower 4"
              required
            />
          </div>
          <div>
            <label htmlFor="description">What the project is (optional)</label>
            <textarea
              id="description"
              rows={3}
              maxLength={4000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Full interiors: modular kitchen, wardrobes, false ceiling, two bathrooms"
            />
          </div>
          <div>
            <label htmlFor="address-line">Site address</label>
            <input
              id="address-line"
              value={addressLine}
              maxLength={200}
              onChange={(event) => setAddressLine(event.target.value)}
              placeholder="Flat 1204, Tower 4, Prestige Lakeside"
            />
          </div>
          <div>
            <label htmlFor="city">City</label>
            <input id="city" value={city} onChange={(event) => setCity(event.target.value)} />
          </div>
          <div className="grid-2">
            <div>
              <label htmlFor="start">Work starts</label>
              <input
                id="start"
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="completion">Expected completion</label>
              <input
                id="completion"
                type="date"
                value={completion}
                onChange={(event) => setCompletion(event.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="card stack">
          <h2>Plans, drawings, BOQs, photos</h2>
          <p className="small muted">
            Optional. They go into the project&apos;s Plans &amp; drawings folder once it is
            created. PDFs, photos, Excel, Word, PowerPoint, CSV and DWG/DXF, up to 50 MB each.
          </p>
          <div>
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
              Choose files
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept={acceptAttribute(PROJECT_FILE_TYPES)}
              onChange={(event) => {
                pick(event.target.files);
                event.target.value = '';
              }}
            />
          </div>
          {files.length > 0 ? (
            <ul className="files-queue">
              {files.map((picked) => (
                <li key={picked.key} data-stage={picked.refusal ? 'FAILED' : undefined}>
                  <span className="files-queue-name">{picked.file.name}</span>
                  <span className="small muted tabular">{formatBytes(picked.file.size)}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() =>
                      setFiles((current) => current.filter((f) => f.key !== picked.key))
                    }
                    aria-label={`Remove ${picked.file.name}`}
                  >
                    Remove
                  </button>
                  {picked.refusal ? (
                    <span className="field-error files-queue-error">{picked.refusal}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="card stack">
          <h2>Original contract value</h2>
          <p className="small muted">
            This is the agreed value before any extra work. Every revised total is calculated from
            it, and it locks once you send your first change request.
          </p>
          <div className="grid-2">
            <div>
              <label htmlFor="subtotal">Subtotal (₹)</label>
              <input
                id="subtotal"
                inputMode="decimal"
                value={subtotal}
                onChange={(event) => setSubtotal(event.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="tax">Tax (₹)</label>
              <input
                id="tax"
                inputMode="decimal"
                value={tax}
                onChange={(event) => setTax(event.target.value)}
                required
              />
            </div>
          </div>
          <p className="tabular">
            <strong>
              Total: ₹{totalMinor === null ? '—' : (totalMinor / 100).toLocaleString('en-IN')}
            </strong>
          </p>
        </section>

        <p className="hint">
          Contractors, consultants and the site team can be invited from the project&apos;s Team tab
          once it is created.
        </p>

        <div className="sticky-actions">
          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? 'Creating…' : 'Create the project'}
          </button>
        </div>
      </form>
    </main>
  );
}

function projectFormError(caught: unknown): string {
  if (!(caught instanceof ApiError)) return 'The project could not be created.';

  const fields = Array.isArray(caught.details?.fields)
    ? (caught.details.fields as Array<{ message?: unknown }>)
    : [];
  const detail = fields.find((field) => typeof field.message === 'string')?.message;
  const message = typeof detail === 'string' ? detail : caught.message;
  return `${message} (reference ${caught.requestId})`;
}
