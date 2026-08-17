import Link from 'next/link';
import type { ChangeRegisterDto, ProjectDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { formatDate, formatMoney, formatScheduleDelta } from '@/lib/format';
import { StatusChip } from '@/components/status-chip';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';

/**
 * Project workspace — report §6.2: baseline, change register, revised total,
 * exports.
 */
export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [projectResult, registerResult] = await Promise.all([
    serverGet<ProjectDto>(`/v1/projects/${id}`),
    serverGet<ChangeRegisterDto>(`/v1/projects/${id}/change-register`),
  ]);

  if (!projectResult.ok && projectResult.status === 401) return <SignInPrompt />;
  if (!projectResult.ok) return <ErrorPanel message={projectResult.message} />;

  const project = projectResult.data;
  const changes = registerResult.ok ? registerResult.data.changes : [];
  const totals = project.totals;

  return (
    <main className="page page-wide">
      {project.status === 'INTEGRITY_REVIEW' ? (
        <div className="banner banner-error" role="alert">
          <strong>This project is under integrity review.</strong> The recorded total does not match
          a recomputation from its approved changes. New requests cannot be sent until an
          administrator has repaired it. Existing records remain readable.
        </div>
      ) : null}

      <div className="row-between" style={{ marginBottom: 'var(--space-4)' }}>
        <div>
          <h1>{project.title}</h1>
          <p className="muted small" style={{ marginBottom: 0 }}>
            {project.projectNumber} · {project.customerName}
            {project.siteAddress?.city ? ` · ${project.siteAddress.city}` : ''}
          </p>
        </div>
        <Link
          className="btn btn-primary"
          href={`/app/projects/${project.id}/changes/new`}
          aria-disabled={project.status === 'INTEGRITY_REVIEW'}
        >
          Record extra work
        </Link>
      </div>

      <section className="card" aria-labelledby="contract-value">
        <h2 id="contract-value">Contract value</h2>
        <table className="totals">
          <tbody>
            <tr>
              <td>Original contract</td>
              <td>{formatMoney(totals.baselineTotalMinor, totals.currency)}</td>
            </tr>
            <tr>
              <td>
                Approved extras
                <span className="muted small"> ({totals.approvedChangeCount})</span>
              </td>
              <td className={totals.approvedDeltaMinor < 0 ? 'amount-negative' : ''}>
                {formatMoney(totals.approvedDeltaMinor, totals.currency, { showSign: true })}
              </td>
            </tr>
            <tr className="grand">
              <td>Revised contract total</td>
              <td>{formatMoney(totals.revisedTotalMinor, totals.currency)}</td>
            </tr>
            {totals.pendingChangeCount > 0 ? (
              <tr className="sub">
                <td>
                  Awaiting a decision
                  <span className="muted small"> ({totals.pendingChangeCount})</span>
                </td>
                <td>{formatMoney(totals.pendingDeltaMinor, totals.currency)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <p className="small muted" style={{ marginTop: 'var(--space-4)', marginBottom: 0 }}>
          {formatScheduleDelta(totals.approvedScheduleDeltaDays)} from approved changes.
          {project.revisedCompletionDate
            ? ` Expected completion ${formatDate(project.revisedCompletionDate)}.`
            : ''}
          {project.baselineEditable
            ? ''
            : ' The baseline is locked because a request has been sent.'}
        </p>
      </section>

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
    </main>
  );
}
