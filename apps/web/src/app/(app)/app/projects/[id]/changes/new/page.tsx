import Link from 'next/link';
import type { ChangeOrderDto, CustomerDto, ProjectDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { activeMembership, canPropose, isDesigner } from '@/lib/active-role';
import { Composer } from '@/features/composer/composer';
import { composerValuesFromChange, reviewContextFromChange } from '@/features/composer/from-change';
import { ErrorPanel } from '@/components/error-panel';

/**
 * Mobile change composer — report §6.2 `/app/projects/{id}/changes/new`.
 *
 * With `?changeOrderId=` it opens a draft that already exists on the server
 * instead — above all a request somebody else raised for review (spec
 * 2026-10-12, D4), which the designer completes, prices and sends here. The
 * project layout provides `<main>` and the header, so this renders a `<div>`.
 */
export const dynamic = 'force-dynamic';

export default async function NewChangePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ changeOrderId?: string }>;
}) {
  const { id } = await params;
  const { changeOrderId } = await searchParams;
  const [projectResult, membership] = await Promise.all([
    serverGet<ProjectDto>(`/v1/projects/${id}`),
    activeMembership(),
  ]);

  // The layout has already rendered the sign-in prompt or the error for these.
  if (!projectResult.ok) return null;
  const project = projectResult.data;

  // Presentation only: the API refuses an edit or send from these roles anyway.
  if (membership && !isDesigner(membership.role)) {
    return canPropose(membership.role) ? (
      <Notice
        title="Requests go to the design team"
        message="You can raise a request on this project and the designer will price it and send it to the homeowner."
        action={
          <Link className="btn btn-primary" href={`/app/projects/${project.id}/requests/new`}>
            Raise a request
          </Link>
        }
      />
    ) : (
      <Notice
        title="Only the design team writes requests"
        message="Your role can read this project and its requests, but not raise or edit them."
        action={
          <Link className="btn" href={`/app/projects/${project.id}/requests`}>
            Back to requests
          </Link>
        }
      />
    );
  }

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

  let existing: React.ComponentProps<typeof Composer>['existing'];
  let review: React.ComponentProps<typeof Composer>['review'];
  if (changeOrderId) {
    const changeResult = await serverGet<ChangeOrderDto>(`/v1/change-orders/${changeOrderId}`);
    if (!changeResult.ok) return <ErrorPanel message={changeResult.message} />;
    const change = changeResult.data;
    if (change.projectId !== project.id) {
      return <ErrorPanel message="That request belongs to a different project." />;
    }
    if (change.currentVersion.status !== 'DRAFT') {
      return (
        <Notice
          title={`${change.number} has already been sent`}
          message="A sent version is frozen. Open the request to create a new version instead."
          action={
            <Link className="btn" href={`/app/changes/${change.id}`}>
              Open {change.number}
            </Link>
          }
        />
      );
    }
    existing = {
      changeOrderId: change.id,
      lockVersion: change.currentVersion.lockVersion,
      values: composerValuesFromChange(change),
    };
    review = reviewContextFromChange(change);
  }

  const customerResult = await serverGet<CustomerDto>(`/v1/customers/${project.customerId}`);
  const contacts = customerResult.ok ? customerResult.data.contacts : [];

  return (
    <div>
      <Composer
        // A different draft is a different form: remount rather than carry state over.
        key={existing?.changeOrderId ?? 'new'}
        projectId={project.id}
        projectCurrency={project.currency}
        contacts={contacts}
        defaultApproverContactId={project.defaultApproverContactId}
        {...(existing ? { existing } : {})}
        {...(review ? { review } : {})}
      />
    </div>
  );
}

/** A plain explanation inside the project page, which already provides `<main>`. */
function Notice({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action: React.ReactNode;
}) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <p>{message}</p>
      <div className="actions">{action}</div>
    </section>
  );
}
