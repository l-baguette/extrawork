import { describe, expect, it } from 'vitest';
import { escapeIcsText, foldIcsLine, nextIcsDay, serializeIcs } from '@extrawork/domain';

/** RFC 5545 serialisation for the private calendar feed (spec 2026-10-12, D14). */

const NOW = new Date('2026-10-12T09:30:15.123Z');

describe('escapeIcsText', () => {
  it('escapes backslash, semicolon and comma, and turns newlines into \\n', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });
});

describe('foldIcsLine', () => {
  it('leaves a 75-octet line alone', () => {
    const line = 'X'.repeat(75);
    expect(foldIcsLine(line)).toBe(line);
  });

  it('folds longer lines with CRLF + space, every physical line at most 75 octets', () => {
    const folded = foldIcsLine(`SUMMARY:${'a'.repeat(200)}`);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(2);
    for (const [index, line] of physical.entries()) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
      if (index > 0) expect(line.startsWith(' ')).toBe(true);
    }
    expect(physical.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(
      `SUMMARY:${'a'.repeat(200)}`,
    );
  });

  it('never splits a multi-byte UTF-8 character across a fold', () => {
    const line = `SUMMARY:${'₹'.repeat(60)}`;
    const physical = foldIcsLine(line).split('\r\n');
    for (const part of physical) {
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
      // A broken sequence would decode to the replacement character.
      expect(Buffer.from(part, 'utf8').toString('utf8')).not.toContain('�');
    }
    expect(physical.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(line);
  });
});

describe('nextIcsDay', () => {
  it('rolls over months, years and leap days', () => {
    expect(nextIcsDay('2026-10-31')).toBe('2026-11-01');
    expect(nextIcsDay('2026-12-31')).toBe('2027-01-01');
    expect(nextIcsDay('2028-02-28')).toBe('2028-02-29');
  });
});

describe('serializeIcs', () => {
  const ics = serializeIcs({
    name: 'ExtraWork · Alpha, Interiors',
    refreshMinutes: 60,
    now: NOW,
    events: [
      {
        uid: 'milestone:1@extrawork',
        date: '2026-11-14',
        summary: 'Handover; keys, documents',
        description: 'Second line\nThird',
        url: 'https://app.example.test/app/projects/1/timeline',
        categories: ['MILESTONE'],
      },
      { uid: 'decision:2@extrawork', date: '2026-10-01', summary: 'R03 approved', completed: true },
    ],
  });

  it('uses CRLF line endings throughout and ends with one', () => {
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('wraps events in a VCALENDAR with version and product id', () => {
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines.some((l) => l.startsWith('PRODID:'))).toBe(true);
    expect(lines).toContain('X-WR-CALNAME:ExtraWork · Alpha\\, Interiors');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(lines.at(-2)).toBe('END:VCALENDAR');
  });

  it('writes all-day events with an exclusive end date and a UTC stamp', () => {
    const lines = ics.split('\r\n');
    expect(lines).toContain('DTSTART;VALUE=DATE:20261114');
    expect(lines).toContain('DTEND;VALUE=DATE:20261115');
    expect(lines).toContain('DTSTAMP:20261012T093015Z');
    expect(lines).toContain('UID:milestone:1@extrawork');
  });

  it('escapes text values and marks completed events', () => {
    expect(ics).toContain('SUMMARY:Handover\\; keys\\, documents');
    expect(ics).toContain('DESCRIPTION:Second line\\nThird');
    expect(ics).toContain('SUMMARY:✓ R03 approved');
  });

  it('is deterministic for the same input, so UIDs and bodies are stable', () => {
    const again = serializeIcs({
      name: 'ExtraWork · Alpha, Interiors',
      refreshMinutes: 60,
      now: NOW,
      events: [
        {
          uid: 'milestone:1@extrawork',
          date: '2026-11-14',
          summary: 'Handover; keys, documents',
          description: 'Second line\nThird',
          url: 'https://app.example.test/app/projects/1/timeline',
          categories: ['MILESTONE'],
        },
        {
          uid: 'decision:2@extrawork',
          date: '2026-10-01',
          summary: 'R03 approved',
          completed: true,
        },
      ],
    });
    expect(again).toBe(ics);
  });

  it('refuses a malformed date rather than writing a broken event', () => {
    expect(() =>
      serializeIcs({
        name: 'x',
        now: NOW,
        events: [{ uid: 'a', date: '14/11/2026', summary: 'x' }],
      }),
    ).toThrow(RangeError);
  });
});
