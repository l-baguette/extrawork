'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ContactDto, PortalLinkCreatedDto, PortalLinkDto } from '@extrawork/contracts';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { formatDate, formatRelative } from '@/lib/format';

/**
 * Homeowner access — spec 2026-10-12, D5.
 *
 * The homeowner sees the project through a private link rather than an
 * account: every request sent to them, the contract value and its history,
 * the files in folders marked "shared with the homeowner", and the key dates.
 * The link is shown once when it is made (only its hash is kept), so the card
 * offers to send it on WhatsApp or copy it right then; afterwards the list
 * says who has one, how often they opened it, and lets the designer turn it
 * off.
 */
export function HomeownerAccess({
  projectId,
  links,
  contacts,
  defaultContactId,
}: {
  projectId: string;
  links: PortalLinkDto[];
  contacts: ContactDto[];
  defaultContactId: string | null;
}) {
  const router = useRouter();
  const reachable = contacts.filter((c) => c.phoneE164 || c.email);
  const [contactId, setContactId] = useState<string>(
    defaultContactId ?? reachable[0]?.id ?? '',
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<PortalLinkCreatedDto | null>(null);
  const [copied, setCopied] = useState(false);

  async function share(): Promise<void> {
    if (busy) return;
    setBusy('share');
    setError(null);
    try {
      const result = await api<PortalLinkCreatedDto>(`/v1/projects/${projectId}/portal-links`, {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: contactId ? { contactId } : {},
      });
      setCreated(result);
      setCopied(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the link.');
    } finally {
      setBusy(null);
    }
  }

  async function revoke(link: PortalLinkDto): Promise<void> {
    if (busy) return;
    const confirmed = globalThis.confirm(
      `Turn off ${link.contactName}’s link? It stops working at once. You can share a new one any time.`,
    );
    if (!confirmed) return;
    setBusy(link.id);
    setError(null);
    try {
      await api(`/v1/portal-links/${link.id}`, { method: 'DELETE' });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not turn it off. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard blocked: the link is on screen to select by hand.
      setCopied(false);
    }
  }

  const now = new Date();
  const live = links.filter((l) => !l.revokedAt && new Date(l.expiresAt) > now);
  const ended = links.filter((l) => l.revokedAt || new Date(l.expiresAt) <= now).slice(0, 5);

  return (
    <section className="block" aria-labelledby="homeowner-heading">
      <div className="block-head">
        <h2 className="section-title" id="homeowner-heading">
          Homeowner access
        </h2>
      </div>
      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      {created ? (
        <div className="panel panel-pad stack">
          <div className="banner banner-success" role="status">
            Link ready for <strong>{created.link.contactName}</strong>. Send it now — it is not
            shown again.
          </div>
          <div>
            <label htmlFor="portal-link">Project link</label>
            <input
              id="portal-link"
              className="input-mono"
              readOnly
              value={created.portalUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
            <p className="hint">Works until {formatDate(created.link.expiresAt)}.</p>
          </div>
          <div className="actions">
            {created.whatsappShareUrl ? (
              <a
                className="btn btn-primary"
                href={created.whatsappShareUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Send on WhatsApp
              </a>
            ) : null}
            <button type="button" className="btn" onClick={() => void copy(created.messageText)}>
              {copied ? 'Copied' : 'Copy message'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setCreated(null)}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="panel panel-pad stack">
          <p className="small muted" style={{ margin: 0 }}>
            A private link, no account needed. They see every request sent to them, the contract
            value and its history, files in folders shared with the homeowner, and key dates — and
            can ask you for a change.
          </p>
          {reachable.length > 1 ? (
            <div className="field">
              <label htmlFor="portal-contact">Share with</label>
              <select
                id="portal-contact"
                value={contactId}
                onChange={(event) => setContactId(event.target.value)}
              >
                {reachable.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                    {contact.isDefaultApprover ? ' (approver)' : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void share()}
              disabled={busy !== null || reachable.length === 0}
              aria-busy={busy === 'share'}
            >
              {busy === 'share' ? 'Creating…' : 'Share with homeowner'}
            </button>
          </div>
          {reachable.length === 0 ? (
            <p className="hint">Add a phone number or email for the customer first.</p>
          ) : null}
        </div>
      )}

      {live.length + ended.length > 0 ? (
        <div className="panel" style={{ marginTop: 'var(--s4)' }}>
          <ul className="people-list">
            {[...live, ...ended].map((link) => {
              const active = live.includes(link);
              return (
                <li key={link.id} className="people-row">
                  <div className="people-main">
                    <strong>{link.contactName}</strong>
                    <div className="small muted">
                      {[
                        `shared ${formatDate(link.createdAt)}${link.createdVia === 'WHATSAPP' ? ' on WhatsApp' : ''}`,
                        link.viewCount === 0
                          ? 'not opened yet'
                          : `opened ${link.viewCount} time${link.viewCount === 1 ? '' : 's'}, last ${formatRelative(link.lastViewedAt)}`,
                        active
                          ? `until ${formatDate(link.expiresAt)}`
                          : link.revokedAt
                            ? 'turned off'
                            : 'expired',
                      ].join(' · ')}
                    </div>
                  </div>
                  <span className={`code ${active ? 'code-approved' : 'code-neutral'}`}>
                    {active ? 'Active' : 'Ended'}
                  </span>
                  {active ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      onClick={() => void revoke(link)}
                      disabled={busy !== null}
                      aria-busy={busy === link.id}
                    >
                      Turn off
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
