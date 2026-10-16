/**
 * iCalendar (RFC 5545) serialisation for the private calendar feed — spec
 * 2026-10-12, D14.
 *
 * Subscribing to this feed in Google or Apple Calendar is how a designer gets
 * phone reminders for completion dates without the product building push
 * notifications. Every event is an all-day date: a handover is "on the 14th",
 * not at a time in some time zone, and an all-day `VALUE=DATE` event is never
 * shifted by the subscriber's own zone.
 *
 * Pure: no clock, no I/O. The caller passes `now` for DTSTAMP.
 */

export interface IcsEvent {
  /** Stable across fetches so calendar apps update an event rather than duplicate it. */
  uid: string;
  /** `YYYY-MM-DD`. */
  date: string;
  summary: string;
  description?: string | null;
  url?: string | null;
  /** Shown as completed (and transparent) when true. */
  completed?: boolean;
  categories?: readonly string[];
}

export interface IcsCalendar {
  name: string;
  /** Hint to subscribers; Google ignores it, Apple honours it. */
  refreshMinutes?: number;
  events: readonly IcsEvent[];
  now: Date;
}

const CRLF = '\r\n';
const MAX_OCTETS = 75;

/** RFC 5545 §3.3.11: backslash, semicolon and comma are escaped; newlines become `\n`. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF followed by
 * a single space. Counted in UTF-8 octets, and never splitting a multi-byte
 * character — a folded "₹" must reach the client whole.
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  // The continuation's leading space counts towards its 75.
  let limit = MAX_OCTETS;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
      limit = MAX_OCTETS - 1;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

/** `YYYY-MM-DD` → `YYYYMMDD`. */
function icsDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`Invalid calendar date ${date}`);
  return date.replace(/-/g, '');
}

/** The day after a `YYYY-MM-DD`, for the exclusive DTEND of an all-day event. */
export function nextIcsDay(date: string): string {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  const next = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1));
  return next.toISOString().slice(0, 10);
}

function icsTimestamp(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/** A property's value with control characters other than the escaped newline removed. */
function clean(value: string): string {
  // Control characters would corrupt the content line; they are what is removed.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

export function serializeIcs(calendar: IcsCalendar): string {
  const stamp = icsTimestamp(calendar.now);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ExtraWork//Project timeline//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(clean(calendar.name))}`,
  ];
  if (calendar.refreshMinutes) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${calendar.refreshMinutes}M`);
    lines.push(`X-PUBLISHED-TTL:PT${calendar.refreshMinutes}M`);
  }
  for (const event of calendar.events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeIcsText(clean(event.uid))}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${icsDate(event.date)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(nextIcsDay(event.date))}`);
    lines.push(
      `SUMMARY:${escapeIcsText(clean(event.completed ? `✓ ${event.summary}` : event.summary))}`,
    );
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(clean(event.description))}`);
    if (event.url) lines.push(`URL:${clean(event.url)}`);
    if (event.categories && event.categories.length > 0) {
      lines.push(`CATEGORIES:${event.categories.map((c) => escapeIcsText(clean(c))).join(',')}`);
    }
    // An all-day reminder must not mark the whole day busy.
    lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
