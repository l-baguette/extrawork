import { describe, expect, it } from 'vitest';
import {
  matchProject,
  parseAmountToMinor,
  parseDays,
  parseIntakeMessage,
  validateIntake,
  type MatchCandidate,
} from '@extrawork/domain';

/**
 * The parser is the entire interface for the person raising a request, so these
 * cases are written as real messages a site employee would actually send —
 * including the sloppy ones.
 */

describe('amount parsing', () => {
  it('reads the ways people actually write rupees', () => {
    const cases: Array<[string, bigint]> = [
      ['15800', 1_580_000n],
      ['15,800', 1_580_000n],
      ['₹15800', 1_580_000n],
      ['Rs 15800', 1_580_000n],
      ['rs.15800', 1_580_000n],
      ['15800/-', 1_580_000n],
      ['15.8k', 1_580_000n],
      ['15800.50', 1_580_050n],
      ['1.5 lakh', 15_000_000n],
      ['2 lac', 20_000_000n],
      ['3 hazaar', 300_000n],
      ['1 crore', 1_000_000_000n],
      ['0', 0n],
    ];
    for (const [input, expected] of cases) {
      expect(parseAmountToMinor(input).minor, input).toBe(expected);
    }
  });

  it('refuses to pick a number from a range', () => {
    // A range is a quote, not a price. Guessing either end would put a figure
    // the employee never agreed to into a contract.
    for (const input of ['15-20k', '15000-20000', '15 to 20 thousand', '15k se 20k']) {
      const result = parseAmountToMinor(input);
      expect(result.ambiguous, input).toBe(true);
      expect(result.minor, input).toBeNull();
    }
  });

  it('refuses hedged amounts', () => {
    for (const input of ['approx 15000', 'around 20k', 'about 5000', 'lagbhag 3000']) {
      expect(parseAmountToMinor(input).ambiguous, input).toBe(true);
    }
  });

  it('returns nothing rather than guessing on junk', () => {
    expect(parseAmountToMinor('will confirm later').minor).toBeNull();
    expect(parseAmountToMinor('').minor).toBeNull();
  });
});

describe('day parsing', () => {
  it('reads plain numbers, words, and units', () => {
    expect(parseDays('2')).toBe(2);
    expect(parseDays('2 days')).toBe(2);
    expect(parseDays('+3')).toBe(3);
    expect(parseDays('two days')).toBe(2);
    expect(parseDays('1 week')).toBe(7);
    expect(parseDays('none')).toBe(0);
    expect(parseDays('no delay')).toBe(0);
    expect(parseDays('nahi')).toBe(0);
  });
});

describe('message parsing', () => {
  it('parses the documented format', () => {
    const parsed = parseIntakeMessage(
      [
        'Company: Shree Interiors',
        'Project: Tower 4 Flat 1204',
        'What: Two extra power points in the kitchen',
        'Why: Client changed the appliance layout',
        'Cost: 15800',
        'Days: 2',
      ].join('\n'),
    );
    expect(parsed.company).toBe('Shree Interiors');
    expect(parsed.project).toBe('Tower 4 Flat 1204');
    expect(parsed.description).toBe('Two extra power points in the kitchen');
    expect(parsed.reason).toBe('Client changed the appliance layout');
    expect(parsed.amountMinor).toBe(1_580_000n);
    expect(parsed.days).toBe(2);
  });

  it('does not care about order or case', () => {
    const parsed = parseIntakeMessage(
      ['COST: 5000', 'what - extra tiling', 'PROJECT = Nandi Cafe', 'days: 1'].join('\n'),
    );
    expect(parsed.amountMinor).toBe(500_000n);
    expect(parsed.description).toBe('extra tiling');
    expect(parsed.project).toBe('Nandi Cafe');
    expect(parsed.days).toBe(1);
  });

  it('accepts synonyms people actually use', () => {
    const parsed = parseIntakeMessage(
      ['Site: Indiranagar', 'Kaam: extra plug points', 'Reason: client asked', 'Amount: 4000'].join(
        '\n',
      ),
    );
    expect(parsed.project).toBe('Indiranagar');
    expect(parsed.description).toBe('extra plug points');
    expect(parsed.reason).toBe('client asked');
    expect(parsed.amountMinor).toBe(400_000n);
  });

  it('treats an unlabelled message as the description', () => {
    // The shortest useful message: one line. Everything else gets asked for.
    const parsed = parseIntakeMessage('Need to add two more power points in the kitchen');
    expect(parsed.description).toBe('Need to add two more power points in the kitchen');
    expect(parsed.amountMinor).toBeNull();
  });

  it('keeps a colon inside prose out of the field parser', () => {
    const parsed = parseIntakeMessage(
      [
        'What: rewire the kitchen',
        'Why: as discussed on site: client wants an oven',
        'Cost: 9000',
      ].join('\n'),
    );
    expect(parsed.reason).toBe('as discussed on site: client wants an oven');
    expect(parsed.description).toBe('rewire the kitchen');
  });

  it('keeps multi-line descriptions together', () => {
    const parsed = parseIntakeMessage(
      ['What: rewire the kitchen', 'and add a dedicated oven circuit', 'Cost: 12000'].join('\n'),
    );
    expect(parsed.description).toContain('rewire the kitchen');
    expect(parsed.description).toContain('dedicated oven circuit');
  });

  it('distinguishes an explicit zero from a missing amount', () => {
    const zero = parseIntakeMessage(['What: pure delay, no cost', 'Cost: 0', 'Days: 5'].join('\n'));
    expect(zero.amountMinor).toBe(0n);
    expect(zero.present.has('amount')).toBe(true);

    const absent = parseIntakeMessage(['What: something', 'Days: 5'].join('\n'));
    expect(absent.amountMinor).toBeNull();
    expect(absent.present.has('amount')).toBe(false);
  });
});

