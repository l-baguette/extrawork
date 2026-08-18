import Link from 'next/link';
import type { ProjectSummaryDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { formatMoney, formatMoneyCompact } from '@/lib/format';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { Empty, SheetTop } from '@/components/sheet';
import { IconPlus } from '@/components/icons';

/** Project list — report §6.2 `/app/projects`. */
export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const result = await serverGet<{ items: ProjectSummaryDto[]; nextCursor: string | null }>(
    '/v1/projects?limit=50',
  );

  if (!result.ok && result.status === 401) return <SignInPrompt />;
  if (!result.ok) return <ErrorPanel message={result.message} />;

  const projects = result.data.items;
  const totalRevised = projects.reduce((sum, p) => sum + p.revisedTotalMinor, 0);
  const totalApproved = projects.reduce((sum, p) => sum + p.approvedDeltaMinor, 0);
  const currency = projects[0]?.currency ?? 'INR';

  return (
    <>
      <SheetTop
        title="Projects"
        meta={
          projects.length > 0
            ? `${projects.length} project${projects.length === 1 ? '' : 's'} · ${formatMoneyCompact(totalApproved, currency)} in approved extras`
            : 'The original contract value each change is measured against'
        }
        actions={
          <Link className="btn btn-primary" href="/app/projects/new">
            <IconPlus />
            New project
          </Link>
        }
      />

      <main className="sheet rule-in">
        {projects.length === 0 ? (
          <div className="panel">
            <Empty
              title="No projects yet"
              action={
                <Link className="btn btn-primary" href="/app/projects/new">
                  Create your first project
                </Link>
              }
            >
              A project holds the original contract value. Once it exists you can record extra work
              against it and send it to the customer for approval.
            </Empty>
          </div>
        ) : (
          <div className="panel">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th scope="col">Customer</th>
                    <th scope="col" className="num">
                      Original
                    </th>
                    <th scope="col" className="num">
                      Approved extras
                    </th>
                    <th scope="col" className="num">
                      Revised total
                    </th>
                    <th scope="col" className="num">
                      Waiting
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <Link href={`/app/projects/${project.id}`}>
                          <strong className="mono">{project.projectNumber}</strong>
                        </Link>
                        <div className="small muted">{project.title}</div>
                      </td>
                      <td>
                        {project.customerName}
                        {project.status !== 'ACTIVE' ? (
                          <div className="small muted">{project.status.replace(/_/g, ' ')}</div>
                        ) : null}
                      </td>
                      <td className="num">
                        {formatMoney(project.baselineTotalMinor, project.currency)}
                      </td>
                      <td className="num">
                        {formatMoney(project.approvedDeltaMinor, project.currency)}
                      </td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {formatMoney(project.revisedTotalMinor, project.currency)}
                      </td>
                      <td className="num">
                        {project.pendingChangeCount > 0 ? (
                          <span className="code code-waiting" data-code="W">
                            {project.pendingChangeCount}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* The one heavy rule on the sheet, exactly as a schedule carries
                    its total forward at the foot of the page. */}
                <tfoot>
                  <tr className="table-total">
                    <td colSpan={4}>All projects</td>
                    <td className="num">{formatMoney(totalRevised, currency)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
