import Link from 'next/link';
import type { CustomerSummaryDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';

/** Customer directory — report §6.2 `/app/customers`. */
export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const result = await serverGet<{ items: CustomerSummaryDto[] }>('/v1/customers?limit=100');

  if (!result.ok && result.status === 401) return <SignInPrompt />;
  if (!result.ok) return <ErrorPanel message={result.message} />;

  const customers = result.data.items;

  return (
    <main className="page page-wide">
      <h1 style={{ marginBottom: 'var(--space-4)' }}>Customers</h1>

      {customers.length === 0 ? (
        <div className="card">
          <h2>No customers yet</h2>
          <p className="muted">
            Add a customer when you create your first project. Record the person authorised to
            approve extra cost — that is who approval links are addressed to.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Approver</th>
                  <th scope="col">Contact</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Projects
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => {
                  const { approver } = customer;
                  return (
                    <tr key={customer.id}>
                      <td>
                        <strong>{customer.displayName}</strong>
                        {customer.legalName ? (
                          <div className="small muted">{customer.legalName}</div>
                        ) : null}
                      </td>
                      <td>
                        {approver?.name ?? <span className="muted">None recorded</span>}
                        {approver?.authorityNote ? (
                          <div className="small muted">{approver.authorityNote}</div>
                        ) : null}
                      </td>
                      <td className="small">
                        {approver?.phoneE164 ?? approver?.email ?? <span className="muted">—</span>}
                      </td>
                      <td className="tabular" style={{ textAlign: 'right' }}>
                        {customer.projectCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="small muted">
        <Link href="/app/projects">Projects</Link> are where extra work is recorded.
      </p>
    </main>
  );
}
