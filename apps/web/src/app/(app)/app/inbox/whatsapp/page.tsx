import Link from 'next/link';
import type { InboundMessageDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { formatRelative } from '@/lib/format';
import { Empty, SheetTop } from '@/components/sheet';
import { InboxTabs } from '../inbox-tabs';

/**
 * Every message ever received, including the ones that were turned away.
 *
 * Showing rejections is the point of this page, not a side effect. When an
 * employee says "I sent it and nothing happened", this is where the answer is:
 * the message arrived, why it was refused, and exactly what they were told.
 * That is why the refusals carry the same weight as the successes here rather
 * than being filtered out of the default view.
 */
export const dynamic = 'force-dynamic';

const OUTCOMES: Record<
  InboundMessageDto['status'],
  { letter: string; label: string; tone: string }
> = {
  RECEIVED: { letter: 'W', label: 'Received', tone: 'waiting' },
  ACCEPTED: { letter: 'A', label: 'Sent to customer', tone: 'approved' },
  REJECTED_UNKNOWN_SENDER: { letter: 'U', label: 'Unknown number', tone: 'declined' },
  REJECTED_NOT_AUTHORIZED: { letter: 'N', label: 'Not authorised', tone: 'declined' },
  REJECTED_UNPARSEABLE: { letter: 'R', label: 'Could not read', tone: 'neutral' },
  REJECTED_POLICY: { letter: 'L', label: 'Over limit', tone: 'declined' },
  SAVED: { letter: 'F', label: 'Filed to project', tone: 'approved' },
  AWAITING_CHOICE: { letter: '?', label: 'Asked which project', tone: 'waiting' },
  ANSWERED: { letter: 'Q', label: 'Answered', tone: 'neutral' },
};

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ unresolved?: string }>;
}) {
  const params = await searchParams;
  const unresolvedOnly = params.unresolved === '1';

  const result = await serverGet<{ items: InboundMessageDto[]; nextCursor: string | null }>(
    `/v1/requests?limit=50${unresolvedOnly ? '&unresolvedOnly=true' : ''}`,
  );

  if (!result.ok && result.status === 401) return <SignInPrompt />;
  if (!result.ok) return <ErrorPanel message={result.message} />;

  const messages = result.data.items;
  const refused = messages.filter((m) => m.status.startsWith('REJECTED')).length;

  return (
    <>
      <SheetTop
        title="Inbox"
        meta="Every message received on the ExtraWork WhatsApp number, and what happened to it"
        actions={
          <div className="segmented" role="group" aria-label="Filter messages">
            <Link
              href="/app/inbox/whatsapp"
              className="segmented-item"
              aria-current={unresolvedOnly ? undefined : 'true'}
            >
              All
            </Link>
            <Link
              href="/app/inbox/whatsapp?unresolved=1"
              className="segmented-item"
              aria-current={unresolvedOnly ? 'true' : undefined}
            >
              Needs attention{refused > 0 && !unresolvedOnly ? ` · ${refused}` : ''}
            </Link>
          </div>
        }
      />

      <main className="sheet rule-in">
        <InboxTabs current="whatsapp" />
        {/*
          These letters are a different vocabulary from the change-order status
          codes in the rail: this column answers "what happened to the message",
          not "where is the request". Without its own legend a reader who has
          learnt the rail would read A here as APPROVED, when it means the
          message was accepted and a request went out.
        */}
        <div className="panel panel-pad" style={{ marginBottom: 'var(--s4)' }}>
          <div className="legend-title" style={{ marginBottom: 'var(--s2)' }}>
            Message outcomes
          </div>
          <div className="row row-wrap" style={{ gap: 'var(--s2) var(--s4)' }}>
            {Object.values(OUTCOMES).map((o) => (
              <span key={o.letter} className={`code code-${o.tone}`} data-code={o.letter}>
                {o.label}
              </span>
            ))}
          </div>
        </div>

        {messages.length === 0 ? (
          <div className="panel">
            <Empty title={unresolvedOnly ? 'Nothing needs attention' : 'No messages yet'}>
              {unresolvedOnly
                ? 'Every message received so far became a request sent to a customer.'
                : 'When someone on your team messages the ExtraWork number it appears here — including messages that could not be processed, and the exact reply they were sent.'}
            </Empty>
          </div>
        ) : (
          <div className="panel">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Received</th>
                    <th scope="col">From</th>
                    <th scope="col">Message</th>
                    <th scope="col">Project</th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((message) => {
                    const outcome = OUTCOMES[message.status];
                    return (
                      <tr key={message.id}>
                        <td className="small nowrap muted">{formatRelative(message.receivedAt)}</td>
                        <td>
                          {message.employeeName ? (
                            <strong>{message.employeeName}</strong>
                          ) : (
                            <span className="muted">Not recognised</span>
                          )}
                          <div className="small muted mono">{message.fromPhoneMasked}</div>
                        </td>
                        <td className="small">
                          {message.body ? (
                            <span title={message.body}>{truncate(message.body, 88)}</span>
                          ) : (
                            <span className="muted">No text</span>
                          )}
                          {message.mediaCount > 0 ? (
                            <div className="small muted">
                              {message.mediaCount} photo{message.mediaCount === 1 ? '' : 's'}
                            </div>
                          ) : null}
                        </td>
                        <td className="small">
                          {message.projectTitle ?? <span className="muted">—</span>}
                        </td>
                        <td>
                          <span className={`code code-${outcome.tone}`} data-code={outcome.letter}>
                            {outcome.label}
                          </span>
                          {message.rejectionReason ? (
                            <div className="small muted">{message.rejectionReason}</div>
                          ) : null}
                          {message.changeOrderId ? (
                            <div className="small">
                              <Link href={`/app/changes/${message.changeOrderId}`}>
                                View request
                              </Link>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="hint">
          Numbers are partly hidden here. Manage who may send requests, and their spending ceiling,
          on <Link href="/app/employees">Employees</Link>.
        </p>
      </main>
    </>
  );
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}
