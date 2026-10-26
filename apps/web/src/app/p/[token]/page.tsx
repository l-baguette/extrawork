import {
  MILESTONE_KIND_LABELS,
  WORK_CATEGORY_LABELS,
  type PortalViewDto,
} from '@extrawork/contracts';
import { API_URL } from '@/lib/api';
import { formatDate, formatMoney, formatScheduleDelta } from '@/lib/format';
import { formatBytes } from '@/lib/files-display';
import { StatusChip } from '@/components/status-chip';
import { AskForChange } from './ask-for-change';
import { DownloadButton } from './download-button';
import { PortalUnavailable } from './portal-unavailable';

/**
 * The homeowner portal — spec 2026-10-12, D5.
 *
 * A private, no-account window onto one project: what the homeowner has been
 * asked to decide, the contract value and its history, the files the designer
 * shared with them, and the dates that matter to them. Plus one action: ask
 * for a change, which goes to the designer, not straight into the record.
 *
 * Built like the approval page at `/r/{token}`: server-rendered so it reads
 * on a slow phone before any script arrives; no analytics, no third-party
 * scripts, no web fonts; the token stays in the URL and `no-referrer` is set
 * app-wide. Only the download buttons and the change form are client
 * components, because a signed download URL lives for minutes and must be
 * fetched at the moment it is used.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Your project record',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

type LoadResult =
  | { ok: true; view: PortalViewDto }
  | { ok: false; code: string; reason: string | null };

async function loadPortal(token: string): Promise<LoadResult> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/public/v1/portal/${encodeURIComponent(token)}`, {
      cache: 'no-store',
    });
  } catch {
    return { ok: false, code: 'SERVICE_UNAVAILABLE', reason: null };
  }
  const body = (await response.json().catch(() => null)) as
    | PortalViewDto
    | { error: { code: string; details?: { reason?: string } } }
    | null;
  if (!response.ok || !body || 'error' in body) {
    const error = body && 'error' in body ? body.error : null;
    return {
      ok: false,
      code: error?.code ?? 'PORTAL_LINK_INVALID',
      reason: error?.details?.reason ?? null,
    };
  }
  return { ok: true, view: body };
}

export default async function PortalPage({ params }: PageProps) {
  const { token } = await params;
  const result = await loadPortal(token);
  if (!result.ok) return <PortalUnavailable code={result.code} reason={result.reason} />;

  const { view } = result;
  const { project, contract } = view;
  const currency = contract.currency;
  const waiting = view.requests.filter((r) => r.actionable);
  const completion = project.revisedCompletionDate ?? project.expectedCompletionDate;
  const folders = groupByFolder(view.documents);

  return (
    <main id="main" className="page portal">
      <header className="portal-head">
        <p className="small muted portal-from">{view.organizationName}</p>
        <h1>{project.title}</h1>
        <p className="small muted">
          {[project.number, project.city].filter(Boolean).join(' · ')}
          {project.status !== 'ACTIVE' ? ' · Closed' : ''}
        </p>
        {project.description ? <p className="portal-description">{project.description}</p> : null}
      </header>

      {waiting.length > 0 ? (
        <div className="banner banner-warn" role="status">
          {waiting.length === 1
            ? '1 request is waiting for your decision.'
            : `${waiting.length} requests are waiting for your decision.`}{' '}
          Open the approval link your designer sent you for each one.
        </div>
      ) : null}

      <section className="card" aria-labelledby="contract-heading">
        <h2 id="contract-heading">Contract value</h2>
        <table className="totals">
          <tbody>
            <tr>
              <td>Original contract</td>
              <td className="tabular">{formatMoney(contract.originalTotalMinor, currency)}</td>
            </tr>
            <tr>
              <td>Approved changes</td>
              <td className="tabular">
                {formatMoney(contract.approvedDeltaMinor, currency, { showSign: true })}
              </td>
            </tr>
            <tr className="grand">
              <td>Current contract</td>
              <td className="tabular">{formatMoney(contract.currentTotalMinor, currency)}</td>
            </tr>
            {contract.pendingDeltaMinor !== 0 ? (
              <tr className="sub">
                <td>Waiting for your decision</td>
                <td className="tabular">
                  {formatMoney(contract.pendingDeltaMinor, currency, { showSign: true })}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {completion ? (
          <p className="small muted portal-dates">
            {project.startDate ? `Started ${formatDate(project.startDate)} · ` : ''}
            Expected completion {formatDate(completion)}
            {project.revisedCompletionDate ? ' (revised by approved changes)' : ''}
          </p>
        ) : null}

        {contract.history.length > 1 ? (
          <details className="portal-history">
            <summary>How the contract value changed</summary>
            <ol className="portal-history-list">
              {contract.history.map((entry, index) => (
                <li key={`${entry.kind}-${index}`}>
                  <div className="row-between">
                    <span>
                      {entry.number ? <strong>{entry.number} </strong> : null}
                      {entry.label}
                    </span>
                    <span className="tabular">
                      {formatMoney(entry.deltaMinor, currency, {
                        showSign: entry.kind !== 'BASELINE',
                      })}
                    </span>
                  </div>
                  <div className="small muted row-between">
                    <span>{formatDate(entry.occurredAt)}</span>
                    <span className="tabular">
                      = {formatMoney(entry.runningTotalMinor, currency)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </section>

      <section className="card" aria-labelledby="requests-heading">
        <h2 id="requests-heading">Change requests</h2>
        {view.requests.length === 0 ? (
          <p className="muted small">No change requests have been sent to you yet.</p>
        ) : (
          <ul className="portal-list">
            {view.requests.map((request) => (
              <li key={request.id} className="portal-request">
                <div className="row-between">
                  <span className="tabular small muted">
                    {request.number}
                    {request.versionNumber > 1 ? ` · version ${request.versionNumber}` : ''}
                  </span>
                  <StatusChip status={request.status} />
                </div>
                <strong className="portal-request-title">{request.title}</strong>
                <p className="small muted portal-request-meta">
                  {[
                    request.room,
                    request.workCategory ? WORK_CATEGORY_LABELS[request.workCategory] : null,
                    request.sentAt ? `sent ${formatDate(request.sentAt)}` : null,
                    request.decidedAt ? `decided ${formatDate(request.decidedAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <div className="row-between">
                  <span className="tabular">
                    {formatMoney(request.totalDeltaMinor, currency, { showSign: true })}
                  </span>
                  <span className="small muted">
                    {formatScheduleDelta(request.scheduleDeltaDays)}
                  </span>
                </div>
                {request.evidenceDocumentId ? (
                  <DownloadButton
                    token={token}
                    documentId={request.evidenceDocumentId}
                    label="Download the record (PDF)"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="files-heading">
        <h2 id="files-heading">Files from your designer</h2>
        {folders.length === 0 ? (
          <p className="muted small">Nothing has been shared with you yet.</p>
        ) : (
          folders.map(([folderName, documents]) => (
            <div key={folderName} className="portal-folder">
              <h3 className="small portal-folder-name">{folderName}</h3>
              <ul className="portal-list">
                {documents.map((document) => (
                  <li key={document.id} className="portal-document">
                    <div className="row-between">
                      <strong>{document.title}</strong>
                      <span className="small muted">{formatDate(document.createdAt)}</span>
                    </div>
                    {document.kind === 'FILE' ? (
                      <DownloadButton
                        token={token}
                        documentId={document.id}
                        label={
                          document.byteSize !== null
                            ? `Download (${formatBytes(document.byteSize)})`
                            : 'Download'
                        }
                      />
                    ) : document.kind === 'LINK' && document.url ? (
                      <a
                        className="btn btn-sm"
                        href={document.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                      >
                        Open link
                      </a>
                    ) : document.body ? (
                      <p className="small portal-note">{document.body}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {view.milestones.length > 0 ? (
        <section className="card" aria-labelledby="dates-heading">
          <h2 id="dates-heading">Key dates</h2>
          <ul className="portal-list">
            {view.milestones.map((milestone) => (
              <li key={milestone.id} className="row-between">
                <span>
                  {milestone.title}
                  <span className="small muted"> · {MILESTONE_KIND_LABELS[milestone.kind]}</span>
                </span>
                <span className="small tabular">
                  {milestone.completedAt ? 'Done' : formatDate(milestone.dueDate)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.canAskForChange ? <AskForChange token={token} /> : null}

      <footer className="small muted portal-foot">
        <p>
          Shared with {view.contactName} by {view.organizationName}. This link is private to you
          and works until {formatDate(view.expiresAt)}. Please do not forward it.
        </p>
      </footer>
    </main>
  );
}

function groupByFolder(
  documents: PortalViewDto['documents'],
): Array<[string, PortalViewDto['documents']]> {
  const groups = new Map<string, PortalViewDto['documents']>();
  for (const document of documents) {
    const list = groups.get(document.folderName);
    if (list) list.push(document);
    else groups.set(document.folderName, [document]);
  }
  return [...groups.entries()];
}
