import type { CalendarEventDto, CalendarEventKind } from '@extrawork/contracts';

/**
 * Calendar arithmetic for the timeline pages (spec 2026-10-12, D14).
 *
 * Every date is a `YYYY-MM-DD` local calendar day, handled as a UTC date so
 * no browser time zone can shift a handover to the day before. Pure and
 * alias-free so the unit project can load it.
 */

export type LocalDate = string;

function parse(date: LocalDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

function format(date: Date): LocalDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

/** The first of the month `months` away from the month containing `date`. */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const d = parse(date);
  return format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)));
}

export function startOfMonth(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: LocalDate): LocalDate {
  return addDays(addMonths(date, 1), -1);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

/** Today's calendar date in a time zone (Asia/Kolkata unless told otherwise). */
export function todayIn(timeZone = 'Asia/Kolkata', now: Date = new Date()): LocalDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The weeks shown for a month, Monday first (the Indian working week), each a
 * run of seven dates including the days that spill in from the neighbouring
 * months.
 */
export function monthGrid(month: LocalDate): LocalDate[][] {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  // getUTCDay: Sunday 0 … Saturday 6; Monday-first offset.
  const lead = (parse(first).getUTCDay() + 6) % 7;
  let cursor = addDays(first, -lead);
  const weeks: LocalDate[][] = [];
  while (cursor <= last) {
    const week: LocalDate[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Events grouped by date, dates ascending, each day's events in input order. */
export function groupByDate<T extends { date: LocalDate }>(
  events: readonly T[],
): Map<LocalDate, T[]> {
  const sorted = [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const groups = new Map<LocalDate, T[]>();
  for (const event of sorted) {
    const list = groups.get(event.date) ?? [];
    list.push(event);
    groups.set(event.date, list);
  }
  return groups;
}

export const EVENT_KIND_LABELS: Record<CalendarEventKind, string> = {
  PROJECT_START: 'Start',
  PROJECT_COMPLETION: 'Completion',
  PROJECT_REVISED_COMPLETION: 'Revised completion',
  MILESTONE: 'Milestone',
  APPROVAL_EXPIRES: 'Link expires',
  DECISION: 'Decision',
};

/** The drafting-sheet code for an event: W waiting, A done, D lapsing, N plain. */
export function eventCode(event: Pick<CalendarEventDto, 'kind' | 'completed'>): {
  tone: 'approved' | 'waiting' | 'declined' | 'neutral';
  code: string;
} {
  if (event.kind === 'APPROVAL_EXPIRES') return { tone: 'declined', code: 'D' };
  if (event.completed) return { tone: 'approved', code: 'A' };
  if (event.kind === 'MILESTONE' || event.kind === 'PROJECT_REVISED_COMPLETION') {
    return { tone: 'waiting', code: 'W' };
  }
  return { tone: 'neutral', code: 'N' };
}

/** "Mon 3 Nov" — short, for agenda day headings. */
export function formatDay(date: LocalDate, options: { year?: boolean } = {}): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(options.year ? { year: 'numeric' } : {}),
  }).format(parse(date));
}

/** "November 2026". */
export function formatMonth(date: LocalDate): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(parse(date));
}

/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function relativeDay(date: LocalDate, today: LocalDate): string {
  const days = daysBetween(today, date);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