describe('validation', () => {
  const ctx = { projectResolved: true, requiresProject: true };

  it('accepts a complete request', () => {
    const parsed = parseIntakeMessage(
      ['What: two extra power points in the kitchen', 'Cost: 15800'].join('\n'),
    );
    expect(validateIntake(parsed, ctx).ok).toBe(true);
  });

  it('asks for the amount rather than assuming zero', () => {
    const parsed = parseIntakeMessage('What: two extra power points in the kitchen');
    const result = validateIntake(parsed, ctx);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('amount');
  });

  it('rejects a description too short to be a record of anything', () => {
    const parsed = parseIntakeMessage(['What: fix', 'Cost: 500'].join('\n'));
    expect(validateIntake(parsed, ctx).missing).toContain('description');
  });

  it('reports an unreadable amount as a problem, not a missing field', () => {
    const parsed = parseIntakeMessage(
      ['What: two extra power points in the kitchen', 'Cost: 15-20k'].join('\n'),
    );
    const result = validateIntake(parsed, ctx);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('15-20k');
  });

  it('does not demand a project when one was resolved from assignment', () => {
    const parsed = parseIntakeMessage(
      ['What: two extra power points in the kitchen', 'Cost: 15800'].join('\n'),
    );
    const result = validateIntake(parsed, { projectResolved: true, requiresProject: false });
    expect(result.ok).toBe(true);
  });
});

describe('project matching', () => {
  const projects: MatchCandidate[] = [
    {
      id: 'a',
      projectNumber: 'P-0001',
      title: '3BHK fit-out — Tower 4 Flat 1204',
      customerName: 'Priya Mehta',
    },
    {
      id: 'b',
      projectNumber: 'P-0002',
      title: 'Nandi Cafe — Indiranagar outlet',
      customerName: 'Nandi Cafe Pvt Ltd',
    },
    {
      id: 'c',
      projectNumber: 'P-0003',
      title: '2BHK fit-out — Tower 7 Flat 903',
      customerName: 'Arun Kumar',
    },
  ];

  it('matches an exact project number outright', () => {
    const result = matchProject('P-0002', projects);
    expect(result.kind).toBe('MATCHED');
    if (result.kind === 'MATCHED') expect(result.project.id).toBe('b');
  });

  it('matches the way people actually refer to a site', () => {
    for (const [query, expected] of [
      ['1204', 'a'],
      ['tower 4', 'a'],
      ['mehta', 'a'],
      ['indiranagar', 'b'],
      ['nandi cafe', 'b'],
      ['tower 7', 'c'],
    ] as const) {
      const result = matchProject(query, projects);
      expect(result.kind, query).toBe('MATCHED');
      if (result.kind === 'MATCHED') expect(result.project.id, query).toBe(expected);
    }
  });

  it('assumes the project when the employee has exactly one', () => {
    const result = matchProject(null, [projects[0] as MatchCandidate]);
    expect(result.kind).toBe('ASSUMED');
  });

  it('refuses to guess between two similar sites', () => {
    // "tower" alone hits both Tower 4 and Tower 7. Sending the wrong client a
    // contract is far worse than one extra round trip.
    const result = matchProject('tower', projects);
    expect(result.kind).toBe('AMBIGUOUS');
    if (result.kind === 'AMBIGUOUS') expect(result.candidates.length).toBeGreaterThan(1);
  });

  it('asks when several projects exist and none was named', () => {
    expect(matchProject(null, projects).kind).toBe('AMBIGUOUS');
  });

  it('reports nothing when the name matches no project', () => {
    expect(matchProject('whitefield villa', projects).kind).toBe('NONE');
  });
});

