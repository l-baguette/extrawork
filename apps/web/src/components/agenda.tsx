import Link from 'next/link';
import type { CalendarEventDto } from '@extrawork/contracts';
import { EVENT_KIND_LABELS, eventCode, formatDay, groupByDate, relativeDay } from '@/lib/calendar';

/** A day-by-day list of events; shared with the all-projects timeline. */
export function Agenda({
  events,
  today,
  showProject = false,
}: {
  events: CalendarEventDto[];
  today: string;
  showProject?: boolean;
}) {
  const groups = groupByDate(events);
  return (
    <ol className="agenda">
      {[...groups.entries()].map(([date, items]) => (
        <li key={date} className="agenda-day" data-today={date === today ? 'true' : undefined}>
          <div className="agenda-date">
            <span>{formatDay(date)}</span>
            <span className="small muted">{relativeDay(date, today)}</span>
          </div>
          <ul className="agenda-events">
            {items.map((event) => {
              const code = eventCode(event);
              return (
                <li key={event.id}>
                  <span className={`code code-${code.tone}`} data-code={code.code}>
                    {EVENT_KIND_LABELS[event.kind]}
                  </span>
                  <Link href={event.linkPath} className="agenda-title">
                    {event.title}
                  </Link>
                  {showProject ? (
                    <span className="small muted">
                      {event.projectNumber} · {event.projectTitle}
                    </span>
                  ) : null}
                  {event.detail ? <span className="small muted">{event.detail}</span> : null}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
