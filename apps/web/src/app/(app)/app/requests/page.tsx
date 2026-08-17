import Link from 'next/link';
import type { InboundMessageDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { formatRelative } from '@/lib/format';

/**
 * Every request ever filed, including the ones that were turned away.
 *
 * Showing rejections is the point of this page, not a side effect. When an
 * employee says "I sent it and nothing happened", this is where the answer is:
 * the message arrived, why it was refused, and exactly what they were told.
 */
export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<InboundMessageDto['status'], string> = {
  RECEIVED: 'Received',
  REJECTED_UNKNOWN_SENDER: 'Unknown number',
  REJECTED_NOT_AUTHORIZED: 'Not authorised',
  REJECTED_UNPARSEABLE: 'Could not read',
  REJECTED_POLICY: 'Over limit',
  ACCEPTED: 'Sent to customer',
};

const STATUS_TONES: Record<InboundMessageDto['status'], string> = {
  RECEIVED: 'chip-pending',
  REJECTED_UNKNOWN_SENDER: 'chip-declined',
  REJECTED_NOT_AUTHORIZED: 'chip-declined',
  REJECTED_UNPARSEABLE: 'chip-draft',
  REJECTED_POLICY: 'chip-declined',
  ACCEPTED: 'chip-approved',
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

  return (
    <main className="page page-wide">
      <h1 style={{ marginBottom: 'var(--space-2)' }}>Requests</h1>
      <p className="muted" style={{ marginBottom: 'var(--space-4)' }}>
        Every message received on the ExtraWork number, and what happened to it.
      </p>

      <div className="actions" style={{ marginBottom: 'var(--space-4)' }}>
        <Link
          href="/app/requests"
          className={`button ${unresolvedOnly ? 'button-secondary' : ''}`}
          aria-current={unresolvedOnly ? undefined : 'page'}
        >
          All
        </Link>
        <p></p>
        <Link
          href="/app/requests?unresolved=1"
          className={`button ${unresolvedOnly ? '' : 'button-secondary'}`}
          aria-current={unresolvedOnly ? 'page' : undefined}
        >
          Needs attention
        </Link>
      </div>

      {messages.length === 0 ? (
        <div className="card">
          <h2>{unresolvedOnly ? 'Nothing needs attention' : 'No requests yet'}</h2>
          <p className="muted">
            {unresolvedOnly
              ? 'Every message received so far became a request sent to a customer.'
              : 'When someone on your team messages the ExtraWork number, it will appear here — including messages that could not be processed.'}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col">From</th>
                  <th scope="col">Project</th>
                  <th scope="col">Message</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((message) => (
                  <tr key={message.id}>
                    <td className="small">{formatRelative(message.receivedAt)}</td>
                    <td>
                      {message.employeeName ? (
                        <strong>{message.employeeName}</strong>
                      ) : (
                        <span className="muted">Not recognised</span>
                      )}
                      <div className="small muted tabular">{message.fromPhoneMasked}</div>
                    </td>
                    <td className="small">
                      {message.projectTitle ?? <span className="muted">—</span>}
                    </td>
                    <td className="small">
                      {message.body ? (
                        <span title={message.body}>{truncate(message.body, 90)}</span>
                      ) : (
                        <span className="muted">No text</span>
                      )}
                      {message.mediaCount > 0 ? (
                        <div className="small muted">
                          {message.mediaCount} photo{message.mediaCount === 1 ? '' : 's'}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className={`chip ${STATUS_TONES[message.status]}`}>
                        {STATUS_LABELS[message.status]}
                      </span>
                      {message.rejectionReason ? (
                        <div className="small muted">{message.rejectionReason}</div>
                      ) : null}
                      {message.changeOrderId ? (
                        <div className="small">
                          <Link href={`/app/changes/${message.changeOrderId}`}>View request</Link>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="small muted">
        Numbers are partly hidden here. Manage who can send requests on{' '}
        <Link href="/app/employees">Employees</Link>.
      </p>
    </main>
  );
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}
