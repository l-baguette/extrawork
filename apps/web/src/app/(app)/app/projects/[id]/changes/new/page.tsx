import Link from 'next/link';
import type { CustomerDto, ProjectDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { Composer } from '@/features/composer/composer';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';

/** Mobile change composer — report §6.2 `/app/projects/{id}/changes/new`. */
export const dynamic = 'force-dynamic';

export default async function NewChangePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectResult = await serverGet<ProjectDto>(`/v1/projects/${id}`);

  if (!projectResult.ok && projectResult.status === 401) return <SignInPrompt />;
  if (!projectResult.ok) return <ErrorPanel message={projectResult.message} />;

  const project = projectResult.data;

  if (project.status === 'INTEGRITY_REVIEW') {
    return (
      <ErrorPanel
        title="New requests are paused for this project"
        message="This project is under integrity review, so a new change cannot be sent until an administrator has repaired its totals."
      />
    );
  }
  if (project.status === 'CLOSED' || project.status === 'ARCHIVED') {
    return (
      <ErrorPanel
        title="This project is closed"
        message="Reopen the project before recording further extra work."
      />
    );
  }

  const customerResult = await serverGet<CustomerDto>(`/v1/customers/${project.customerId}`);
  const contacts = customerResult.ok ? customerResult.data.contacts : [];

  return (
    <main className="page">
      <p className="small muted">
        <Link href={`/app/projects/${project.id}`}>← {project.projectNumber}</Link> ·{' '}
        {project.customerName}
      </p>

      <Composer
        projectId={project.id}
        projectCurrency={project.currency}
        contacts={contacts}
        defaultApproverContactId={project.defaultApproverContactId}
      />
    </main>
  );
}
