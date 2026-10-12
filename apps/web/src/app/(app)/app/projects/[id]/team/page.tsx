import type { EmployeeDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { ProjectTeam } from '../project-team';

/**
 * Everyone on the project: the site team who message in on WhatsApp, the
 * collaborators from other firms, and who is responsible for what.
 */
export const dynamic = 'force-dynamic';

export default async function ProjectTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employeesResult = await serverGet<{ items: EmployeeDto[] }>('/v1/employees');
  const employees = employeesResult.ok ? employeesResult.data.items : [];

  return (
    <>
      <ProjectTeam projectId={id} initialEmployees={employees} />
    </>
  );
}
