import Link from 'next/link';
import type {
  CalendarDto,
  CalendarEventDto,
  CalendarFeedDto,
  ProjectSummaryDto,
} from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { SheetTop } from '@/components/sheet';
import { Agenda } from '@/components/agenda';
import { CalendarFeedCard } from '@/components/calendar-feed-card';
import {
  addMonths,
  endOfMonth,
  eventCode,
  formatMonth,
  groupByDate,
  monthGrid,
  startOfMonth,
  todayIn,
} from '@/lib/calendar';
import { ProjectFilter } from './project-filter';

/**
 * The collated calendar — spec 2026-10-12, D14: every dated fact across the
 * projects the signed-in person can see, as a month grid or an agenda, with
 * the private feed that puts the same dates on their phone.
 *
 * Navigation is plain links with search params, so the page works before any
 * script has loaded on a slow site connection.
 */
export const dynamic = 'force-dynamic';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type View = 'month' | 'agenda';

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === 'string' ? params[key] : undefined);

  const today = todayIn();
  const monthParam = one('month');
  const month = monthParam && MONTH.test(monthParam) ? `${monthParam}-01` : startOfMonth(today);
  const view: View = one('view') === 'agenda' ? 'agenda' : 'month';
  const projectParam = one('project');
  const projectId = projectParam && UUID.test(projectParam) ? projectParam : null;

  const weeks = monthGrid(month);
  const from = view === 'month' ? weeks[0]![0]! : month;
  const to = view === 'month' ? weeks.at(-1)!.at(-1)! : endOfMonth(month);

  const [calendar, projects, feed] = await Promise.all([
    serverGet<CalendarDto>(
      `/v1/calendar?from=${from}&to=${to}${projectId ? `&projectId=${projectId}` : ''}`,
    ),
    serverGet<{ items: ProjectSummaryDto[] }>('/v1/projects?limit=100'),
    serverGet<CalendarFeedDto>('/v1/calendar/feed'),
  ]);
  if (!calendar.ok && calendar.status === 401) return <SignInPrompt />;

  const href = (next: { month?: string; view?: View; project?: string | null }) => {
    const query = new URLSearchParams();
    query.set('month', (next.month ?? month).slice(0, 7));
    const nextView = next.view ?? view;
    if (nextView !== 'month') query.set('view', nextView);
    const nextProject = next.project === undefined ? projectId : next.project;
    if (nextProject) query.set('project', nextProject);
    return `/app/timeline?${query.toString()}`;
  };

  const events = calendar.ok ? calendar.data.events : [];
  const monthEvents = events.filter((e) => e.date >= month && e.date <= endOfMonth(month));

  return (
    <main className="page page-wide">
      <SheetTop
        title="Timeline"
        meta="Completion dates, milestones and approval deadlines across your projects."
      />

      <div className="cal-toolbar">
        <div className="cal-nav">
          <Link
            className="btn btn-sm"
            href={href({ month: addMonths(month, -1) })}
            aria-label="Previous month"
          >
            ←
          </Link>
          <Link className="btn btn-sm" href={href({ month: startOfMonth(today) })}>
            Today
          </Link>
          <Link
            className="btn btn-sm"
            href={href({ month: addMonths(month, 1) })}
            aria-label="Next month"
          >
            →
          </Link>
          <h2 className="cal-month">{formatMonth(month)}</h2>
        </div>
        <div className="cal-controls">
          <nav className="segmented" aria-label="View">
            <Link
              className="segmented-item"
              href={href({ view: 'month' })}
              aria-current={view === 'month' ? 'true' : undefined}
            >
              Month
            </Link>
            <Link
              className="segmented-item"
              href={href({ view: 'agenda' })}
              aria-current={view === 'agenda' ? 'true' : undefined}
            >
              Agenda
            </Link>
          </nav>
          <ProjectFilter
            projects={projects.ok ? projects.data.items : []}
            value={projectId}
            hrefFor={Object.fromEntries(
              [null, ...(projects.ok ? projects.data.items.map((p) => p.id) : [])].map((id) => [
                id ?? '',
                href({ project: id }),
              ]),
            )}
          />
        </div>
      </div>

      {!calendar.ok ? (
        <div className="banner banner-error" role="alert">
          The calendar could not be loaded: {calendar.message} Your records are unaffected.
        </div>
      ) : view === 'month' ? (
        <>
          <MonthGrid weeks={weeks} month={month} today={today} events={events} />
          {/* On a phone the grid shows marks only; the month's events follow as a list. */}
          <section className="cal-month-list" aria-label={`Events in ${formatMonth(month)}`}>
            {monthEvents.length === 0 ? (
              <p className="small muted">Nothing dated this month.</p>
            ) : (
              <Agenda events={monthEvents} today={today} showProject={!projectId} anchors />
            )}
          </section>
        </>
      ) : (
        <section className="card">
          {monthEvents.length === 0 ? (
            <p className="small muted" style={{ marginBottom: 0 }}>
              Nothing dated in {formatMonth(month)}.{' '}
              <Link href={href({ month: addMonths(month, 1) })}>Next month</Link>
            </p>
          ) : (
            <Agenda events={monthEvents} today={today} showProject={!projectId} />
          )}
        </section>
      )}

      <CalendarFeedCard initial={feed.ok ? feed.data : null} />
    </main>
  );
}

function MonthGrid({
  weeks,
  month,
  today,
  events,
}: {
  weeks: string[][];
  month: string;
  today: string;
  events: CalendarEventDto[];
}) {
  const byDate = groupByDate(events);
  const monthKey = month.slice(0, 7);
  return (
    <div className="cal-grid" role="grid" aria-label={formatMonth(month)}>
      <div className="cal-row cal-head" role="row">
        {WEEKDAYS.map((day) => (
          <span key={day} role="columnheader">
            {day}
          </span>
        ))}
      </div>
      {weeks.map((week) => (
        <div className="cal-row" role="row" key={week[0]}>
          {week.map((date) => {
            const dayEvents = byDate.get(date) ?? [];
            const inMonth = date.startsWith(monthKey);
            return (
              <div
                key={date}
                role="gridcell"
                className="cal-cell"
                data-outside={inMonth ? undefined : 'true'}
                data-today={date === today ? 'true' : undefined}
              >
                {dayEvents.length > 0 && inMonth ? (
                  <a className="cal-day" href={`#day-${date}`}>
                    {Number(date.slice(8))}
                  </a>
                ) : (
                  <span className="cal-day">{Number(date.slice(8))}</span>
                )}
                <ul className="cal-events">
                  {dayEvents.slice(0, 3).map((event) => {
                    const code = eventCode(event);
                    return (
                      <li key={event.id}>
                        <Link
                          href={event.linkPath}
                          className={`cal-event cal-event-${code.tone}`}
                          title={`${event.title} · ${event.projectTitle}`}
                        >
                          {event.title}
                        </Link>
                      </li>
                    );
                  })}
                  {dayEvents.length > 3 ? (
                    <li className="cal-more small muted">+{dayEvents.length - 3} more</li>
                  ) : null}
                </ul>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
