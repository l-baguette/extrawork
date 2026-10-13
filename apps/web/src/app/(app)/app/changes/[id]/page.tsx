import Link from 'next/link';
import {
  WORK_CATEGORY_LABELS,
  type ChangeOrderDto,
  type ChangeOrderEventsDto,
} from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { activeMembership, canInvoice, isDesigner } from '@/lib/active-role';
import { ORIGIN_LABELS } from '@/features/composer/from-change';
import { formatDate, formatMoney, formatScheduleDelta, formatTaxRate } from '@/lib/format';
import { RequestStatusChip } from '@/components/status-chip';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { ChangeActions } from './change-actions';

/**
 * Version and decision history — report §6.2 `/app/changes/{id}`:
 * edit draft, revise, send, remind, export.
 */
export const dynamic = 'force-dynamic';

type EventsResponse = ChangeOrderEventsDto;

export default async function ChangePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [changeResult, eventsResult, membership] = await Promise.all([
    serverGet<ChangeOrderDto>(`/v1/change-orders/${id}`),
    serverGet<EventsResponse>(`/v1/change-orders/${id}/events`),
    activeMembership(),
  ]);

  if (!changeResult.ok && changeResult.status === 401) return <SignInPrompt />;
  if (!changeResult.ok) return <ErrorPanel message={changeResult.message} />;

  const change = changeResult.data;
  const version = change.currentVersion;
  const totals = version.totals;
  const events = eventsResult.ok ? eventsResult.data : { events: [], chainValid: true };
  const submission = version.submission;
  const viewer = {
    designer: isDesigner(membership?.role),
    canInvoice: canInvoice(membership?.role),
  };

  return (
    <main className="page">
      <p className="small muted">
        <Link href={`/app/projects/${change.projectId}`}>← Back to the project</Link>
      </p>

      <header className="card">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: '1.25rem' }}>{version.title}</h1>
            <p className="muted small" style={{ marginBottom: 0 }}>
              {change.number} · version {version.versionNumber} of {change.versionCount}
            </p>
          </div>
          <RequestStatusChip status={version.status} awaitingReview={submission.awaitingReview} />
        </div>
      </header>

      {submission.awaitingReview ? (
        <div className="banner banner-info" role="status">
          <strong>Waiting for the design team.</strong>{' '}
          {submission.label ? `${submission.label} raised this` : 'This was raised'}{' '}
          {submission.submittedAt ? formatDate(submission.submittedAt, { withTime: true }) : ''}.
          {viewer.designer
            ? ' Check it, price it and send it to the homeowner, or dismiss it.'
            : ' The designer will check it and price it before the homeowner sees it.'}
          {submission.note ? (
            <p style={{ margin: 'var(--space-2) 0 0' }}>
              <strong>Note:</strong> {submission.note}
            </p>
          ) : null}
        </div>
      ) : null}

      {!events.chainValid ? (
        <div className="banner banner-error" role="alert">
          <strong>Integrity warning.</strong> The audit history for this change did not verify.
          Contact support before relying on this record.
        </div>
      ) : null}

      <section className="card" aria-labelledby="scope-heading">
        <h2 id="scope-heading">Scope</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{version.scopeDescription}</p>
        {version.reason ? (
          <p className="small muted">
            <strong>Why it is needed:</strong> {version.reason}
          </p>
        ) : null}
        <dl className="kv" style={{ marginBottom: 0 }}>
          <dt>Room or area</dt>
          <dd>{version.room ?? '—'}</dd>
          <dt>Type of work</dt>
          <dd>{version.workCategory ? WORK_CATEGORY_LABELS[version.workCategory] : '—'}</dd>
          <dt>Raised</dt>
          <dd>
            {submission.label ? `${submission.label} · ` : ''}
            {ORIGIN_LABELS[submission.origin]}
          </dd>
          {version.invoicing ? (
            <>
              <dt>Invoiced</dt>
              <dd>
                {formatDate(version.invoicing.invoicedAt)}
                {version.invoicing.invoiceReference
                  ? ` · ${version.invoicing.invoiceReference}`
                  : ''}
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="card" aria-labelledby="money-heading">
        <h2 id="money-heading">Commercial effect</h2>
        {version.lineItems.length === 0 ? (
          <p className="muted">No priced items — this change affects the schedule only.</p>
        ) : (
          version.lineItems.map((line) => (
            <div className="line-item" key={line.id}>
              <div className="row-between">
                <span>{line.description}</span>
                <span
                  className={`tabular ${line.totalMinor < 0 ? 'amount-negative' : ''}`}
                  style={{ fontWeight: 600 }}
                >
                  {formatMoney(line.totalMinor, totals.currency)}
                </span>
              </div>
              <div className="small muted">
                {line.quantity}
                {line.unit ? ` ${line.unit}` : ''} ×{' '}
                {formatMoney(line.unitPriceMinor, totals.currency)} ·{' '}
                {formatTaxRate(line.taxRateBps)}
              </div>
            </div>
          ))
        )}

        <table className="totals" style={{ marginTop: 'var(--space-3)' }}>
          <tbody>
            <tr className="sub">
              <td>Subtotal</td>
              <td>{formatMoney(totals.subtotalDeltaMinor, totals.currency)}</td>
            </tr>
            <tr className="sub">
              <td>Tax</td>
              <td>{formatMoney(totals.taxDeltaMinor, totals.currency)}</td>
            </tr>
            <tr>
              <td>
                <strong>This change</strong>
              </td>
              <td>
                <strong>{formatMoney(totals.totalDeltaMinor, totals.currency)}</strong>
              </td>
            </tr>
            {totals.revisedContractTotalMinor !== null ? (
              <tr className="grand">
                <td>Revised contract total</td>
                <td>{formatMoney(totals.revisedContractTotalMinor, totals.currency)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <p className="small muted" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
          {formatScheduleDelta(version.schedule.deltaDays)}
          {version.schedule.revisedCompletionDate
            ? ` · new completion ${formatDate(version.schedule.revisedCompletionDate)}`
            : ''}
        </p>
      </section>

      {change.decision ? (
        <section className="card" aria-labelledby="decision-heading">
          <h2 id="decision-heading">Customer decision</h2>
          <table className="totals">
            <tbody>
              <tr>
                <td>Decision</td>
                <td>
                  <strong>{change.decision.type}</strong>
                </td>
              </tr>
              <tr>
                <td>Name given</td>
                <td>{change.decision.signerName}</td>
              </tr>
              <tr>
                <td>Recorded</td>
                <td>{formatDate(change.decision.occurredAt, { withTime: true })}</td>
              </tr>
              <tr>
                <td>Assurance</td>
                <td>{change.decision.assuranceAchieved}</td>
              </tr>
              <tr>
                <td>Receipt</td>
                <td className="tabular">{change.decision.receiptId}</td>
              </tr>
            </tbody>
          </table>
          {change.decision.signerComment ? (
            <div className="banner banner-info">
              <strong>Customer comment:</strong> {change.decision.signerComment}
            </div>
          ) : null}
        </section>
      ) : null}

      <ChangeActions change={change} viewer={viewer} />

      <section className="card" aria-labelledby="history-heading">
        <h2 id="history-heading">History</h2>
        <p className="small muted">
          Append-only. Each entry is chained to the one before it, so a later edit to this history
          is detectable.
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Event</th>
                <th scope="col">When</th>
                <th scope="col">Who</th>
              </tr>
            </thead>
            <tbody>
              {events.events.map((event) => (
                <tr key={event.id}>
                  <td className="tabular">{event.sequence}</td>
                  <td>
                    {event.summary}
                    <div className="small muted">{event.eventType}</div>
                  </td>
                  <td className="small">{formatDate(event.occurredAt, { withTime: true })}</td>
                  <td className="small muted">{event.actorLabel ?? event.actorType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
