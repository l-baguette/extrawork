import Link from 'next/link';
import {
  WORK_CATEGORY_LABELS,
  type ChangeOrderSummaryDto,
  type DashboardDto,
} from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { activeMembership, isDesigner } from '@/lib/active-role';
import { formatMoney, formatMoneyCompact, formatRelative } from '@/lib/format';
import { RequestStatusChip } from '@/components/status-chip';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { Block, Empty, Figure, Schedule, ScheduleRow, SheetTop } from '@/components/sheet';
import { IconPlus } from '@/components/icons';

/**
 * The overview — report §6.2 and §6.6.
 *
 * The figures across the top are exactly the ones the report specifies:
 * pending customer decisions, requests overdue or expiring, approved extras
 * this month, average time to decision, and projects with unbilled approved
 * extras. Server-rendered from a pre-aggregated projection rather than scanning
 * audit events (report §6.6).
 *
 * No single figure owns the page. The owner confirmed they come here for
 * general management rather than one number, so the money reads at the same
 * weight as the queue and both sit above the live schedule.
 *
 * Spec 2026-10-12, D4: everything goes through the designer, so the first
 * block is the designer's own queue — requests raised on WhatsApp, by a
 * contractor or by the homeowner that wait for them to price and send — then
 * what waits on the customer, then what was decided.
 *
 * A collaborator (another firm, or the homeowner on the team) gets the same
 * page scoped to them: their own requests with the design team and the
 * decisions on their projects. The API returns the firm's money figures to
 * them as zero, so this page does not show them at all.
 */
export const dynamic = 'force-dynamic';

/**
 * "0.0h" reads as a broken figure rather than a fast one, and a business that
 * decides in forty minutes deserves to see that.
 */
