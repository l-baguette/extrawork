'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '@/lib/api';

/**
 * Add a customer without starting a project (notes: "can create, manage, and
 * add customers"). One person is enough to start: the homeowner who will
 * approve, reachable on WhatsApp or by email. More people can be added on the
 * customer's page.
 */
export function NewCustomer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: '', contactName: '', phone: '', email: '' });

  if (!open) {
    return (
      <div className="actions" style={{ marginBottom: 'var(--s4)' }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
          Add a customer
        </button>
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!form.phone.trim() && !form.email.trim()) {
      setError('Add a WhatsApp number or an email address for the approver.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>('/v1/customers', {
        method: 'POST',
        body: {
          displayName: form.displayName.trim(),
          contacts: [
            {
              name: (form.contactName.trim() || form.displayName).trim(),
              ...(form.phone.trim() ? { phoneE164: form.phone.trim() } : {}),
              ...(form.email.trim() ? { email: form.email.trim() } : {}),
              isDefaultApprover: true,
            },
          ],
        },
      });
      router.push(`/app/customers/${created.id}`);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.',
      );
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="new-customer">
      <h2 id="new-customer">Add a customer</h2>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="new-customer-name">Customer or household</label>
          <input
            id="new-customer-name"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            required
            maxLength={200}
            placeholder="Sharma residence"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="new-customer-contact">Who approves changes?</label>
          <input
            id="new-customer-contact"
            value={form.contactName}
            onChange={(e) => setForm({ ...form, contactName: e.target.value })}
            maxLength={200}
            placeholder="Priya Sharma"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="new-customer-phone">Their WhatsApp number</label>
          <input
            id="new-customer-phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            inputMode="tel"
            placeholder="98765 43210"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="new-customer-email">Email (optional)</label>
          <input
            id="new-customer-email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            autoComplete="off"
          />
        </div>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Adding…' : 'Add customer'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
