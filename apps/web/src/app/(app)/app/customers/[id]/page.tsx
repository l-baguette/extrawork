import Link from 'next/link';
import type { ContactDto, CustomerDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { formatMoney } from '@/lib/format';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { Empty, SheetTop } from '@/components/sheet';
import { CustomerEditor } from './customer-editor';

/**
 * One customer: who they are, the people who may approve on their behalf, and
 * every project of theirs this person can see (notes: "personal info, phone
 * number, which projects are associated with them").
 *
 * The project list comes from the same endpoint, already filtered to the
 * viewer's project grants, so a designer scoped to some projects never learns
 * the titles of the others.
 */
export const dynamic = 'force-dynamic';

interface CustomerDetail extends Omit<CustomerDto, 'projectCount'> {
  contacts: ContactDto[];
  projects: Array<{
    id: string;
    projectNumber: string;
    title: string;
    status: string;
    revisedTotalMinor: number;
    currency: string;
  }>;
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  CLOSED: 'Closed',
  ARCHIVED: 'Archived',
  INTEGRITY_REVIEW: 'Under review',
};

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await serverGet<CustomerDetail>(`/v1/customers/${id}`);

  if (!result.ok && result.status === 401) return <SignInPrompt />;
  if (!result.ok) return <ErrorPanel message={result.message} />;

  const customer = result.data;

  return (
    <>
      <SheetTop
        title={customer.displayName}
        meta={customer.legalName ?? 'Customer'}
        actions={
          <Link className="btn btn-primary btn-sm" href="/app/projects/new">
            New project
          </Link>
        }
      />

      <main className="sheet rule-in">
        <CustomerEditor
          customerId={customer.id}
          lockVersion={customer.lockVersion}
          initial={{
            displayName: customer.displayName,
            legalName: customer.legalName,
            notes: customer.notes,
          }}
          contacts={customer.contacts}
        />

        <section className="panel" aria-labelledby="customer-projects">
          <h2 id="customer-projects">Projects</h2>
          {customer.projects.length === 0 ? (
            <Empty title="No projects yet">
              Start one from <Link href="/app/projects/new">New project</Link> and choose this
              customer.
            </Empty>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Contract value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {customer.projects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <Link href={`/app/projects/${project.id}`}>
                          <strong>{project.projectNumber}</strong>
                        </Link>
                        <div className="small muted">{project.title}</div>
                      </td>
                      <td>{STATUS_LABELS[project.status] ?? project.status}</td>
                      <td className="num tabular">
                        {formatMoney(project.revisedTotalMinor, project.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="hint">
          <Link href="/app/customers">All customers</Link>
        </p>
      </main>
    </>
  );
}
