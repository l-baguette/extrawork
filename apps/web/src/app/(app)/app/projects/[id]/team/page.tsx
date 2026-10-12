import type {
  CurrentUserDto,
  EmployeeDto,
  ProjectCollaboratorsDto,
  ProjectDto,
} from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { ErrorPanel } from '@/components/error-panel';
import { Block } from '@/components/sheet';
import { ProjectTeam } from '../project-team';
import { ProjectPeople } from './project-people';
import { RaciMatrix } from './raci-matrix';

/**
 * Everyone on the project — spec 2026-10-12, D1 and D2: the people with
 * access (the firm's staff and collaborators from other firms), inviting more,
 * the site team who message in on WhatsApp, and who is responsible for what.
 */
export const dynamic = 'force-dynamic';

/** The roles that act for the designer firm (domain DESIGNER_ROLES). */
const DESIGNER_ROLES = new Set(['OWNER', 'ADMIN', 'PROJECT_MANAGER']);

export default async function ProjectTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [meResult, projectResult, peopleResult] = await Promise.all([
    serverGet<CurrentUserDto>('/v1/auth/me'),
    serverGet<ProjectDto>(`/v1/projects/${id}`),
    serverGet<ProjectCollaboratorsDto>(`/v1/projects/${id}/collaborators`),
  ]);
  // The layout already handles a missing or forbidden project.
  if (!projectResult.ok) return null;
  if (!peopleResult.ok) return <ErrorPanel message={peopleResult.message} />;

  const me = meResult.ok ? meResult.data : null;
  const active = me?.memberships.find((m) => m.organizationId === me.activeOrganizationId);
  const role = active?.role ?? null;
  const canManage = role !== null && DESIGNER_ROLES.has(role);
  const isCollaborator = role === 'COLLABORATOR';
  // Roster writes are owner/admin only (employee:update); designers see it.
  const canEditRoster = role === 'OWNER' || role === 'ADMIN';

  // The roster is the firm's: collaborators are refused it by the API, so it
  // is not asked for on their behalf.
  const employeesResult = isCollaborator
    ? null
    : await serverGet<{ items: EmployeeDto[] }>('/v1/employees');
  const employees = employeesResult?.ok ? employeesResult.data.items : [];
  const onProject = employees.filter(
    (e) => e.status === 'ACTIVE' && (e.allProjects || e.projectIds.includes(id)),
  );

  const project = projectResult.data;
  const { people, invitations } = peopleResult.data;

  return (
    <>
      <ProjectPeople
        projectId={id}
        projectTitle={project.title}
        people={people}
        invitations={invitations}
        canManage={canManage}
        currentUserId={me?.user.id ?? null}
      />

      {isCollaborator ? null : (
        <ProjectTeam projectId={id} initialEmployees={employees} canEdit={canEditRoster} />
      )}

      <Block title="Who does what">
        <RaciMatrix
          firmName={active?.organizationName ?? null}
          customerName={project.customerName}
          people={people}
          siteTeam={onProject}
        />
      </Block>

      {/* Slice D: homeowner portal access */}
    </>
  );
}
