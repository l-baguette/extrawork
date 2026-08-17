import type { PublicRequestDto } from '@extrawork/contracts';
import { formatDate, formatMoney, formatScheduleDelta, formatTaxRate } from '@/lib/format';

/**
 * The read-only half of the customer page — report §6.7 lists exactly what a
 * customer needs to decide:
 *
 *   contractor branding and verified contact; project and site summary without
 *   unnecessary personal details; change number/version and status; scope and
 *   photographs; original baseline, previously approved net changes, current
 *   delta and revised total; schedule impact; expiry and assurance method.
 *
 * Deliberately visually neutral. No dark patterns, no urgency devices beyond
 * the factual expiry date.
 */
export function RequestSummary({ request }: { request: PublicRequestDto }) {
  const { commercial: money, change, schedule } = request;
  const isDeduction = money.totalDeltaMinor < 0;

  return (
    <>
      <header className="card">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: '1.15rem' }}>{request.organization.displayName}</h1>
            {request.organization.legalName ? (
              <p className="small muted" style={{ margin: 0 }}>
                {request.organization.legalName}
              </p>
            ) : null}
          </div>
          <span className="chip chip-neutral">
            {change.number} · v{change.versionNumber}
          </span>
        </div>

        <p className="small muted" style={{ margin: 'var(--space-3) 0 0' }}>
          {request.project.title}
          {request.project.siteSummary ? ` · ${request.project.siteSummary}` : ''}
        </p>
      </header>

      <section className="card" aria-labelledby="what-changed">
        <h2 id="what-changed">{change.title}</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{change.scope}</p>
        {change.reason ? (
          <p className="small muted">
            <strong>Why:</strong> {change.reason}
          </p>
        ) : null}
      </section>

      {request.attachments.length > 0 ? (
        <section className="card" aria-labelledby="photos">
          <h2 id="photos">Photographs</h2>
          <div className="grid-2">
            {request.attachments.map((attachment) => (
              <figure key={attachment.id} style={{ margin: 0 }}>
                {/* Signed, short-lived URL to an EXIF-stripped derivative. */}
                <img
                  src={attachment.url}
                  alt={attachment.caption ?? 'Photograph of the work described above'}
                  loading="lazy"
                  decoding="async"
                  width={attachment.width ?? undefined}
                  height={attachment.height ?? undefined}
                  style={{
                    width: '100%',
                    height: 'auto',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--line)',
                  }}
                />
                {attachment.caption ? (
                  <figcaption className="small muted">{attachment.caption}</figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card" aria-labelledby="cost">
        <h2 id="cost">What this costs</h2>

        {money.lineItems.length > 0 ? (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            {money.lineItems.map((line, index) => (
              <div className="line-item" key={`${line.description}-${index}`}>
                <div className="row-between">
                  <span>{line.description}</span>
                  <span
                    className={`tabular ${line.totalMinor < 0 ? 'amount-negative' : ''}`}
                    style={{ fontWeight: 600, whiteSpace: 'nowrap' }}
                  >
                    {formatMoney(line.totalMinor, money.currency)}
                  </span>
                </div>
                <div className="small muted">
                  {line.quantity}
                  {line.unit ? ` ${line.unit}` : ''} ×{' '}
                  {formatMoney(line.unitPriceMinor, money.currency)}
                  {line.taxRateBps > 0 ? ` · ${formatTaxRate(line.taxRateBps)} tax` : ' · no tax'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">
            There is no extra cost. This request only changes the completion date.
          </p>
        )}

        <table className="totals">
          <tbody>
            <tr className="sub">
              <td>Subtotal</td>
              <td>{formatMoney(money.subtotalDeltaMinor, money.currency)}</td>
            </tr>
            <tr className="sub">
              <td>Tax</td>
              <td>{formatMoney(money.taxDeltaMinor, money.currency)}</td>
            </tr>
            <tr>
              <td>
                <strong>
                  {isDeduction ? 'Reduction from this change' : 'Cost of this change'}
                </strong>
              </td>
              <td className={isDeduction ? 'amount-negative' : ''}>
                <strong>{formatMoney(money.totalDeltaMinor, money.currency)}</strong>
              </td>
            </tr>
            <tr className="sub">
              <td>Original contract total</td>
              <td>{formatMoney(money.baselineTotalMinor, money.currency)}</td>
            </tr>
            <tr className="sub">
              <td>Changes you approved earlier</td>
              <td>{formatMoney(money.priorApprovedDeltaMinor, money.currency)}</td>
            </tr>
            <tr className="grand">
              <td>New contract total</td>
              <td>{formatMoney(money.revisedContractTotalMinor, money.currency)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card" aria-labelledby="timing">
        <h2 id="timing">Effect on the schedule</h2>
        <p style={{ marginBottom: 0 }}>{formatScheduleDelta(schedule.deltaDays)}</p>
        {schedule.revisedCompletionDate ? (
          <p className="small muted">
            New expected completion: {formatDate(schedule.revisedCompletionDate)}
          </p>
        ) : null}
      </section>

      <section className="card" aria-labelledby="who">
        <h2 id="who">Who can approve this</h2>
        <p style={{ marginBottom: 'var(--space-2)' }}>
          This request was addressed to <strong>{request.approver.name}</strong> (
          {request.approver.maskedContact}).
        </p>
        <p className="small muted" style={{ marginBottom: 'var(--space-2)' }}>
          <strong>{request.assurance.label}.</strong> {request.assurance.summary}
        </p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          {request.assurance.limitation}
        </p>
        <p className="small muted" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
          This link stops working after {formatDate(request.expiresAt, { withTime: true })}.
        </p>
      </section>
    </>
  );
}
