import { AppError } from '@extrawork/contracts';
import { Decimal, roundHalfUpToBigint } from '../money/money.js';

/**
 * Parses the WhatsApp message a site employee sends.
 *
 * The whole product rests on this being forgiving. The person typing is
 * standing on a site, on a cheap phone, possibly in sunlight, probably in a
 * hurry. Every field this parser can work out for itself is a field they do not
 * have to type, and every message it rejects is a request that does not get
 * recorded.
 *
 * So the rules are deliberately loose:
 *   - labels may appear in any order, in any case, with `:` or `-` or `=`;
 *   - each label has synonyms, including the obvious Hindi/Hinglish ones;
 *   - the company is never required — the sender's phone number already
 *     identifies their employer, and asking them to retype it every time is
 *     friction for no security gain (an attacker would simply type the right
 *     name);
 *   - the project is optional when the employee is assigned to exactly one;
 *   - amounts accept `15800`, `15,800`, `₹15800`, `15800/-`, `15.8k`, `1.5 lakh`;
 *   - an unlabelled message is treated as the description, so the shortest
 *     useful message is one line of text.
 *
 * What it will NOT do is guess a number. If the amount is ambiguous the parser
 * says so and asks, because a silently mis-parsed price becomes a contract.
 */

export type IntakeField = 'company' | 'project' | 'description' | 'reason' | 'amount' | 'days';

/** Label synonyms. Lowercased, punctuation-stripped before lookup. */
const LABELS: Record<string, IntakeField> = {
  // Company — accepted so the documented format works, never required.
  company: 'company',
  firm: 'company',
  contractor: 'company',
  org: 'company',
  organisation: 'company',
  organization: 'company',

  project: 'project',
  proj: 'project',
  site: 'project',
  job: 'project',
  work_site: 'project',
  flat: 'project',
  location: 'project',

  what: 'description',
  work: 'description',
  description: 'description',
  desc: 'description',
  details: 'description',
  detail: 'description',
  scope: 'description',
  task: 'description',
  kaam: 'description',

  why: 'reason',
  reason: 'reason',
  because: 'reason',
  cause: 'reason',

  cost: 'amount',
  amount: 'amount',
  price: 'amount',
  rate: 'amount',
  charge: 'amount',
  charges: 'amount',
  extra: 'amount',
  rs: 'amount',
  rupees: 'amount',
  paisa: 'amount',

  days: 'days',
  day: 'days',
  time: 'days',
  delay: 'days',
  duration: 'days',
  extra_days: 'days',
  time_impact: 'days',
  schedule: 'days',
};

export interface ParsedIntake {
  company: string | null;
  project: string | null;
  description: string | null;
  reason: string | null;
  /** Integer minor units (paise). Null when absent; see `amountAmbiguous`. */
  amountMinor: bigint | null;
  /** The amount text exactly as typed, for the clarification reply. */
  amountRaw: string | null;
  /**
   * True when an amount was present but could not be read unambiguously (for
   * example "15-20k"). The intake must ask rather than pick a number.
   */
  amountAmbiguous: boolean;
  days: number | null;
  /** Fields the parser found a label for, used to distinguish "0" from "absent". */
  present: Set<IntakeField>;
  /** Lines the parser could not attribute to any field. */
  unrecognized: string[];
}

const EMPTY: ParsedIntake = {
  company: null,
  project: null,
  description: null,
  reason: null,
  amountMinor: null,
  amountRaw: null,
  amountAmbiguous: false,
  days: null,
  present: new Set(),
  unrecognized: [],
};

function normalizeLabel(raw: string): IntakeField | null {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return LABELS[key] ?? null;
}

/**
 * Reads a rupee amount into integer paise.
 *
 * Returns `ambiguous` rather than a number whenever more than one reading is
 * defensible. A wrong amount here silently becomes the price in a signed
 * contract, so the only safe failure mode is to ask.
 */
