'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ContactDto } from '@extrawork/contracts';
import { ApiError, api } from '@/lib/api';

/**
 * Edit a customer's details and the people who may approve for them.
 *
 * The approver matters more than anything else on this page: it is who an
 * approval link is addressed to and whose number the homeowner portal and
 * WhatsApp recognise. So adding a contact asks for a phone or an email (the
 * API refuses neither), and marking someone the approver is one tap.
 */

interface Details {
  displayName: string;
  legalName: string | null;
  notes: string | null;
}

export function CustomerEditor({
  customerId,
  lockVersion,
  initial,
  contacts,
}: {
  customerId: string;
  lockVersion: number;
  initial: Details;
  contacts: ContactDto[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState({
    displayName: initial.displayName,
    legalName: initial.legalName ?? '',
    notes: initial.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
      return true;
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    const ok = await run(() =>
      api(`/v1/customers/${customerId}`, {
        method: 'PATCH',
        ifMatch: `"${customerId}:${lockVersion}"`,
        body: {
          displayName: details.displayName.trim(),
          legalName: details.legalName.trim() || null,
          notes: details.notes.trim() || null,
        },
      }),
    );
    if (ok) setEditing(false);
  }

  return (
    <>
      <section className="panel" aria-labelledby="customer-details">
        <div className="row-between">
          <h2 id="customer-details">Details</h2>
          {editing ? null : (
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <form className="stack" onSubmit={saveDetails}>
            <div className="field">
              <label htmlFor="customer-name">Name</label>
              <input
                id="customer-name"
                value={details.displayName}
                onChange={(e) => setDetails({ ...details, displayName: e.target.value })}
                required
                maxLength={200}
              />
            </div>
            <div className="field">
              <label htmlFor="customer-legal">Legal name (optional)</label>
              <input
                id="customer-legal"
                value={details.legalName}
                onChange={(e) => setDetails({ ...details, legalName: e.target.value })}
                maxLength={200}
              />
            </div>
            <div className="field">
              <label htmlFor="customer-notes">Notes (optional)</label>
              <textarea
                id="customer-notes"
                value={details.notes}
                onChange={(e) => setDetails({ ...details, notes: e.target.value })}
                maxLength={2000}
                rows={3}
              />
            </div>
            <div className="actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  setEditing(false);
                  setDetails({
                    displayName: initial.displayName,
                    legalName: initial.legalName ?? '',
                    notes: initial.notes ?? '',
                  });
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <dl className="kv">
            <dt>Name</dt>
            <dd>{initial.displayName}</dd>
            <dt>Legal name</dt>
            <dd>{initial.legalName ?? <span className="muted">—</span>}</dd>
            <dt>Notes</dt>
            <dd>{initial.notes ?? <span className="muted">—</span>}</dd>
          </dl>
        )}
      </section>

      <section className="panel" aria-labelledby="customer-contacts">
        <h2 id="customer-contacts">People</h2>
        <p className="small muted">
          The approver is who a new project addresses its approval links to. Anyone listed here can
          send requests, photos and notes to this customer&rsquo;s projects over WhatsApp from the
          number recorded.
        </p>

        {contacts.length === 0 ? (
          <p className="muted">Nobody recorded yet.</p>
        ) : (
          <ul className="people-list">
            {contacts.map((contact) => (
              <li key={contact.id} className="people-row">
                <div>
                  <strong>{contact.name}</strong>
                  {contact.isDefaultApprover ? (
                    <span className="code code-approved" style={{ marginLeft: 8 }}>
                      Approver
                    </span>
                  ) : null}
                  <div className="small muted mono">
                    {[contact.phoneE164, contact.email].filter(Boolean).join(' · ') || '—'}
                  </div>
                  {contact.authorityNote ? (
                    <div className="small muted">{contact.authorityNote}</div>
                  ) : null}
                </div>
                {contact.isDefaultApprover ? null : (
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api(`/v1/contacts/${contact.id}`, {
                          method: 'PATCH',
                          body: { isDefaultApprover: true },
                        }),
                      )
                    }
                  >
                    Make approver
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <AddContact
          busy={busy}
          onAdd={(input) =>
            run(() => api(`/v1/customers/${customerId}/contacts`, { method: 'POST', body: input }))
          }
        />

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </>
  );
}

function AddContact({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (input: {
    name: string;
    phoneE164?: string;
    email?: string;
    authorityNote?: string;
    isDefaultApprover: boolean;
  }) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    authorityNote: '',
    approver: false,
  });
  const [problem, setProblem] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="actions" style={{ marginTop: 'var(--s4)' }}>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          Add a person
        </button>
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.phone.trim() && !form.email.trim()) {
      setProblem('Add a WhatsApp number or an email address.');
      return;
    }
    setProblem(null);
    const ok = await onAdd({
      name: form.name.trim(),
      ...(form.phone.trim() ? { phoneE164: form.phone.trim() } : {}),
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      ...(form.authorityNote.trim() ? { authorityNote: form.authorityNote.trim() } : {}),
      isDefaultApprover: form.approver,
    });
    if (ok) {
      setForm({ name: '', phone: '', email: '', authorityNote: '', approver: false });
      setOpen(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} style={{ marginTop: 'var(--s4)' }}>
      <div className="field">
        <label htmlFor="contact-name">Name</label>
        <input
          id="contact-name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          maxLength={200}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor="contact-phone">WhatsApp number</label>
        <input
          id="contact-phone"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          inputMode="tel"
          placeholder="98765 43210"
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor="contact-email">Email (optional)</label>
        <input
          id="contact-email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor="contact-authority">Their authority (optional)</label>
        <input
          id="contact-authority"
          value={form.authorityNote}
          onChange={(e) => setForm({ ...form, authorityNote: e.target.value })}
          maxLength={500}
          placeholder="Co-owner of the flat"
        />
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={form.approver}
          onChange={(e) => setForm({ ...form, approver: e.target.checked })}
        />{' '}
        Make them the approver
      </label>
      {problem ? (
        <p className="field-error" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
