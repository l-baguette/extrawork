import Link from 'next/link';
import type { ProjectDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { activeMembership, canPropose } from '@/lib/active-role';
import { RaiseRequestForm } from './raise-request-form';

/**
 * Raise a request for the design team — spec 2026-10-12, D4. The page a
 * collaborator (the contractor, the homeowner on the team) lands on from the
 * project's primary button; a designer may use it too, but normally opens the
 * composer instead.
 *
 * Renders inside the project layout, which provides `<main>`, the header and
 * the sign-in or error panel when the project cannot be read.
 */
export const dynamic = 'force-dynamic';

export default async function RaiseRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [projectResult, membership] = await Promise.all([
    serverGet<ProjectDto>(`/v1/projects/${id}`),
    activeMembership(),
  ]);
  if (!projectResult.ok) return null;
  const project = projectResult.data;

  if (project.status === 'CLOSED' || project.status === 'ARCHIVED') {
    return (
      <section className="card">
        <h2>This project is closed</h2>
        <p>New requests cannot be raised on a closed project. Ask the designer to reopen it.</p>
        <div className="actions">
          <Link className="btn" href={`/app/projects/${project.id}/requests`}>
            Back to requests
          </Link>
        </div>
      </section>
    );
  }

  // A hint only — the API refuses a proposal from a role without
  // `change_order:propose` regardless (report §3.2).
  if (membership && !canPropose(membership.role)) {
    return (
      <section className="card">
        <h2>Your role cannot raise requests</h2>
        <p>
          You can read this project and its requests. Ask the owner of the workspace if you need to
          raise one.
        </p>
      </section>
    );
  }

  return (
    <div className="stack">
      <div>
        <h2 style={{ marginBottom: 'var(--space-1)' }}>Raise a request</h2>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Say what needs to change and where. The design team checks it and prices it before the
          homeowner sees anything.
        </p>
      </div>
      <RaiseRequestForm projectId={project.id} currency={project.currency} />
    </div>
  );
}
