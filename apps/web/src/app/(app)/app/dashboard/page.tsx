import Link from 'next/link';
import type { DashboardDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { formatMoney, formatMoneyCompact, formatRelative } from '@/lib/format';
import { StatusChip } from '@/components/status-chip';
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
  const result = await serverGet<DashboardDto>('/v1/dashboard');

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

  return (
    <>
      <SheetTop
        title="Overview"
        meta={`Live register · ${period}`}
        actions={
          <Link className="btn btn-primary" href="/app/projects">
            <IconPlus />
            New change request
          </Link>
        }
      />

      <main className="sheet rule-in">
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
            label="Unbilled projects"
            value={data.projectsWithUnbilledApprovedExtras}
            note="Approved extras not yet invoiced"
          />
        </div>

        <Block
          title="Waiting on the customer"
          action={
            data.awaitingDecision.length > 0 ? (
              <Link className="btn btn-sm" href="/app/requests">
                All requests
              </Link>
            ) : null
          }
        >
          {data.awaitingDecision.length === 0 ? (
            <Empty
              title="Nothing is waiting on a customer"
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
                  code={<StatusChip status={row.status} />}
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
                  code={<StatusChip status={row.status} />}
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
