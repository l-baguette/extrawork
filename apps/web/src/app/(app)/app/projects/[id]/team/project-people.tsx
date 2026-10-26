'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  COLLABORATOR_PARTY_LABELS,
  MEMBERSHIP_ROLE_LABELS,
  type CollaboratorParty,
  type InvitationCreatedDto,
  type InvitationDto,
  type ProjectPersonDto,
} from '@extrawork/contracts';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { formatDate } from '@/lib/format';

/**
 * People with access to the project, and inviting more — spec 2026-10-12, D1.
 *
 * Staff of the firm see a project by their role (owners, admins, accounts) or
 * by a grant (designers, viewers); people from other firms and the homeowner
 * see it as collaborators with a grant. Only collaborators are removed here:
 * a staff member's reach is their role, which is changed in Settings.
 */

const PARTIES = Object.entries(COLLABORATOR_PARTY_LABELS) as Array<[CollaboratorParty, string]>;

interface InviteForm {
  email: string;
  displayName: string;
  party: CollaboratorParty;
  companyName: string;
  phone: string;
  message: string;
}

const EMPTY_FORM: InviteForm = {
  email: '',
  displayName: '',
  party: 'CONSTRUCTION',
  companyName: '',
  phone: '',
  message: '',
};

export function ProjectPeople({
  projectId,
  projectTitle,
  people,
  invitations,
  canManage,
  currentUserId,
}: {
  projectId: string;
  projectTitle: string;
  people: ProjectPersonDto[];
  invitations: InvitationDto[];
  canManage: boolean;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(person: ProjectPersonDto): Promise<void> {
    if (busy) return;
    const confirmed = globalThis.confirm(
      `Remove ${person.displayName} from ${projectTitle}? They will no longer see this project. Requests and files they added stay on the record.`,
    );
    if (!confirmed) return;
    setBusy(person.userId);
    setError(null);
    try {
      await api(`/v1/projects/${projectId}/collaborators/${person.userId}`, { method: 'DELETE' });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not remove. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function revoke(invitation: InvitationDto): Promise<void> {
    if (busy) return;
    setBusy(invitation.id);
    setError(null);
    try {
      await api(`/v1/invitations/${invitation.id}`, { method: 'DELETE' });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not withdraw. Try again.');
    } finally {
      setBusy(null);
    }
  }

  const pending = invitations.filter((i) => i.status === 'PENDING');

  return (
    <>
      <section className="block" aria-labelledby="people-heading">
        <div className="block-head">
          <h2 className="section-title" id="people-heading">
            People with access
          </h2>
        </div>
        {error ? (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="panel">
          <ul className="people-list">
            {people.map((person) => (
              <li key={person.userId} className="people-row">
                <div className="people-main">
                  <strong>{person.displayName}</strong>
                  {person.userId === currentUserId ? <span className="muted"> (you)</span> : null}
                  <div className="small muted">
                    {person.party
                      ? [COLLABORATOR_PARTY_LABELS[person.party], person.companyName]
                          .filter(Boolean)
                          .join(' · ')
                      : `${MEMBERSHIP_ROLE_LABELS[person.role]}${person.orgWide ? ' · sees every project' : ''}`}
                  </div>
                </div>
                <span className={`code ${person.party ? 'code-waiting' : 'code-neutral'}`}>
                  {person.party ? 'Collaborator' : 'Our firm'}
                </span>
                {canManage && person.role === 'COLLABORATOR' ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() => void remove(person)}
                    disabled={busy !== null}
                    aria-busy={busy === person.userId}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {canManage ? (
        <section className="block" aria-labelledby="invite-heading">
          <div className="block-head">
            <h2 className="section-title" id="invite-heading">
              Invite a collaborator
            </h2>
          </div>
          <InviteCollaborator projectId={projectId} onInvited={() => router.refresh()} />

          {pending.length > 0 ? (
            <div className="panel" style={{ marginTop: 'var(--s4)' }}>
              <ul className="people-list">
                {pending.map((invitation) => (
                  <li key={invitation.id} className="people-row">
                    <div className="people-main">
                      <strong>{invitation.displayName ?? invitation.email}</strong>
                      <div className="small muted">
                        {[
                          invitation.displayName ? invitation.email : null,
                          COLLABORATOR_PARTY_LABELS[invitation.party],
                          invitation.companyName,
                          `open until ${formatDate(invitation.expiresAt)}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <span className="code code-waiting">Invited</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      onClick={() => void revoke(invitation)}
                      disabled={busy !== null}
                      aria-busy={busy === invitation.id}
                    >
                      Withdraw
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function InviteCollaborator({
  projectId,
  onInvited,
}: {
  projectId: string;
  onInvited: () => void;
}) {
  const [form, setForm] = useState<InviteForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<InvitationCreatedDto | null>(null);
  const [copied, setCopied] = useState(false);

  function set<K extends keyof InviteForm>(key: K, value: InviteForm[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<InvitationCreatedDto>(`/v1/projects/${projectId}/collaborators`, {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: {
          email: form.email.trim(),
          party: form.party,
          ...(form.displayName.trim() ? { displayName: form.displayName.trim() } : {}),
          ...(form.companyName.trim() ? { companyName: form.companyName.trim() } : {}),
          ...(form.phone.trim() && form.party !== 'HOMEOWNER' ? { phone: form.phone.trim() } : {}),
          ...(form.message.trim() ? { message: form.message.trim() } : {}),
        },
      });
      setCreated(result);
      setCopied(false);
      setForm(EMPTY_FORM);
      onInvited();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not send the invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard blocked (http, or an old browser): the link is on screen to select.
      setCopied(false);
    }
  }

  if (created) {
    return (
      <div className="panel panel-pad stack">
        <div className="banner banner-success" role="status">
          Invitation ready for <strong>{created.invitation.email}</strong>. We have emailed it; send
          it on WhatsApp too so it is not missed.
          {created.addedToSiteTeam
            ? ' Their number is also on this project’s site team, so they can send requests and photos by WhatsApp.'
            : ''}
        </div>
        <div>
          <label htmlFor="invite-link">Invitation link</label>
          <input
            id="invite-link"
            className="input-mono"
            readOnly
            value={created.inviteUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="hint">
            Works once, for {created.invitation.email} only, until{' '}
            {formatDate(created.invitation.expiresAt)}. It is not shown again.
          </p>
        </div>
        <div className="actions">
          <a
            className="btn btn-primary"
            href={created.whatsappShareUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Send on WhatsApp
          </a>
          <button type="button" className="btn" onClick={() => void copy(created.inviteUrl)}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setCreated(null)}>
            Invite someone else
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="panel panel-pad" onSubmit={submit}>
      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="grid-2">
        <div className="field">
          <label htmlFor="invite-email">Email</label>
          <input
            id="invite-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            required
            value={form.email}
            onChange={(event) => set('email', event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="invite-name">Name (optional)</label>
          <input
            id="invite-name"
            autoComplete="off"
            value={form.displayName}
            onChange={(event) => set('displayName', event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="invite-party">They are</label>
          <select
            id="invite-party"
            value={form.party}
            onChange={(event) => set('party', event.target.value as CollaboratorParty)}
          >
            {PARTIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="invite-company">Company (optional)</label>
          <input
            id="invite-company"
            autoComplete="off"
            value={form.companyName}
            onChange={(event) => set('companyName', event.target.value)}
          />
        </div>
        {form.party !== 'HOMEOWNER' ? (
          <div className="field">
            <label htmlFor="invite-phone">WhatsApp number (optional)</label>
            <input
              id="invite-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="98765 43210"
              value={form.phone}
              onChange={(event) => set('phone', event.target.value)}
            />
            <p className="hint">Adds them to this project’s site team so they can message in.</p>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="invite-message">Message (optional)</label>
          <textarea
            id="invite-message"
            rows={2}
            maxLength={1000}
            value={form.message}
            onChange={(event) => set('message', event.target.value)}
          />
        </div>
      </div>
      <p className="hint">
        They can see this project, raise requests for you to review and add files. Only your firm
        edits, prices and sends requests.
      </p>
      <div className="actions" style={{ marginTop: 'var(--s4)' }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || form.email.trim() === ''}
          aria-busy={busy}
        >
          {busy ? 'Inviting…' : 'Create invitation'}
        </button>
      </div>
    </form>
  );
}
