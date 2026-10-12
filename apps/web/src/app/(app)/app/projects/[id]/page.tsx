import type { ProjectDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { formatDate, formatMoney, formatScheduleDelta } from '@/lib/format';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';

/**
 * Project overview — what the project is and what it is worth: the
 * description, the site and dates, and the contract value with every change
 * that moved it. The header and section tabs come from the project layout.
 */
export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectResult = await serverGet<ProjectDto>(`/v1/projects/${id}`);

  if (!projectResult.ok && projectResult.status === 401) return <SignInPrompt />;
  if (!projectResult.ok) return <ErrorPanel message={projectResult.message} />;

  const project = projectResult.data;
  const totals = project.totals;

  return (
    <>
      {project.description ? (
        <section className="card" aria-labelledby="about">
          <h2 id="about">About this project</h2>
          <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{project.description}</p>
        </section>
      ) : null}

      <section className="card" aria-labelledby="details">
        <h2 id="details">Details</h2>
        <dl className="kv">
          <dt>Customer</dt>
          <dd>{project.customerName}</dd>
          <dt>Site</dt>
          <dd>
            {[project.siteAddress?.line1, project.siteAddress?.city].filter(Boolean).join(', ') ||
              '—'}
          </dd>
          <dt>Start</dt>
          <dd>{formatDate(project.startDate) || '—'}</dd>
          <dt>Expected completion</dt>
          <dd>
            {formatDate(project.revisedCompletionDate ?? project.expectedCompletionDate) || '—'}
          </dd>
        </dl>
      </section>

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
    </>
  );
}