export function parseAmountToMinor(raw: string): { minor: bigint | null; ambiguous: boolean } {
  const text = raw.trim().toLowerCase();
  if (!text) return { minor: null, ambiguous: false };

  // A range ("15-20k", "15k se 20k") is a quote, not a price. The unit may sit
  // between the first number and the separator, so it has to be optional here.
  const RANGE =
    /\d\s*(?:k|l|lac|lakh|lakhs|thousand|hazaar|hajar|cr|crore)?\s*(?:-|–|—|to|se)\s*\d/;
  if (RANGE.test(text)) return { minor: null, ambiguous: true };
  // Hedged amounts are equally unusable.
  if (/\b(approx|around|about|maybe|roughly|lagbhag|karib)\b/.test(text)) {
    return { minor: null, ambiguous: true };
  }

  const cleaned = text
    // Unicode spaces (a phone keyboard emits these) behave as separators, and a
    // digit group split by one — "15 800" — is one number, not two.
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
    .replace(/[₹$]/g, '')
    .replace(/\brs\.?\b/g, '')
    .replace(/\/-/g, '')
    .replace(/,/g, '')
    // Thin-space or plain-space digit grouping: 15 800 -> 15800. Only between
    // digits, so "2 lakh" keeps its multiplier.
    .replace(/(?<=\d)[ \t]+(?=\d{2,3}\b)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Indian multipliers plus the common "k".
  const match = cleaned.match(
    /^(\d+(?:\.\d+)?)\s*(k|thousand|hazaar|hajar|l|lac|lakh|lakhs|crore|cr)?\b/,
  );
  if (!match) return { minor: null, ambiguous: false };

  const [, digits, unit] = match;

  const multiplier = (() => {
    switch (unit) {
      case 'k':
      case 'thousand':
      case 'hazaar':
      case 'hajar':
        return 1_000;
      case 'l':
      case 'lac':
      case 'lakh':
      case 'lakhs':
        return 100_000;
      case 'crore':
      case 'cr':
        return 10_000_000;
      default:
        return 1;
    }
  })();

  // Money never touches a float (report §8.1, ADR-005). `15800.5` as a double
  // times 100 is 1580049.999…, and this figure becomes the price in a contract
  // the customer signs — so the whole conversion stays in Decimal and lands on
  // the same half-up rule the money engine applies everywhere else.
  let paise: bigint;
  try {
    paise = roundHalfUpToBigint(new Decimal(digits as string).times(multiplier).times(100));
  } catch {
    return { minor: null, ambiguous: false };
  }
  // An amount too large to survive the JSON wire format is far more likely a
  // typo or a phone number than a real price, so it is asked about rather than
  // accepted.
  if (paise < 0n || paise > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { minor: null, ambiguous: true };
  }

  // A bare decimal with a multiplier ("1.5 lakh") is fine, but a bare decimal
  // with more than two places is probably not money at all.
  if (!unit && /\.\d{3,}/.test(cleaned)) return { minor: null, ambiguous: true };

  return { minor: paise, ambiguous: false };
}

/** Reads a day count, accepting "2", "2 days", "+2", "two days" for small numbers. */
export function parseDays(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  if (/\b(no|none|nil|zero|nahi|same)\b/.test(text)) return 0;

  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  for (const [word, value] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }

  const match = text.match(/([+-]?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number.parseFloat(match[1] as string);
  if (!Number.isFinite(value)) return null;
  // Weeks and months are common shorthand on site.
  if (/\bweek/.test(text)) return wholeDays(value * 7);
  if (/\bmonth|mahina/.test(text)) return wholeDays(value * 30);
  return wholeDays(value);
}

/**
 * Rounds a schedule impact to whole days.
 *
 * This is not money, so the report §8.1 half-up rule does not apply and the
 * repository-wide ban on `Math.round` is suppressed here rather than pulling a
 * Decimal into a day count. Half a day of delay is not a meaningful figure to
 * carry: "half a week" becoming 4 days is the intended reading, and the value
 * is small enough that float precision cannot bite.
 */
function wholeDays(value: number): number {
  // eslint-disable-next-line no-restricted-syntax -- days, not money; see above.
  return Math.round(value);
}

/**
 * Splits the message into labelled sections. A label only counts when it is at
 * the start of a line, which keeps a colon inside prose (“note: as discussed”)
 * from being read as a field.
 */
export function parseIntakeMessage(body: string): ParsedIntake {
  const result: ParsedIntake = {
    ...EMPTY,
    present: new Set<IntakeField>(),
    unrecognized: [],
  };
  if (!body?.trim()) return result;

  // Comma-separated form is tried first, but only claims the message when it
  // genuinely fits (see `parseCommaSeparated`). A labelled message never looks
  // like one, so the two formats cannot be confused.
  const csv = parseCommaSeparated(body);
  if (csv) return csv;

  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const sections: Array<{ field: IntakeField | null; text: string[] }> = [];
  let current: { field: IntakeField | null; text: string[] } = { field: null, text: [] };

  for (const line of lines) {
    const labelMatch = line.match(/^\s*\*?\*?([A-Za-z][A-Za-z\s]{0,20}?)\*?\*?\s*[:=\-–]\s*(.*)$/);
    const field = labelMatch ? normalizeLabel(labelMatch[1] as string) : null;

    if (field) {
      if (current.field !== null || current.text.some((t) => t.trim())) sections.push(current);
      current = { field, text: [(labelMatch?.[2] ?? '').trim()] };
    } else {
      current.text.push(line);
    }
  }
  sections.push(current);

  for (const section of sections) {
    const text = section.text.join('\n').trim();
    if (!text) continue;

    if (section.field === null) {
      // Unlabelled content before any label is the description — this is what
      // makes a one-line message work.
      if (!result.description) {
        result.description = text;
        result.present.add('description');
      } else {
        result.unrecognized.push(text);
      }
      continue;
    }

    result.present.add(section.field);
    switch (section.field) {
      case 'company':
        result.company = text;
        break;
      case 'project':
        result.project = text;
        break;
      case 'description':
        result.description = result.description ? `${result.description}\n${text}` : text;
        break;
      case 'reason':
        result.reason = text;
        break;
      case 'amount': {
        result.amountRaw = text;
        const { minor, ambiguous } = parseAmountToMinor(text);
        result.amountMinor = minor;
        result.amountAmbiguous = ambiguous;
        break;
      }
      case 'days':
        result.days = parseDays(text);
        break;
      default: {
        const exhaustive: never = section.field;
        throw new AppError('INTERNAL_ERROR', { details: { field: exhaustive } });
      }
    }
  }

  return result;
}

/**
 * The comma-separated form: `project, what, why, cost, days`.
 *
 * Faster to type on a phone than five labelled lines, and the format most
 * people reach for unprompted. It is positional, so the parse is anchored from
 * both ends rather than left to right:
 *
 *   - the **last** field is days,
 *   - the **second to last** is cost,
 *   - the **first** is the project,
 *   - the **second** is what the work is,
 *   - everything remaining in the middle is the reason.
 *
 * Anchoring this way is what lets the reason contain commas of its own —
 * "Why: client changed the layout, then asked for a second point" is one field,
 * not three, because only its boundaries are fixed and its interior is free.
 *
 * Returns null when the message is not this format, so the labelled parser can
 * have it. That decision is deliberately strict: the last two fields must
 * *actually* read as a cost and a day count, which a labelled message ("Project:
 * Tower 4, Flat 1204") or a sentence never does. Being wrong in the permissive
 * direction would silently reinterpret someone's words as a price.
 */
function parseCommaSeparated(body: string): ParsedIntake | null {
  const flat = body.replace(/\r\n/g, '\n').trim();

  // A labelled message is never comma-separated form, even if it has commas in
  // it. Checking first avoids ever having to guess between the two.
  if (/^\s*\*?\*?[A-Za-z][A-Za-z\s]{0,20}?\*?\*?\s*[:=]/m.test(flat)) return null;
  if (flat.includes('\n')) return null;

  const parts = flat.split(',').map((p) => p.trim());
  // project, what, why, cost, days. The reason may span several parts, and the
  // amount may itself have been split by a thousands separator, so five is the
  // minimum that still leaves one field per anchor.
  if (parts.length < 5) return null;
  if (parts.some((p) => p.length === 0)) return null;

  const daysRaw = parts[parts.length - 1] as string;
  let costRaw = parts[parts.length - 2] as string;
  let costPartCount = 1;

  // A thousands separator inside the amount — "₹12,400" — splits into two
  // fields and would otherwise be read as a price of ₹400. The two are rejoined
  // only when the reading is unambiguous: the field before must be *entirely*
  // an amount ("₹12", "12"), and this one must begin with a bare group of two
  // or three digits. "…, 4 sockets, 400, 2" fails the first test and "…, 12,
  // fourty, 2" the second, so neither is silently re-read as money.
  const beforeCost = parts[parts.length - 3];
  if (
    beforeCost !== undefined &&
    /^(?:₹|rs\.?\s*)?\d{1,3}$/i.test(beforeCost) &&
    /^\d{2,3}\b/.test(costRaw)
  ) {
    costRaw = `${beforeCost},${costRaw}`;
    costPartCount = 2;
  }

  // Both anchors must parse as their own type, or this is not the format.
  // `parseDays` is forgiving enough to accept a word ("two days"), so the guard
  // is that it returns *something*, not that the text was numeric.
  const days = parseDays(daysRaw);
  if (days === null) return null;
  if (!looksLikeDays(daysRaw)) return null;

  const { minor, ambiguous } = parseAmountToMinor(costRaw);
  // An ambiguous cost still identifies the format — the employee typed a price,
  // it just cannot be read as one figure. That must reach the caller as an
  // ambiguous amount so they are asked, not fall through to a different parse.
  if (minor === null && !ambiguous) return null;
  if (!looksLikeAmount(costRaw)) return null;

  const project = parts[0] as string;
  const what = parts[1] as string;
  // The reason is everything between `what` and the cost, rejoined with the
  // commas it was written with.
  const why = parts
    .slice(2, parts.length - 1 - costPartCount)
    .join(', ')
    .trim();

  const result: ParsedIntake = {
    ...EMPTY,
    company: null,
    project,
    description: what,
    reason: why.length > 0 ? why : null,
    amountMinor: minor,
    amountRaw: costRaw,
    amountAmbiguous: ambiguous,
    days,
    present: new Set<IntakeField>(['project', 'description', 'amount', 'days']),
    unrecognized: [],
  };
  if (result.reason) result.present.add('reason');
  return result;
}

/**
 * Whether text reads as a day count rather than prose that happens to contain a
 * number. "2", "2 days", "two days", "1 week", "nahi" — but not "Flat 1204",
 * which `parseDays` would otherwise happily read as 1204 days.
 */
function looksLikeDays(raw: string): boolean {
  const text = raw.trim().toLowerCase();
  if (/^\s*[+-]?\d+(\.\d+)?\s*$/.test(text)) return true;
  if (/^\s*[+-]?\d+(\.\d+)?\s*(d|day|days|week|weeks|month|months|mahina)\b\s*$/.test(text)) {
    return true;
  }
  if (/^\s*(no|none|nil|zero|nahi|same)\s*(change|delay)?\s*$/.test(text)) return true;
  return /^\s*(one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|days|week|weeks)\s*$/.test(
    text,
  );
}

/**
 * Whether text reads as an amount rather than a phrase containing digits. The
 * amount parser accepts a leading number and ignores any trailing words, so
 * "4 sockets" would otherwise be read as ₹4.
 */
function looksLikeAmount(raw: string): boolean {
  const text = raw
    .trim()
    .toLowerCase()
    .replace(/[₹$]/g, '')
    .replace(/\brs\.?\b/g, '')
    .replace(/\/-/g, '')
    .replace(/,/g, '')
    .trim();
  // A bare figure, optionally with an Indian multiplier or the word rupees.
  if (/^\d+(\.\d+)?\s*(k|thousand|hazaar|hajar|l|lac|lakh|lakhs|cr|crore|rupees?)?$/.test(text)) {
    return true;
  }
  // A range or a hedge is still an attempt at a price: it must reach the caller
  // as ambiguous so they get asked, rather than being read as something else.
  if (/\d\s*(?:k|l|lac|lakh|lakhs|thousand|cr|crore)?\s*(?:-|–|—|to|se)\s*\d/.test(text)) {
    return true;
  }
  return /\b(approx|around|about|maybe|roughly|lagbhag|karib)\b/.test(text) && /\d/.test(text);
}

/**
 * What still has to be true before a request can be raised.
 *
 * Deliberately short. Only the description and a readable amount are genuinely
 * required — a change with no description is not a record of anything, and a
 * change with an unreadable price cannot become a contract. Everything else
 * either has a default or can be derived.
 */
export interface IntakeValidation {
  ok: boolean;
  missing: IntakeField[];
  problems: string[];
}

export function validateIntake(
  parsed: ParsedIntake,
  context: { projectResolved: boolean; requiresProject: boolean },
): IntakeValidation {
  const missing: IntakeField[] = [];
  const problems: string[] = [];

  if (!parsed.description || parsed.description.trim().length < 10) {
    missing.push('description');
  }

  if (context.requiresProject && !context.projectResolved) {
    missing.push('project');
  }

  if (parsed.amountAmbiguous) {
    problems.push(
      `I could not read the amount "${parsed.amountRaw ?? ''}" as a single figure. ` +
        'Send one exact number, for example: Cost: 15800',
    );
  } else if (parsed.amountMinor === null && !parsed.present.has('amount')) {
    // A time-only change is legitimate (report §4.6), but silence is more often
    // a forgotten field than a deliberate zero — so ask rather than assume.
    missing.push('amount');
  }

  return { ok: missing.length === 0 && problems.length === 0, missing, problems };
}
