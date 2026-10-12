import Link from 'next/link';
import type { ChangeRegisterDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { formatDate, formatMoney } from '@/lib/format';
import { StatusChip } from '@/components/status-chip';
import { ErrorPanel } from '@/components/error-panel';

/**
 * The project's change register — every request raised on it, the one folder
 * of the project that is a frozen, numbered record rather than a pile of files.
 */
export const dynamic = 'force-dynamic';

export default async function ProjectRequestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const registerResult = await serverGet<ChangeRegisterDto>(`/v1/projects/${id}/change-register`);
  if (!registerResult.ok) return <ErrorPanel message={registerResult.message} />;
  const project = registerResult.data.project;
  const changes = registerResult.data.changes;

  return (
    <>
      <section className="card" aria-labelledby="register">
        <div className="row-between">
          <h2 id="register">Change register</h2>
          <Link className="small" href={`/app/reports?projectId=${project.id}`}>
            Export
          </Link>
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
                  <th scope="col">Change</th>
                  <th scope="col">Status</th>
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
                      <div className="small muted">{change.title}</div>
                    </td>
                    <td>
                      <StatusChip status={change.status} />
                    </td>
                    <td
                      className={`tabular ${change.totalDeltaMinor < 0 ? 'amount-negative' : ''}`}
                      style={{ textAlign: 'right' }}
                    >
                      {formatMoney(change.totalDeltaMinor, change.currency)}
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
