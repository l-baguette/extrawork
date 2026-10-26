import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  endOfMonth,
  eventCode,
  groupByDate,
  monthGrid,
  relativeDay,
  todayIn,
} from '../../apps/web/src/lib/calendar.js';

describe('web calendar helpers', () => {
  it('does date arithmetic on calendar days, across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(daysBetween('2026-10-16', '2026-10-31')).toBe(15);
  });

  it('lays a month out in Monday-first weeks', () => {
    // 1 November 2026 is a Sunday.
    const weeks = monthGrid('2026-11-14');
    expect(weeks[0]?.[0]).toBe('2026-10-26');
    expect(weeks[0]?.[6]).toBe('2026-11-01');
    expect(weeks.at(-1)?.at(-1)).toBe('2026-12-06');
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    // February 2027 starts on a Monday: no leading days.
    expect(monthGrid('2027-02-01')[0]?.[0]).toBe('2027-02-01');
  });

  it("finds today's date in the project's time zone", () => {
    // 20:00 UTC on the 16th is already the 17th in India.
    expect(todayIn('Asia/Kolkata', new Date('2026-10-16T20:00:00Z'))).toBe('2026-10-17');
    expect(todayIn('UTC', new Date('2026-10-16T20:00:00Z'))).toBe('2026-10-16');
  });

  it('groups events by date in order', () => {
    const groups = groupByDate([
      { date: '2026-11-02', id: 'b' },
      { date: '2026-11-01', id: 'a' },
      { date: '2026-11-02', id: 'c' },
    ]);
    expect([...groups.keys()]).toEqual(['2026-11-01', '2026-11-02']);
    expect(groups.get('2026-11-02')?.map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('codes events and words relative days', () => {
    expect(eventCode({ kind: 'APPROVAL_EXPIRES', completed: false }).code).toBe('D');
    expect(eventCode({ kind: 'MILESTONE', completed: true }).code).toBe('A');
    expect(eventCode({ kind: 'MILESTONE', completed: false }).code).toBe('W');
    expect(eventCode({ kind: 'PROJECT_START', completed: false }).code).toBe('N');
    expect(relativeDay('2026-10-17', '2026-10-16')).toBe('tomorrow');
    expect(relativeDay('2026-10-13', '2026-10-16')).toBe('3 days ago');
  });
});
