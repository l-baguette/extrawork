'use client';

import { useId, useState } from 'react';
import type { CalendarFeedDto } from '@extrawork/contracts';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';

/**
 * The private calendar feed — spec 2026-10-12, D14. Subscribing to it is how
 * a phone reminds someone of a handover without the product building push
 * notifications.
 *
 * The URL is shown once, right after it is made: only its hash is stored, so
 * a lost link is replaced ("Make a new link"), never recovered.
 */
export function CalendarFeedCard({ initial }: { initial: CalendarFeedDto | null }) {
  const [feed, setFeed] = useState<CalendarFeedDto | null>(initial);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlId = useId();

  async function create(rotate: boolean): Promise<void> {
    if (
      rotate &&
      !globalThis.confirm?.(
        'Make a new link? Calendars subscribed to the old one stop updating until you add the new one.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      setFeed(await api<CalendarFeedDto>('/v1/calendar/feed', { method: 'POST' }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The link could not be made.');
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(): Promise<void> {
    if (!globalThis.confirm?.('Turn the calendar link off? Subscribed calendars stop updating.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/v1/calendar/feed', { method: 'DELETE' });
      setFeed({ feedUrl: null, active: false, createdAt: null });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The link could not be turned off.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the field is selectable instead.
      (document.getElementById(urlId) as HTMLInputElement | null)?.select();
    }
  }

  return (
    <section className="card feed-card" aria-labelledby={`${urlId}-title`}>
      <h2 id={`${urlId}-title`}>Your dates in Google or Apple Calendar</h2>
      <p className="small muted">
        A private link to completion dates, milestones and approval deadlines for every project you
        are on. Your phone&apos;s calendar then reminds you.
      </p>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      {feed?.feedUrl ? (
        <div className="stack-tight">
          <label htmlFor={urlId}>Your private calendar link</label>
          <div className="feed-url">
            <input id={urlId} readOnly value={feed.feedUrl} onFocus={(e) => e.target.select()} />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void copy(feed.feedUrl!)}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ul className="small feed-steps">
            <li>
              <strong>Google Calendar</strong> (on a computer): Other calendars → + → From URL →
              paste.
            </li>
            <li>
              <strong>iPhone</strong>: Settings → Calendar → Accounts → Add Account → Other → Add
              Subscribed Calendar → paste.
            </li>
          </ul>
          <p className="hint">
            This link is shown only now. Anyone who has it can see these dates, so keep it to
            yourself.
          </p>
        </div>
      ) : feed?.active ? (
        <p className="small">
          Your calendar link is on
          {feed.createdAt ? ` (made ${formatDate(feed.createdAt)})` : ''}. For safety it is shown
          only once; make a new link to add it to another calendar.
        </p>
      ) : null}

      <div className="actions">
        {feed?.active ? (
          <>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => void create(true)}
            >
              Make a new link
            </button>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              disabled={busy}
              onClick={() => void turnOff()}
            >
              Turn off
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void create(false)}
          >
            {busy ? 'Making the link…' : 'Get my calendar link'}
          </button>
        )}
      </div>
    </section>
  );
}
