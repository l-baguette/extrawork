import Link from 'next/link';
import type { ProjectSummaryDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { formatMoneyCompact } from '@/lib/format';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';

/** Project list — report §6.2 `/app/projects`. */
export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const result = await serverGet<{ items: ProjectSummaryDto[]; nextCursor: string | null }>(
    '/v1/projects?limit=50',
  );

  if (!result.ok && result.status === 401) return <SignInPrompt />;
  if (!result.ok) return <ErrorPanel message={result.message} />;

  const projects = result.data.items;

  return (
    <main className="page page-wide">
      <div className="row-between" style={{ marginBottom: 'var(--space-4)' }}>
        <h1>Projects</h1>
        <Link className="btn btn-primary" href="/app/projects/new">
          New project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="card">
          <h2>No projects yet</h2>
          <p className="muted">
            A project holds the original contract value. Once it exists you can record any extra
            work against it and send it for approval.
          </p>
          <Link className="btn btn-primary" href="/app/projects/new">
            Create your first project
          </Link>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Status</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Original
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Approved extras
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Revised total
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Pending
                  </th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link href={`/app/projects/${project.id}`}>
                        <strong>{project.projectNumber}</strong>
                      </Link>
                      <div className="small muted">{project.title}</div>
                    </td>
                    <td>{project.customerName}</td>
                    <td>
                      <span className="chip chip-draft">{project.status}</span>
                    </td>
                    <td className="tabular" style={{ textAlign: 'right' }}>
                      {formatMoneyCompact(project.baselineTotalMinor, project.currency)}
                    </td>
                    <td className="tabular" style={{ textAlign: 'right' }}>
                      {formatMoneyCompact(project.approvedDeltaMinor, project.currency)}
                    </td>
                    <td className="tabular" style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatMoneyCompact(project.revisedTotalMinor, project.currency)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {project.pendingChangeCount > 0 ? (
                        <span className="chip chip-pending">{project.pendingChangeCount}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
