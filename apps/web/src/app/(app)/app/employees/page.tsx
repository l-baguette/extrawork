import type { EmployeeDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { EmployeeManager, type ProjectOption } from './employee-manager';

/**
 * The employee roster — who may raise a change request by WhatsApp.
 *
 * There is no login for these people: the phone number the owner enters here is
 * their whole identity. That is the point of the channel, and it is why the
 * number and the approval ceiling are the two fields that matter most.
 */
export const dynamic = 'force-dynamic';

export default async function EmployeesPage() {
  const [employeesResult, projectsResult] = await Promise.all([
    serverGet<{ items: EmployeeDto[] }>('/v1/employees'),
    serverGet<{ items: ProjectOption[] }>('/v1/projects?limit=100'),
  ]);

  if (!employeesResult.ok && employeesResult.status === 401) return <SignInPrompt />;
  if (!employeesResult.ok) return <ErrorPanel message={employeesResult.message} />;

  return (
    <main className="page page-wide">
      <h1 style={{ marginBottom: 'var(--space-2)' }}>Employees</h1>
      <p className="muted" style={{ marginBottom: 'var(--space-4)' }}>
        People who can request approval for extra work by sending one WhatsApp message. They do not
        sign in — their phone number identifies them.
      </p>

      <EmployeeManager
        initialEmployees={employeesResult.data.items}
        projects={projectsResult.ok ? projectsResult.data.items : []}
      />
    </main>
  );
}
