'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { OrganizationDto } from '@extrawork/contracts';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';

/**
 * Editing the business record.
 *
 * These values are not cosmetic. The display name, legal name and GSTIN are
 * frozen into every change-order snapshot at send, and the contact phone is
 * printed in the customer's WhatsApp message as the independent channel they
 * can use to check the request is genuine. Changing them here changes what the
 * next customer sees, so the form says so rather than presenting them as
 * profile trivia.
 *
 * Already-sent requests are unaffected: their snapshot was frozen with the
 * values that were true at the time, and nothing rewrites it (report §8.3).
 */

/** Zones a business operating from India realistically files against. */
const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'Australia/Sydney',
];

const RETENTION = [12, 24, 36, 60, 84, 120];

export function BusinessForm({ organization }: { organization: OrganizationDto }) {
  const router = useRouter();
  const [form, setForm] = useState({
    displayName: organization.displayName,
    legalName: organization.legalName ?? '',
    gstin: organization.gstin ?? '',
    contactPhone: organization.contactPhone ?? '',
    contactEmail: organization.contactEmail ?? '',
    timezone: organization.timezone,
    retentionMonths: organization.retentionMonths,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const dirty =
    form.displayName !== organization.displayName ||
    form.legalName !== (organization.legalName ?? '') ||
    form.gstin !== (organization.gstin ?? '') ||
    form.contactPhone !== (organization.contactPhone ?? '') ||
    form.contactEmail !== (organization.contactEmail ?? '') ||
    form.timezone !== organization.timezone ||
    form.retentionMonths !== organization.retentionMonths;

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setFieldErrors((prev) => {
      if (!prev[key as string]) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      await api('/v1/organizations/current', {
        method: 'PATCH',
        idempotencyKey: newIdempotencyKey(),
        body: {
          displayName: form.displayName.trim(),
          // An empty optional field is cleared, not sent as an empty string —
          // the column is nullable and "" is not the same fact as "unknown".
          legalName: form.legalName.trim() || null,
          gstin: form.gstin.trim().toUpperCase() || null,
          contactPhone: form.contactPhone.trim() || null,
          contactEmail: form.contactEmail.trim() || null,
          timezone: form.timezone,
          retentionMonths: form.retentionMonths,
        },
      });
      setSaved(true);
      // The rail shows the organization name, and the server rendered it.
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const details = caught.details as { issues?: Array<{ path: string; message: string }> };
        const issues = details?.issues ?? [];
        if (issues.length > 0) {
          setFieldErrors(
            Object.fromEntries(issues.map((i) => [i.path.split('.').pop() ?? i.path, i.message])),
          );
        }
        setError(issues.length > 0 ? 'Some details need fixing.' : caught.message);
      } else {
        setError('Could not save. Check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel panel-pad" onSubmit={submit} noValidate>
      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}
      {saved && !dirty ? (
        <div className="banner banner-success" role="status">
          Business details saved. Requests already sent keep the details they were sent with.
        </div>
      ) : null}

      <div className="grid-2">
        <Field
          id="displayName"
          label="Business name"
          hint="Shown to your customers in every request."
          error={fieldErrors.displayName}
        >
          <input
            id="displayName"
            value={form.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            aria-invalid={fieldErrors.displayName ? 'true' : undefined}
            autoComplete="organization"
            required
          />
        </Field>

        <Field
          id="legalName"
          label="Registered legal name"
          hint="Appears on evidence packs. Leave blank if it is the same."
          error={fieldErrors.legalName}
        >
          <input
            id="legalName"
            value={form.legalName}
            onChange={(e) => set('legalName', e.target.value)}
            aria-invalid={fieldErrors.legalName ? 'true' : undefined}
          />
        </Field>

        <Field id="gstin" label="GSTIN" hint="15 characters." error={fieldErrors.gstin}>
          <input
            id="gstin"
            className="input-mono"
            value={form.gstin}
            onChange={(e) => set('gstin', e.target.value.toUpperCase())}
            aria-invalid={fieldErrors.gstin ? 'true' : undefined}
            maxLength={15}
            spellCheck={false}
            autoCapitalize="characters"
          />
        </Field>

        <Field
          id="contactPhone"
          label="Contact phone"
          hint="Printed in the customer's message so they can verify it is really you."
          error={fieldErrors.contactPhone}
        >
          <input
            id="contactPhone"
            className="input-mono"
            type="tel"
            value={form.contactPhone}
            onChange={(e) => set('contactPhone', e.target.value)}
            aria-invalid={fieldErrors.contactPhone ? 'true' : undefined}
            autoComplete="tel"
          />
        </Field>

        <Field
          id="contactEmail"
          label="Contact email"
          hint="For customer replies. This is not your sign-in address."
          error={fieldErrors.contactEmail}
        >
          <input
            id="contactEmail"
            type="email"
            value={form.contactEmail}
            onChange={(e) => set('contactEmail', e.target.value)}
            aria-invalid={fieldErrors.contactEmail ? 'true' : undefined}
            autoComplete="email"
          />
        </Field>

        <Field id="timezone" label="Timezone" hint="Sets dates on requests and reminder hours.">
          <select
            id="timezone"
            value={form.timezone}
            onChange={(e) => set('timezone', e.target.value)}
          >
            {(TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES]).map(
              (zone) => (
                <option key={zone} value={zone}>
                  {zone.replace('_', ' ')}
                </option>
              ),
            )}
          </select>
        </Field>

        <Field
          id="retentionMonths"
          label="Evidence retention"
          hint="How long records are kept after a project closes."
        >
          <select
            id="retentionMonths"
            value={form.retentionMonths}
            onChange={(e) => set('retentionMonths', Number(e.target.value))}
          >
            {(RETENTION.includes(form.retentionMonths)
              ? RETENTION
              : [form.retentionMonths, ...RETENTION]
            ).map((months) => (
              <option key={months} value={months}>
                {months} months
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="row" style={{ marginTop: 'var(--s5)' }}>
        <button className="btn btn-primary" type="submit" disabled={busy || !dirty}>
          {busy ? <span className="spinner" /> : null}
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && !busy ? <span className="small muted">Unsaved changes</span> : null}
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}