/**
 * Money handling at the intake boundary.
 *
 * The parsed figure becomes the price on a contract the customer signs, so the
 * repository forbids floats anywhere in a money path (report §8.1, ADR-005) and
 * an ESLint rule enforces it. These lock in the observable contract of that
 * rule: exact paise, as a bigint, through the same half-up rounding the money
 * engine uses.
 *
 * Note what is NOT claimed here: no realistic input has been shown where the
 * previous float implementation produced a wrong figure. Within the accepted
 * range float integers are exact, and the one boundary that would differ
 * (`1.005`, where `1.005 * 100` is `100.49999999999999`) is rejected earlier as
 * an ambiguous bare three-decimal amount. This closes a class of risk rather
 * than a demonstrated miscalculation.
 */
describe('amount parsing stays exact', () => {
  it('returns a bigint, never a number', () => {
    expect(typeof parseAmountToMinor('15800').minor).toBe('bigint');
  });

  it('keeps multiplier arithmetic exact', () => {
    expect(parseAmountToMinor('15.8k')).toEqual({ minor: 1_580_000n, ambiguous: false });
    expect(parseAmountToMinor('1.5 lakh')).toEqual({ minor: 15_000_000n, ambiguous: false });
    expect(parseAmountToMinor('2 lac')).toEqual({ minor: 20_000_000n, ambiguous: false });
    expect(parseAmountToMinor('1.15 crore')).toEqual({ minor: 1_150_000_000n, ambiguous: false });
  });

  it('applies half-up at the paise boundary', () => {
    // 1.000005k = 1000.005 rupees = 100000.5 paise exactly -> 100001.
    expect(parseAmountToMinor('1.000005k')).toEqual({ minor: 100_001n, ambiguous: false });
  });

  it('asks about an amount too large to be a real price', () => {
    // Far more likely a typo or a pasted phone number than a quote.
    expect(parseAmountToMinor('999999999999999999').ambiguous).toBe(true);
  });
});

/**
 * The comma-separated form: `project, what, why, cost, days`.
 *
 * Positional, so the parse is anchored from both ends — last is days, second to
 * last is cost, first is the project. That is what lets the reason carry commas
 * of its own without being split into extra fields.
 */
