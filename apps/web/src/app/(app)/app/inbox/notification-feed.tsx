'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { NotificationDto, NotificationListDto } from '@extrawork/contracts';
import { api, ApiError } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { Empty } from '@/components/sheet';

const KIND_LABELS: Record<NotificationDto['kind'], string> = {
  REQUEST_SUBMITTED: 'Request for review',
  REQUEST_SENT: 'Sent to client',
  REQUEST_DISMISSED: 'Request declined',
  DECISION_RECORDED: 'Decision',
  DOCUMENT_ADDED: 'New file',
  NOTE_ADDED: 'New note',
  COLLABORATOR_JOINED: 'Collaborator',
  MILESTONE_DUE: 'Milestone due',
  COMPLETION_DUE: 'Completion due',
  WHATSAPP_ATTENTION: 'WhatsApp',
};

const KIND_TONE: Record<NotificationDto['kind'], string> = {
  REQUEST_SUBMITTED: 'waiting',
  REQUEST_SENT: 'neutral',
  REQUEST_DISMISSED: 'declined',
  DECISION_RECORDED: 'approved',
  DOCUMENT_ADDED: 'neutral',
  NOTE_ADDED: 'neutral',
  COLLABORATOR_JOINED: 'neutral',
  MILESTONE_DUE: 'waiting',
  COMPLETION_DUE: 'waiting',
  WHATSAPP_ATTENTION: 'declined',
};

/**
 * Opening an item marks it read; "Mark all read" clears the badge in one go.
 * A failed mark is shown, never swallowed — an unread count that silently
 * refuses to go down looks like a bug in the product.
 */
export function NotificationFeed({ initial }: { initial: NotificationListDto }) {
  const [items, setItems] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unread = items.filter((n) => !n.readAt).length;

  async function markRead(body: { ids: string[] } | { all: true }) {
    setError(null);
    try {
      await api('/v1/notifications/read', { method: 'POST', body });
      const now = new Date().toISOString();
      setItems((current) =>
        current.map((n) =>
          'all' in body || body.ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n,
        ),
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not update. Try again.');
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setBusy(true);
    try {
      const page = await api<NotificationListDto>(
        `/v1/notifications?limit=50&cursor=${encodeURIComponent(nextCursor)}`,
      );
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load more.');
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <Empty title="Nothing yet">
        When someone sends a request, a photo or a file on WhatsApp, a homeowner decides, or a
        collaborator joins one of your projects, it shows up here.
      </Empty>
    );
  }

  return (
    <div className="stack">
      <div className="row-between">
        <span className="small muted">{unread > 0 ? `${unread} unread` : 'All caught up'}</span>
        {unread > 0 ? (
          <button type="button" className="btn btn-sm" onClick={() => void markRead({ all: true })}>
            Mark all read
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}
      <ul className="feed">
        {items.map((n) => (
          <li key={n.id} className="feed-item" data-unread={n.readAt ? undefined : 'true'}>
            <span className={`code code-${KIND_TONE[n.kind]}`} data-code={n.kind.slice(0, 1)}>
              {KIND_LABELS[n.kind]}
            </span>
            <div className="feed-body">
              {n.linkPath ? (
                <Link
                  href={n.linkPath}
                  className="feed-title"
                  onClick={() => (n.readAt ? undefined : void markRead({ ids: [n.id] }))}
                >
                  {n.title}
                </Link>
              ) : (
                <span className="feed-title">{n.title}</span>
              )}
              {n.body ? <p className="feed-text">{n.body}</p> : null}
              <span className="small muted">
                {n.actorLabel ? `${n.actorLabel} · ` : ''}
                {formatRelative(n.createdAt)}
              </span>
            </div>
            {n.readAt ? null : (
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                onClick={() => void markRead({ ids: [n.id] })}
              >
                Mark read
              </button>
            )}
          </li>
        ))}
      </ul>
      {nextCursor ? (
        <button type="button" className="btn" disabled={busy} onClick={() => void loadMore()}>
          {busy ? 'Loading…' : 'Show older'}
        </button>
      ) : null}
    </div>
  );
}
