import type { ExtraWorkReportDto } from '@extrawork/contracts';
import { API_URL } from '@/lib/api';
import { serverGet } from '@/lib/server-fetch';
import { formatDate, formatMoney } from '@/lib/format';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';

/**
 * Documented extra-work summary — report §6.2 `/app/reports`, with CSV export.
 *
 * Report §16.3 makes export-after-lapse a launch blocker, so this page and its
 * CSV stay reachable in read-only mode.
 */
export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({ status: params.status ?? 'APPROVED' });
  if (params.projectId) query.set('projectId', params.projectId);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);

  const result = await serverGet<ExtraWorkReportDto>(`/v1/reports/extra-work?${query.toString()}`);

  if (!result.ok && result.status === 401) return <SignInPrompt />;
  if (!result.ok) return <ErrorPanel message={result.message} />;

  const report = result.data;

  return (
    <main className="page page-wide">
      <div className="row-between" style={{ marginBottom: 'var(--space-4)' }}>
        <h1>Extra work</h1>
        <a className="btn" href={`${API_URL}/v1/reports/extra-work.csv?${query.toString()}`}>
          Download CSV
        </a>
      </div>

      <form className="card" method="get">
        <div className="grid-2">
          <div>
            <label htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue={params.status ?? 'APPROVED'}>
              <option value="APPROVED">Approved</option>
              <option value="PENDING">Awaiting a decision</option>
              <option value="DECLINED">Declined</option>
              <option value="ALL">All</option>
            </select>
          </div>
          <div className="grid-2">
            <div>
              <label htmlFor="from">From</label>
              <input id="from" name="from" type="date" defaultValue={params.from ?? ''} />
            </div>
            <div>
              <label htmlFor="to">To</label>
              <input id="to" name="to" type="date" defaultValue={params.to ?? ''} />
            </div>
          </div>
        </div>
        <button type="submit" className="btn btn-primary" style={{ marginTop: 'var(--space-3)' }}>
          Apply
        </button>
      </form>

      <section className="card" aria-labelledby="totals">
        <h2 id="totals">Totals</h2>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-value">{report.totals.count}</div>
            <div className="stat-label">Change requests</div>
          </div>
          <div className="stat">
            <div className="stat-value">
              {formatMoney(report.totals.subtotalDeltaMinor, report.totals.currency)}
            </div>
            <div className="stat-label">Subtotal</div>
          </div>
          <div className="stat">
            <div className="stat-value">
              {formatMoney(report.totals.taxDeltaMinor, report.totals.currency)}
            </div>
            <div className="stat-label">Tax</div>
          </div>
          <div className="stat">
            <div className="stat-value">
              {formatMoney(report.totals.totalDeltaMinor, report.totals.currency)}
            </div>
            <div className="stat-label">Total</div>
          </div>
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Change</th>
                <th scope="col">Project</th>
                <th scope="col">Customer</th>
                <th scope="col">Status</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Total
                </th>
                <th scope="col">Decided</th>
                <th scope="col">Assurance</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={`${row.changeOrderId}-${row.versionNumber}`}>
                  <td>
                    <strong>{row.number}</strong>
                    <div className="small muted">{row.title}</div>
                  </td>
                  <td className="small">{row.projectNumber}</td>
                  <td className="small">{row.customerName}</td>
                  <td className="small">{row.status}</td>
                  <td className="tabular" style={{ textAlign: 'right' }}>
                    {formatMoney(row.totalDeltaMinor, row.currency)}
                  </td>
                  <td className="small muted">{formatDate(row.decidedAt)}</td>
                  <td className="small muted">{row.assuranceAchieved ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="small muted">
        Generated {formatDate(report.generatedAt, { withTime: true })}. Amounts are recorded in
        integer paise and shown here in rupees.
      </p>
    </main>
  );
}
