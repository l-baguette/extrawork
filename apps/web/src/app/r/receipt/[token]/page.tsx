import type { DecisionReceiptDto } from '@extrawork/contracts';
import { API_URL } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { UnavailableNotice } from '../../[token]/unavailable-notice';

/**
 * Decision receipt — report §6.2 `/r/{token}/complete`.
 *
 * The receipt token is separate from the approval token: the approval token is
 * revoked the moment a decision is recorded, but the customer still needs a
 * durable way back to their receipt.
 */
export const dynamic = 'force-dynamic';

export default async function ReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const response = await fetch(`${API_URL}/public/v1/receipts/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  }).catch(() => null);

  if (!response || !response.ok) {
    return (
      <UnavailableNotice
        code={response ? 'TOKEN_INVALID' : 'SERVICE_UNAVAILABLE'}
        message={null}
        details={null}
      />
    );
  }

  const receipt = (await response.json()) as DecisionReceiptDto;

  return (
    <main id="main" className="page">
      <section className="card">
        <div className="banner banner-success" role="status">
          <h1 style={{ fontSize: '1.1rem' }}>
            {receipt.type === 'APPROVE'
              ? 'Approved'
              : receipt.type === 'DECLINE'
                ? 'Declined'
                : 'Revision requested'}
          </h1>
          <p className="small" style={{ marginBottom: 0 }}>
            Recorded {formatDate(receipt.occurredAt, { withTime: true })}
          </p>
        </div>

        <table className="totals">
          <tbody>
            <tr>
              <td>Receipt reference</td>
              <td className="tabular">
                <strong>{receipt.receiptId}</strong>
              </td>
            </tr>
            <tr>
              <td>Business</td>
              <td>{receipt.organizationName}</td>
            </tr>
            <tr>
              <td>Project</td>
              <td>{receipt.projectTitle}</td>
            </tr>
            <tr>
              <td>Change</td>
              <td>
                {receipt.changeNumber} · v{receipt.versionNumber}
              </td>
            </tr>
            <tr>
              <td>Name given</td>
              <td>{receipt.signerName}</td>
            </tr>
            {receipt.type === 'APPROVE' ? (
              <>
                <tr>
                  <td>Value of this change</td>
                  <td className="tabular">
                    {formatMoney(receipt.totalDeltaMinor, receipt.currency)}
                  </td>
                </tr>
                <tr className="grand">
                  <td>New contract total</td>
                  <td>{formatMoney(receipt.revisedContractTotalMinor, receipt.currency)}</td>
                </tr>
              </>
            ) : null}
          </tbody>
        </table>

        {receipt.evidenceUrl ? (
          <a className="btn btn-block" href={receipt.evidenceUrl}>
            Download the record (PDF)
          </a>
        ) : (
          <p className="small muted">
            The PDF copy is still being prepared. Your decision is already recorded.
          </p>
        )}

        <p className="small muted" style={{ marginTop: 'var(--space-4)', marginBottom: 0 }}>
          <strong>{receipt.assuranceLabel}.</strong> {receipt.assuranceLimitation}
        </p>
      </section>
    </main>
  );
}
