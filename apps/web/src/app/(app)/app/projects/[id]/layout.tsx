import Link from 'next/link';
import type { ChangeRegisterDto, ProjectDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { DownloadContract } from './download-contract';
import { ProjectTabs } from './project-tabs';

/**
 * The project as a shared folder — spec 2026-10-12. One header and one set of
 * section tabs for every page under the project, so Overview, Requests, Files,
 * Team and Timeline read as parts of one thing rather than separate screens.
 */
export const dynamic = 'force-dynamic';

export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const [projectResult, registerResult] = await Promise.all([
    serverGet<ProjectDto>(`/v1/projects/${id}`),
    serverGet<ChangeRegisterDto>(`/v1/projects/${id}/change-register`),
  ]);

  if (!projectResult.ok && projectResult.status === 401) return <SignInPrompt />;
  if (!projectResult.ok) return <ErrorPanel message={projectResult.message} />;

  const project = projectResult.data;
  const changes = registerResult.ok ? registerResult.data.changes : [];
  const closed = project.status === 'CLOSED' || project.status === 'ARCHIVED';

  return (
    <main className="page page-wide">
      {project.status === 'INTEGRITY_REVIEW' ? (
        <div className="banner banner-error" role="alert">
          <strong>This project is under integrity review.</strong> The recorded total does not match
          a recomputation from its approved changes. New requests cannot be sent until an
          administrator has repaired it. Existing records remain readable.
        </div>
      ) : null}
      {closed ? (
        <div className="banner" role="status">
          <strong>This project is closed.</strong> Its record stays readable and downloadable; new
          requests cannot be raised against it.
        </div>
      ) : null}

      <div className="row-between" style={{ marginBottom: 'var(--space-4)' }}>
        <div>
          <h1>{project.title}</h1>
          <p className="muted small" style={{ marginBottom: 0 }}>
            {project.projectNumber} · {project.customerName}
            {project.siteAddress?.city ? ` · ${project.siteAddress.city}` : ''}
          </p>
        </div>
        <div className="actions">
          <DownloadContract project={project} changes={changes} />
          {closed ? null : (
            <Link
              className="btn btn-primary"
              href={`/app/projects/${project.id}/changes/new`}
              aria-disabled={project.status === 'INTEGRITY_REVIEW'}
            >
              New change request
            </Link>
          )}
        </div>
      </div>

      <ProjectTabs
        projectId={project.id}
        counts={{
          '/requests': project.awaitingReviewCount > 0 ? project.awaitingReviewCount : undefined,
        }}
      />

      {children}
    </main>
  );
}
