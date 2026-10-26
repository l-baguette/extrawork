import Link from 'next/link';
import { WORK_CATEGORY_LABELS, type ChangeRegisterDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { activeMembership, canPropose } from '@/lib/active-role';
import { formatDate, formatMoney } from '@/lib/format';
import { RequestStatusChip } from '@/components/status-chip';
import { ErrorPanel } from '@/components/error-panel';

/**
 * The project's change register — every request raised on it, the one folder
 * of the project that is a frozen, numbered record rather than a pile of files.
 *
 * Requests waiting for the designer come first (spec 2026-10-12, D4): they are
 * the only rows on the sheet anyone is waiting on the design team for.
 */
export const dynamic = 'force-dynamic';

export default async function ProjectRequestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [registerResult, membership] = await Promise.all([
    serverGet<ChangeRegisterDto>(`/v1/projects/${id}/change-register`),
    activeMembership(),
  ]);
  if (!registerResult.ok) return <ErrorPanel message={registerResult.message} />;
  const project = registerResult.data.project;
  // Stable: review items first, otherwise the register's own order (latest first).
  const changes = [...registerResult.data.changes].sort(
    (a, b) => Number(b.awaitingReview) - Number(a.awaitingReview),
  );
  const open = project.status !== 'CLOSED' && project.status !== 'ARCHIVED';

  return (
    <>
      <section className="card" aria-labelledby="register">
        <div className="row-between">
          <h2 id="register">Change register</h2>
          <div className="actions">
            {open && canPropose(membership?.role) ? (
              <Link className="btn btn-sm" href={`/app/projects/${project.id}/requests/new`}>
                Raise a request
              </Link>
            ) : null}
            <Link className="small" href={`/app/reports?projectId=${project.id}`}>
              Export
            </Link>
          </div>
        </div>

        {changes.length === 0 ? (
          <p className="muted">
            No extra work recorded yet. Anything the customer asks for beyond the original scope
            belongs here.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Status</th>
                  <th scope="col">Room</th>
                  <th scope="col">Type of work</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Value
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Days
                  </th>
                  <th scope="col">Sent</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((change) => (
                  <tr key={change.id}>
                    <td>
                      <Link href={`/app/changes/${change.id}`}>
                        <strong>{change.number}</strong>
                        {change.versionNumber > 1 ? (
                          <span className="muted small"> v{change.versionNumber}</span>
                        ) : null}
                      </Link>
                      <div className="small muted">
                        {change.title}
                        {change.submittedByLabel ? ` · from ${change.submittedByLabel}` : ''}
                      </div>
                    </td>
                    <td>
                      <RequestStatusChip
                        status={change.status}
                        awaitingReview={change.awaitingReview}
                      />
                    </td>
                    <td className="small">{change.room ?? '—'}</td>
                    <td className="small">
                      {change.workCategory ? WORK_CATEGORY_LABELS[change.workCategory] : '—'}
                    </td>
                    <td
                      className={`tabular ${change.totalDeltaMinor < 0 ? 'amount-negative' : ''}`}
                      style={{ textAlign: 'right' }}
                    >
                      {change.awaitingReview && change.totalDeltaMinor === 0
                        ? 'To price'
                        : formatMoney(change.totalDeltaMinor, change.currency)}
                    </td>
                    <td className="tabular" style={{ textAlign: 'right' }}>
                      {change.scheduleDeltaDays === 0
                        ? '—'
                        : `${change.scheduleDeltaDays > 0 ? '+' : ''}${change.scheduleDeltaDays}`}
                    </td>
                    <td className="small muted">{formatDate(change.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
