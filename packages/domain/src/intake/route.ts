import { normalizeForSearch } from '../identity/phone.js';
import type { ParserSignals } from './classify.js';
import { matchProject, type MatchCandidate } from './match.js';
import type { ParsedIntake } from './parse-message.js';

/**
 * Which project a WhatsApp message is about — spec 2026-10-12, "WhatsApp
 * conversation rules" §3, and the D6/D7 rule that the channel never guesses
 * between projects or firms.
 *
 * The order is fixed by the spec: an explicit project code or title wins; then
 * the sticky project from the last two hours; then the only candidate;
 * otherwise ask once. Two refinements the spec implies but does not spell out:
 *
 *   - A project *number* is unique per workspace, not globally, so "P-0004"
 *     from a foreman on two firms' rosters can name two projects. That is
 *     asked, never resolved by whichever firm happens to sort first.
 *   - A hint that matches nothing asks with the full list rather than falling
 *     back to the sticky project. The sender named somewhere specific; filing
 *     it under the place they were talking about an hour ago would be a guess.
 *
 * Pure: the caller supplies the candidates, the sticky project and the clock.
 */

/** A project the sender may mean, keyed across workspaces. */
export interface RouteCandidate extends MatchCandidate {
  organizationId: string;
}

export type RouteOutcome<T extends RouteCandidate> =
  | { kind: 'CHOSEN'; candidate: T; via: 'HINT' | 'STICKY' | 'ONLY' }
  | { kind: 'ASK'; candidates: T[] };

const PROJECT_CODE = /\bP\s*-\s*(\d{1,6})\b/i;

/**
 * The project the message names, if any: a `Project:` line the parser read,
 * or a project code such as "P-0004" anywhere in the text (a request number
 * like "P-0004-R03" carries its project's code, which is the project meant).
 *
 * Only the first line of a `Project:` value counts. The parser lets a label
 * run on over the unlabelled lines after it (right for a long "What:"), so
 * "Project: P-0001" followed by "Can we add a cove light" reads as one
 * project value; matching that whole text would find nothing and ask a
 * question the sender already answered.
 */
export function explicitProjectHint(body: string, parsedProject: string | null): string | null {
  const labelled = firstLine(parsedProject);
  const code = PROJECT_CODE.exec(labelled ?? body);
  if (code?.[1]) return `P-${code[1].padStart(4, '0')}`;
  return labelled;
}

/**
 * What the parser folded into a `Project:` value after its first line — in
 * practice the description the sender typed under it. Null when there is none.
 */
export function projectSpill(parsedProject: string | null): string | null {
  const lines = (parsedProject ?? '').split(/\r?\n/).slice(1).join('\n').trim();
  return lines || null;
}

function firstLine(value: string | null): string | null {
  const line = value?.split(/\r?\n/)[0]?.trim();
  return line || null;
}

export function routeProject<T extends RouteCandidate>(input: {
  hint: string | null;
  candidates: readonly T[];
  sticky: { organizationId: string; projectId: string } | null;
}): RouteOutcome<T> {
  const { hint, candidates, sticky } = input;

  if (hint) {
    const wanted = normalizeForSearch(hint);
    const exact = candidates.filter((c) => normalizeForSearch(c.projectNumber) === wanted);
    if (exact.length > 1) return { kind: 'ASK', candidates: exact };
    const only = exact[0];
    if (only) return { kind: 'CHOSEN', candidate: only, via: 'HINT' };

    const match = matchProject(hint, candidates);
    if (match.kind === 'MATCHED' || match.kind === 'ASSUMED') {
      const chosen = candidates.find((c) => c.id === match.project.id);
      if (chosen) return { kind: 'CHOSEN', candidate: chosen, via: 'HINT' };
    }
    if (match.kind === 'AMBIGUOUS') {
      const ids = new Set(match.candidates.map((c) => c.id));
      return { kind: 'ASK', candidates: candidates.filter((c) => ids.has(c.id)) };
    }
    return { kind: 'ASK', candidates: [...candidates] };
  }

  if (sticky) {
    const kept = candidates.find(
      (c) => c.id === sticky.projectId && c.organizationId === sticky.organizationId,
    );
    if (kept) return { kind: 'CHOSEN', candidate: kept, via: 'STICKY' };
  }

  const only = candidates[0];
  if (candidates.length === 1 && only) return { kind: 'CHOSEN', candidate: only, via: 'ONLY' };
  return { kind: 'ASK', candidates: [...candidates] };
}

/**
 * What the parser saw, in the shape `classifyMessage` takes. An ambiguous
 * amount ("15-20k") still counts as a price: the sender was talking money,
 * which is a request, even though nobody may pick the figure for them.
 */
export function parserSignals(parsed: ParsedIntake): ParserSignals {
  return {
    hasAmount: parsed.amountMinor !== null || parsed.amountAmbiguous,
    hasDays: parsed.days !== null && parsed.days !== 0,
    labelledFieldCount: [...parsed.present].filter((field) => field !== 'description').length,
  };
}