function formatDecisionTime(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export default async function DashboardPage() {
  const [result, membership] = await Promise.all([
    serverGet<DashboardDto>('/v1/dashboard'),
    activeMembership(),
  ]);

  if (!result.ok && result.status === 401) return <SignInPrompt />;
  if (!result.ok) {
    return (
      <>
        <SheetTop title="Overview" />
        <main className="sheet">
          <div className="banner banner-error" role="alert">
            The overview could not be loaded. Your records are unaffected — please refresh.
          </div>
        </main>
      </>
    );
  }

  const data = result.data;
  const now = new Date();
  const period = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(now);
  const collaborator = data.audience === 'COLLABORATOR';
  const designer = isDesigner(membership?.role);

  return (
    <>
      <SheetTop
        title="Overview"
        meta={collaborator ? 'Your projects and requests' : `Live register · ${period}`}
        actions={
          designer || collaborator ? (
            <Link className="btn btn-primary" href="/app/projects">
              <IconPlus />
              {collaborator ? 'Raise a request' : 'New change request'}
            </Link>
          ) : null
        }
      />

      <main className="sheet rule-in">
        {collaborator ? (
          <div className="figures" style={{ marginBottom: 'var(--s6)' }}>
            <Figure
              label="With the design team"
              value={data.awaitingReviewCount}
              note="Your requests waiting to be priced and sent"
            />
            <Figure
              label="Awaiting the homeowner"
              value={data.pendingDecisions}
              note={
                data.overdueOrExpiring > 0 ? (
                  <>
                    <strong>{data.overdueOrExpiring}</strong> overdue or expiring
                  </>
                ) : (
                  'None overdue'
                )
              }
            />
          </div>
        ) : null}

        <Block
          title={collaborator ? 'Your requests with the design team' : 'Needs review'}
          action={
            data.awaitingReviewCount > data.awaitingReview.length ? (
              <Link className="btn btn-sm" href="/app/requests">
                All {data.awaitingReviewCount}
              </Link>
            ) : null
          }
        >
          {data.awaitingReview.length === 0 ? (
            collaborator ? (
              <Empty
                title="Nothing waiting with the design team"
                action={
                  <Link className="btn" href="/app/projects">
                    Open a project
                  </Link>
                }
              >
                When you raise a request, it waits here until the designer prices it and sends it to
                the homeowner.
              </Empty>
            ) : (
              <Empty title="Nothing waiting for review">
                Requests raised on WhatsApp, by a contractor or by the homeowner wait here for you
                to check, price and send.
              </Empty>
            )
          ) : (
            <Schedule columns={['Request', 'Status', 'Project', 'Value', 'Raised']}>
              {data.awaitingReview.map((row) => (
                <ScheduleRow
                  key={row.id}
                  href={`/app/changes/${row.id}`}
                  mark={row.number}
                  code={<RequestStatusChip status={row.status} awaitingReview />}
                  title={row.title}
                  sub={reviewSub(row, collaborator)}
                  amount={
                    row.totalDeltaMinor === 0
                      ? 'To price'
                      : formatMoney(row.totalDeltaMinor, row.currency)
                  }
                  amountNote={formatRelative(row.updatedAt)}
                />
              ))}
            </Schedule>
          )}
        </Block>

        {collaborator ? null : (
          <div className="figures figures-4" style={{ marginBottom: 'var(--s6)' }}>
            <Figure
              label="Awaiting a decision"
              value={data.pendingDecisions}
              note={
                data.overdueOrExpiring > 0 ? (
                  <>
                    <strong>{data.overdueOrExpiring}</strong> overdue or expiring
                  </>
                ) : (
                  'None overdue'
                )
              }
            />
            <Figure
              label="Approved this month"
              value={formatMoneyCompact(data.approvedValueThisMonthMinor, data.currency)}
              note="Extra work signed off"
            />
            <Figure
              label="Average to decide"
              value={formatDecisionTime(data.averageHoursToDecision)}
              note="From send to customer decision"
            />
            <Figure
              label="Approved, not invoiced"
              value={formatMoneyCompact(data.unbilledApprovedTotalMinor, data.currency)}
              note={
                data.unbilledApprovedCount > 0 ? (
                  <Link href="/app/reports#unbilled">
                    {data.unbilledApprovedCount} change
                    {data.unbilledApprovedCount === 1 ? '' : 's'} to bill
                  </Link>
                ) : (
                  'Nothing to bill'
                )
              }
            />
          </div>
        )}

        <Block
          title={collaborator ? 'Waiting on the homeowner' : 'Waiting on the customer'}
          action={
            data.awaitingDecision.length > 0 ? (
              <Link className="btn btn-sm" href="/app/requests?tab=pending">
                All waiting
              </Link>
            ) : null
          }
        >
          {data.awaitingDecision.length === 0 ? (
            <Empty
              title={
                collaborator
                  ? 'Nothing is waiting on the homeowner'
                  : 'Nothing is waiting on a customer'
              }
              action={
                <Link className="btn" href="/app/projects">
                  Open a project
                </Link>
              }
            >
              When a request is sent, it appears here until the customer approves, declines or asks
              for a change.
            </Empty>
          ) : (
            <Schedule columns={['Change', 'Status', 'Project', 'Value', 'Expires']}>
              {data.awaitingDecision.map((row) => (
                <ScheduleRow
                  key={row.id}
                  href={`/app/changes/${row.id}`}
                  mark={row.number}
                  code={
                    <RequestStatusChip status={row.status} awaitingReview={row.awaitingReview} />
                  }
                  title={row.title}
                  sub={`${row.projectTitle} · ${row.customerName}`}
                  amount={formatMoney(row.totalDeltaMinor, row.currency)}
                  amountNote={formatRelative(row.expiresAt)}
                />
              ))}
            </Schedule>
          )}
        </Block>

        <Block title="Recent decisions">
          {data.recentDecisions.length === 0 ? (
            <Empty title="No decisions recorded yet">
              Every approval, decline and revision request will be listed here with the exact
              version the customer saw.
            </Empty>
          ) : (
            <Schedule columns={['Change', 'Status', 'Project', 'Value', 'Decided']}>
              {data.recentDecisions.map((row) => (
                <ScheduleRow
                  key={row.id}
                  href={`/app/changes/${row.id}`}
                  mark={row.number}
                  code={
                    <RequestStatusChip status={row.status} awaitingReview={row.awaitingReview} />
                  }
                  title={row.title}
                  sub={`${row.projectTitle} · ${row.customerName}`}
                  amount={formatMoney(row.totalDeltaMinor, row.currency)}
                  amountNote={formatRelative(row.decidedAt)}
                />
              ))}
            </Schedule>
          )}
        </Block>
      </main>
    </>
  );
}

/**
 * Where and what, and who asked: the three things a designer needs to decide
 * whether to open it now. A collaborator raised it themselves, so not "from".
 */
function reviewSub(row: ChangeOrderSummaryDto, collaborator: boolean): string {
  return [
    `${row.projectNumber} ${row.projectTitle}`,
    row.room,
    row.workCategory ? WORK_CATEGORY_LABELS[row.workCategory] : null,
    !collaborator && row.submittedByLabel ? `from ${row.submittedByLabel}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
