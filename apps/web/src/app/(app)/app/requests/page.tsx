import Link from 'next/link';
import {
  WORK_CATEGORY_LABELS,
  WorkCategorySchema,
  type ChangeOrderSummaryDto,
  type EmployeeDto,
  type ProjectSummaryDto,
  type WorkCategory,
} from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { activeMembership, isDesigner } from '@/lib/active-role';
import { formatMoney, formatRelative } from '@/lib/format';
import { RequestStatusChip } from '@/components/status-chip';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { Empty, Schedule, ScheduleRow, SheetTop } from '@/components/sheet';
import { PasteMessageCard } from './paste-message-card';

/**
 * Every request across every project — notes: "this tab shows an overview of
 * all requests… click and navigate to them… go to projects from the requests".
 *
 * Tabs follow the statuses the notes name (pending, approved, denied, change
 * requested) plus the one that only exists because everything goes through the
 * designer: requests waiting for review.
 *
 * The Needs review tab also carries the paste card (Tier 1 C), for the
 * contractor who messaged the designer directly instead of the ExtraWork
 * number; it lands the request in the same queue. A type-of-work filter
 * narrows any tab ("show me every electrical change").
 */
export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'review', label: 'Needs review', query: 'bucket=REVIEW' },
  { key: 'pending', label: 'Waiting on client', query: 'bucket=PENDING' },
  { key: 'approved', label: 'Approved', query: 'status=APPROVED' },
  { key: 'revision', label: 'Change requested', query: 'status=REVISION_REQUESTED' },
  { key: 'declined', label: 'Declined', query: 'status=DECLINED' },
  { key: 'drafts', label: 'Drafts', query: 'bucket=DRAFT' },
  { key: 'all', label: 'All', query: '' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; workCategory?: string }>;
}) {
  const params = await searchParams;
  const tab = TABS.find((t) => t.key === params.tab) ?? TABS[0];
  const parsedCategory = WorkCategorySchema.safeParse(params.workCategory);
  const workCategory: WorkCategory | null = parsedCategory.success ? parsedCategory.data : null;
  const query = ['limit=100', tab.query, workCategory ? `workCategory=${workCategory}` : ''].filter(
    Boolean,
  );

  const [result, membership] = await Promise.all([
    serverGet<{ items: ChangeOrderSummaryDto[]; nextCursor: string | null }>(
      `/v1/change-orders?${query.join('&')}`,
    ),
    activeMembership(),
  ]);

  if (!result.ok && result.status === 401) return <SignInPrompt />;
  if (!result.ok) return <ErrorPanel message={result.message} />;
  const items = result.data.items;

  // The paste card attributes a request to a site-team member, which only the
  // design team may do (and only they can read the roster).
  const showPaste = tab.key === 'review' && isDesigner(membership?.role);
  const [projectsResult, employeesResult] = showPaste
    ? await Promise.all([
        serverGet<{ items: ProjectSummaryDto[] }>('/v1/projects?status=ACTIVE&limit=100'),
        serverGet<{ items: EmployeeDto[] }>('/v1/employees?status=ACTIVE'),
      ])
    : [null, null];
  const projects = projectsResult?.ok ? projectsResult.data.items : [];
  const employees = employeesResult?.ok ? employeesResult.data.items : [];

  return (
    <>
      <SheetTop title="Requests" meta="Every change request on every project" />
      <main className="sheet rule-in">
        <nav className="tabbar" aria-label="Request status">
          {TABS.map((t) => (
            <Link
              key={t.key}
              className="tab"
              href={tabHref(t.key, workCategory)}
              aria-current={t.key === tab.key ? 'page' : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {showPaste ? <PasteMessageCard projects={projects} employees={employees} /> : null}

        <form className="request-filter" method="get" aria-label="Filter requests">
          {tab.key === 'review' ? null : <input type="hidden" name="tab" value={tab.key} />}
          <label htmlFor="filter-work-category">Type of work</label>
          <select id="filter-work-category" name="workCategory" defaultValue={workCategory ?? ''}>
            <option value="">Every type</option>
            {(Object.entries(WORK_CATEGORY_LABELS) as Array<[WorkCategory, string]>).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </select>
          <button type="submit" className="btn btn-sm">
            Filter
          </button>
          {workCategory ? (
            <Link className="small" href={tabHref(tab.key, null)}>
              Clear
            </Link>
          ) : null}
        </form>

        {items.length === 0 ? (
          workCategory ? (
            <Empty title={`No ${WORK_CATEGORY_LABELS[workCategory].toLowerCase()} requests here`}>
              Clear the filter to see every type of work.
            </Empty>
          ) : (
            <Empty title={emptyTitle(tab.key)}>{emptyBody(tab.key)}</Empty>
          )
        ) : (
          <Schedule columns={['Request', 'Status', 'Project', 'Value', 'Updated']}>
            {items.map((row) => (
              <ScheduleRow
                key={row.id}
                href={`/app/changes/${row.id}`}
                mark={row.number}
                code={<RequestStatusChip status={row.status} awaitingReview={row.awaitingReview} />}
                title={row.title}
                sub={[
                  `${row.projectNumber} ${row.projectTitle}`,
                  row.room,
                  row.workCategory ? WORK_CATEGORY_LABELS[row.workCategory] : null,
                  row.submittedByLabel ? `from ${row.submittedByLabel}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                amount={
                  row.totalDeltaMinor === 0 && row.awaitingReview
                    ? 'To price'
                    : formatMoney(row.totalDeltaMinor, row.currency)
                }
                amountNote={formatRelative(row.updatedAt)}
              />
            ))}
          </Schedule>
        )}
      </main>
    </>
  );
}

function tabHref(tab: TabKey, workCategory: WorkCategory | null): string {
  const query = new URLSearchParams();
  if (tab !== 'review') query.set('tab', tab);
  if (workCategory) query.set('workCategory', workCategory);
  const search = query.toString();
  return search ? `/app/requests?${search}` : '/app/requests';
}

function emptyTitle(tab: TabKey): string {
  switch (tab) {
    case 'review':
      return 'Nothing waiting for review';
    case 'pending':
      return 'Nothing is waiting on a client';
    default:
      return 'No requests here';
  }
}

function emptyBody(tab: TabKey): string {
  switch (tab) {
    case 'review':
      return 'When a contractor, your site team or a homeowner raises a request — on WhatsApp or in the app — it waits here for you to check, price and send.';
    case 'pending':
      return 'Requests you have sent appear here until the client approves, declines or asks for a change.';
    default:
      return 'Requests in this state will be listed here.';
  }
}
