'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CustomerDto, CustomerSummaryDto } from '@extrawork/contracts';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { parseMoneyToMinor } from '@/lib/format';

/**
 * Project and original-baseline creation — report §4.1.
 *
 * The baseline is the anchor for every revised total, so it is captured once
 * here and locked as soon as the first change is sent. Tax is entered
 * separately from the subtotal because the database enforces
 * `total = subtotal + tax`.
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
  const [city, setCity] = useState('');
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
    if (busy) return;
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
          ...(city.trim() ? { siteAddress: { city: city.trim(), country: 'IN' } } : {}),
          currency: 'INR',
          timezone: 'Asia/Kolkata',
          baseline: { subtotalMinor, taxMinor, totalMinor },
          ...(completion ? { expectedCompletionDate: completion } : {}),
          defaultApproverContactId: approverContactId,
        },
      });

      router.push(`/app/projects/${project.id}`);
    } catch (caught) {
      setError(projectFormError(caught));
    } finally {
      setBusy(false);
    }
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
          <div className="grid-2">
            <div>
              <label htmlFor="city">City</label>
              <input id="city" value={city} onChange={(event) => setCity(event.target.value)} />
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
