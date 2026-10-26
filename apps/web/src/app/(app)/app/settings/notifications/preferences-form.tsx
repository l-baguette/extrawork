'use client';

import { useId, useState } from 'react';
import type { NotificationPreferencesDto } from '@extrawork/contracts';
import { ApiError, api } from '@/lib/api';

/**
 * Three settings, saved together. The lead time only matters while reminders
 * are on, so it is disabled rather than hidden when they are off — turning
 * them back on keeps the number someone chose.
 */
export function PreferencesForm({ initial }: { initial: NotificationPreferencesDto }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const id = useId();

  const dirty =
    draft.emailEnabled !== saved.emailEnabled ||
    draft.completionReminders !== saved.completionReminders ||
    draft.reminderLeadDays !== saved.reminderLeadDays;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await api<NotificationPreferencesDto>('/v1/notifications/preferences', {
        method: 'PUT',
        body: draft,
      });
      setSaved(next);
      setDraft(next);
      setMessage({ ok: true, text: 'Saved.' });
    } catch (caught) {
      setMessage({
        ok: false,
        text: caught instanceof ApiError ? caught.message : 'Could not save. Try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel panel-pad stack" onSubmit={submit}>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={draft.emailEnabled}
          onChange={(event) => setDraft({ ...draft, emailEnabled: event.target.checked })}
        />
        <span>
          <strong>Email me</strong>
          <span className="hint" style={{ display: 'block', margin: 0 }}>
            A copy of each notification by email. Everything still appears in the Inbox.
          </span>
        </span>
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={draft.completionReminders}
          onChange={(event) => setDraft({ ...draft, completionReminders: event.target.checked })}
        />
        <span>
          <strong>Remind me of due dates</strong>
          <span className="hint" style={{ display: 'block', margin: 0 }}>
            Milestones and project completion dates on projects you are part of.
          </span>
        </span>
      </label>

      <div>
        <label htmlFor={`${id}-lead`}>How many days before</label>
        <select
          id={`${id}-lead`}
          value={draft.reminderLeadDays}
          disabled={!draft.completionReminders}
          onChange={(event) => setDraft({ ...draft, reminderLeadDays: Number(event.target.value) })}
          style={{ maxWidth: 220 }}
        >
          {Array.from({ length: 31 }, (_, days) => (
            <option key={days} value={days}>
              {days === 0 ? 'On the day' : days === 1 ? '1 day before' : `${days} days before`}
            </option>
          ))}
        </select>
        <p className="hint">You are reminded once, then again if the date moves.</p>
      </div>

      {message ? (
        <p className={message.ok ? 'small' : 'field-error'} role="status">
          {message.text}
        </p>
      ) : null}
      <div className="actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !dirty}
          aria-busy={busy}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
