'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  BUSINESS_TYPE_LABELS,
  type BusinessType,
  type OrganizationDto,
  type RequestRouting,
} from '@extrawork/contracts';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';

/**
 * How this workspace works — spec 2026-10-12, D3: what kind of firm it is, and
 * whether requests from the site team wait for the designer.
 *
 * Saved on its own, with only these two fields, so changing them never sends
 * the retention setting (which needs a fresh sign-in) along for the ride.
 */

const BUSINESS_TYPES = Object.entries(BUSINESS_TYPE_LABELS) as Array<[BusinessType, string]>;

const ROUTING: ReadonlyArray<{ value: RequestRouting; label: string; help: string }> = [
  {
    value: 'DESIGNER_REVIEW',
    label: 'Designer reviews every request (recommended)',
    help: 'Requests from the site team, collaborators and the homeowner wait for your firm to check, price and send them.',
  },
  {
    value: 'AUTO_SEND',
    label: 'Send complete WhatsApp requests straight to the client',
    help: 'A site-team request with a price, within that person’s limit, goes to the client without waiting for you. Anything incomplete still waits.',
  },
];

export function WorkspaceForm({
  organization,
  canEdit,
}: {
  organization: OrganizationDto;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [businessType, setBusinessType] = useState<BusinessType | ''>(
    organization.businessType ?? '',
  );
  const [routing, setRouting] = useState<RequestRouting>(organization.requestRouting);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    businessType !== (organization.businessType ?? '') || routing !== organization.requestRouting;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      await api('/v1/organizations/current', {
        method: 'PATCH',
        idempotencyKey: newIdempotencyKey(),
        body: { businessType: businessType === '' ? null : businessType, requestRouting: routing },
      });
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel panel-pad" onSubmit={submit}>
      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}
      {saved && !dirty ? (
        <div className="banner banner-success" role="status">
          Saved.
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="business-type">Type of business</label>
        <select
          id="business-type"
          value={businessType}
          disabled={!canEdit}
          onChange={(event) => {
            setBusinessType(event.target.value as BusinessType | '');
            setSaved(false);
          }}
        >
          <option value="">Not set</option>
          {BUSINESS_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="field">
        <legend>Request routing</legend>
        {ROUTING.map((option) => (
          <label key={option.value} className="checkbox routing-option">
            <input
              type="radio"
              name="request-routing"
              value={option.value}
              checked={routing === option.value}
              disabled={!canEdit}
              onChange={() => {
                setRouting(option.value);
                setSaved(false);
              }}
            />
            <span>
              {option.label}
              <span className="hint routing-help">{option.help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {canEdit ? (
        <div className="row" style={{ marginTop: 'var(--s4)' }}>
          <button className="btn btn-primary" type="submit" disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : (
        <p className="hint">Only the owner or an admin can change these.</p>
      )}
    </form>
  );
}
