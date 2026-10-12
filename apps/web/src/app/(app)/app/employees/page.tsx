import type { EmployeeDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { EmployeeManager, type ProjectOption } from './employee-manager';

/**
 * The site team — spec 2026-10-12, D2: people identified only by their
 * WhatsApp number, from this firm or the construction company, who send
 * requests, photos and files for their projects by message.
 *
 * There is no login for these people: the phone number entered here is their
 * whole identity. A number is unique within this team; since D7 the same
 * foreman may also be on another firm's team, and intake asks which project
 * rather than guessing.
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
      <h1 style={{ marginBottom: 'var(--space-2)' }}>Site team</h1>
      <p className="muted" style={{ marginBottom: 'var(--space-4)' }}>
        People on site — yours and the construction company&rsquo;s — who send requests, photos and
        files for their projects in a WhatsApp message. They do not sign in: their WhatsApp number
        identifies them. Someone who also needs the web app is invited from a project&rsquo;s Team
        tab.
      </p>

      <EmployeeManager
        initialEmployees={employeesResult.data.items}
        projects={projectsResult.ok ? projectsResult.data.items : []}
      />
    </main>
  );
}