describe('comma-separated messages', () => {
  it('reads the five fields positionally', () => {
    const parsed = parseIntakeMessage(
      'Tower 4, Two extra power points in the kitchen, Client changed the layout, 15800, 2',
    );
    expect(parsed.project).toBe('Tower 4');
    expect(parsed.description).toBe('Two extra power points in the kitchen');
    expect(parsed.reason).toBe('Client changed the layout');
    expect(parsed.amountMinor).toBe(1_580_000n);
    expect(parsed.days).toBe(2);
  });

  it('keeps commas inside the reason', () => {
    const parsed = parseIntakeMessage(
      'Tower 4, Two power points, client changed the layout, then asked for a second point, 15800, 2',
    );
    expect(parsed.description).toBe('Two power points');
    // The middle collapses back into one reason rather than becoming fields.
    expect(parsed.reason).toBe('client changed the layout, then asked for a second point');
    expect(parsed.amountMinor).toBe(1_580_000n);
    expect(parsed.days).toBe(2);
  });

  it('tolerates ragged spacing around the separators', () => {
    const parsed = parseIntakeMessage(
      '  Tower 4 ,Two power points,   client changed the layout ,   15800  ,  2  ',
    );
    expect(parsed.project).toBe('Tower 4');
    expect(parsed.amountMinor).toBe(1_580_000n);
    expect(parsed.days).toBe(2);
  });

  it('accepts the money and day spellings people actually use', () => {
    const parsed = parseIntakeMessage(
      'Tower 4, Waterproofing the balcony, seepage after the rain, ₹12,400/-, two days',
    );
    expect(parsed.amountMinor).toBe(1_240_000n);
    expect(parsed.days).toBe(2);
  });

  it('still asks when the cost is a range', () => {
    const parsed = parseIntakeMessage('Tower 4, Two power points, layout changed, 15-20k, 2');
    expect(parsed.amountAmbiguous).toBe(true);
    expect(parsed.amountMinor).toBeNull();
  });

  it('leaves a labelled message to the labelled parser', () => {
    // Commas inside a labelled message must not turn it into positional form.
    const parsed = parseIntakeMessage(
      'Project: Tower 4, Flat 1204\nWhat: Two power points\nCost: 15800',
    );
    expect(parsed.project).toBe('Tower 4, Flat 1204');
    expect(parsed.amountMinor).toBe(1_580_000n);
  });

  it('does not read a prose sentence as five fields', () => {
    // The last two parts are words, not a cost and a day count, so this is
    // description text rather than a positional message.
    const parsed = parseIntakeMessage(
      'we need more sockets, the client asked, and also a fan, in the bedroom, please',
    );
    expect(parsed.amountMinor).toBeNull();
    expect(parsed.amountAmbiguous).toBe(false);
    expect(parsed.description).toContain('we need more sockets');
  });

  it('does not mistake a trailing quantity for a price', () => {
    // "4 sockets" is not ₹4, and "kitchen" is not a day count.
    const parsed = parseIntakeMessage('Tower 4, power points, client asked, 4 sockets, kitchen');
    expect(parsed.amountMinor).toBeNull();
    expect(parsed.days).toBeNull();
  });
});

describe('numbers survive messy spacing', () => {
  it('reads a digit group split by a space', () => {
    expect(parseAmountToMinor('15 800')).toEqual({ minor: 1_580_000n, ambiguous: false });
  });

  it('reads a non-breaking space the same way', () => {
    expect(parseAmountToMinor('15 800')).toEqual({ minor: 1_580_000n, ambiguous: false });
  });

  it('keeps a multiplier separated by a space', () => {
    expect(parseAmountToMinor('2 lakh')).toEqual({ minor: 20_000_000n, ambiguous: false });
    expect(parseAmountToMinor('1.5  lakh')).toEqual({ minor: 15_000_000n, ambiguous: false });
  });

  it('ignores surrounding tabs and newlines', () => {
    expect(parseAmountToMinor('\t ₹15,800 \n')).toEqual({ minor: 1_580_000n, ambiguous: false });
  });
});

describe('project matching refuses near-misses', () => {
  const sites: MatchCandidate[] = [
    {
      id: 'a',
      projectNumber: 'P-0001',
      title: '3BHK fit-out — Tower 4 Flat 1204',
      customerName: 'Priya Mehta',
    },
    {
      id: 'b',
      projectNumber: 'P-0002',
      title: 'Nandi Cafe — Indiranagar outlet',
      customerName: 'Nandi Cafe Pvt Ltd',
    },
  ];

  it('does not match a typo’d identifier to a real site', () => {
    // The reported bug: "Tower 45dffds" resolved to Tower 4 because the word
    // "tower" alone carried it over the threshold.
    expect(matchProject('Tower 45dffds', sites).kind).toBe('NONE');
  });

  it('does not match a different tower number', () => {
    expect(matchProject('Tower 9', sites).kind).toBe('NONE');
  });

  it('does not match garbage appended to a real name', () => {
    expect(matchProject('Nandi Cafe zzzz qqqq', sites).kind).toBe('NONE');
  });

  it('still matches the real thing', () => {
    for (const query of ['Tower 4', 'tower 4 flat 1204', '1204', 'nandi cafe', 'mehta']) {
      expect(matchProject(query, sites).kind, query).toBe('MATCHED');
    }
  });
});
