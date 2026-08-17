import Link from 'next/link';
import { headers } from 'next/headers';
import type { DashboardDto } from '@extrawork/contracts';
import { API_URL } from '@/lib/api';
import { formatMoneyCompact, formatRelative } from '@/lib/format';
import { StatusChip } from '@/components/status-chip';
import { SignInPrompt } from '@/components/sign-in-prompt';

/**
 * Operational overview — report §6.2 and §6.6.
 *
 * The cards are exactly the ones the report specifies: pending customer
 * decisions, requests overdue or expiring, approved extras this month, average
 * time to decision, and projects with unbilled approved extras.
 *
 * Server-rendered from a pre-aggregated projection rather than scanning audit
 * events (report §6.6).
 */
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const incoming = await headers();
  const cookie = incoming.get('cookie') ?? '';

  const response = await fetch(`${API_URL}/v1/dashboard`, {
    headers: cookie ? { cookie } : {},
    cache: 'no-store',
  }).catch(() => null);

  if (!response || response.status === 401) return <SignInPrompt />;
  if (!response.ok) {
    return (
      <main className="page page-wide">
        <div className="banner banner-error" role="alert">
          The dashboard could not be loaded. Your records are unaffected — please refresh.
        </div>
      </main>
    );
  }

  const data = (await response.json()) as DashboardDto;

  return (
    <main className="page page-wide">
      <div className="row-between" style={{ marginBottom: 'var(--space-4)' }}>
        <h1>Dashboard</h1>
        <Link className="btn btn-primary" href="/app/projects">
          New change request
        </Link>
      </div>

      <div className="stat-grid" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="stat">
          <div className="stat-value">{data.pendingDecisions}</div>
          <div className="stat-label">Awaiting a customer decision</div>
        </div>
        <div className="stat">
          <div className="stat-value">{data.overdueOrExpiring}</div>
          <div className="stat-label">Overdue or expiring soon</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            {formatMoneyCompact(data.approvedValueThisMonthMinor, data.currency)}
          </div>
          <div className="stat-label">Extras approved this month</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            {data.averageHoursToDecision === null
              ? '—'
              : `${data.averageHoursToDecision.toFixed(1)}h`}
          </div>
          <div className="stat-label">Average time to a decision</div>
        </div>
        <div className="stat">
          <div className="stat-value">{data.projectsWithUnbilledApprovedExtras}</div>
          <div className="stat-label">Projects with unbilled approved extras</div>
        </div>
      </div>

      <section aria-labelledby="awaiting" className="card">
        <h2 id="awaiting">Waiting on the customer</h2>
        {data.awaitingDecision.length === 0 ? (
          <p className="muted">
            Nothing is waiting on a customer right now. Open a project to record new work.
          </p>
        ) : (
          <ChangeTable rows={data.awaitingDecision} currency={data.currency} showExpiry />
        )}
      </section>

      <section aria-labelledby="recent" className="card">
        <h2 id="recent">Recent decisions</h2>
        {data.recentDecisions.length === 0 ? (
          <p className="muted">No decisions recorded yet.</p>
        ) : (
          <ChangeTable rows={data.recentDecisions} currency={data.currency} />
        )}
      </section>
    </main>
  );
}

function ChangeTable({
  rows,
  showExpiry = false,
}: {
  rows: DashboardDto['recentDecisions'];
  currency: string;
  showExpiry?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Change</th>
            <th scope="col">Project</th>
            <th scope="col">Status</th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Value
            </th>
            <th scope="col">{showExpiry ? 'Expires' : 'Decided'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/app/changes/${row.id}`}>
                  <strong>{row.number}</strong>
                </Link>
                <div className="small muted">{row.title}</div>
              </td>
              <td>
                <Link href={`/app/projects/${row.projectId}`}>{row.projectTitle}</Link>
                <div className="small muted">{row.customerName}</div>
              </td>
              <td>
                <StatusChip status={row.status} />
              </td>
              <td className="tabular" style={{ textAlign: 'right' }}>
                {formatMoneyCompact(row.totalDeltaMinor, row.currency)}
              </td>
              <td className="small muted">
                {formatRelative(showExpiry ? row.expiresAt : row.decidedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
