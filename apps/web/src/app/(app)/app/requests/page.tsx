import Link from 'next/link';
import type { ChangeOrderSummaryDto } from '@extrawork/contracts';
import { WORK_CATEGORY_LABELS } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { formatMoney, formatRelative } from '@/lib/format';
import { RequestStatusChip } from '@/components/status-chip';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { Empty, Schedule, ScheduleRow, SheetTop } from '@/components/sheet';

/**
 * Every request across every project — notes: "this tab shows an overview of
 * all requests… click and navigate to them… go to projects from the requests".
 *
 * Tabs follow the statuses the notes name (pending, approved, denied, change
 * requested) plus the one that only exists because everything goes through the
 * designer: requests waiting for review.
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
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const tab = TABS.find((t) => t.key === params.tab) ?? TABS[0];
  const result = await serverGet<{ items: ChangeOrderSummaryDto[]; nextCursor: string | null }>(
    `/v1/change-orders?limit=100${tab.query ? `&${tab.query}` : ''}`,
  );

  if (!result.ok && result.status === 401) return <SignInPrompt />;
  if (!result.ok) return <ErrorPanel message={result.message} />;
  const items = result.data.items;

  return (
    <>
      <SheetTop title="Requests" meta="Every change request on every project" />
      <main className="sheet rule-in">
        <nav className="tabbar" aria-label="Request status">
          {TABS.map((t) => (
            <Link
              key={t.key}
              className="tab"
              href={t.key === 'review' ? '/app/requests' : `/app/requests?tab=${t.key}`}
              aria-current={t.key === tab.key ? 'page' : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {items.length === 0 ? (
          <Empty title={emptyTitle(tab.key)}>{emptyBody(tab.key)}</Empty>
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
