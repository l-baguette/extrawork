import Link from 'next/link';
import type { CustomerSummaryDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { Empty, SheetTop } from '@/components/sheet';
import { NewCustomer } from './new-customer';

/** Customer directory — report §6.2 `/app/customers`. */
export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const result = await serverGet<{ items: CustomerSummaryDto[] }>('/v1/customers?limit=100');

  if (!result.ok && result.status === 401) return <SignInPrompt />;
  if (!result.ok) return <ErrorPanel message={result.message} />;

  const customers = result.data.items;

  return (
    <>
      <SheetTop
        title="Customers"
        meta="Who approval links are addressed to, and who may authorise extra cost"
      />

      <main className="sheet rule-in">
        <NewCustomer />
        {customers.length === 0 ? (
          <div className="panel">
            <Empty title="No customers yet">
              Add a customer when you create your first project. Record the person authorised to
              approve extra cost — that is who approval links are addressed to.
            </Empty>
          </div>
        ) : (
          <div className="panel">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Approver</th>
                    <th scope="col">Contact</th>
                    <th scope="col" className="num">
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
                          <Link href={`/app/customers/${customer.id}`}>
                            <strong>{customer.displayName}</strong>
                          </Link>
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
                        <td className="small mono">
                          {approver?.phoneE164 ?? approver?.email ?? (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="num">{customer.projectCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="hint">
          <Link href="/app/projects">Projects</Link> are where extra work is recorded against a
          customer.
        </p>
      </main>
    </>
  );
}
