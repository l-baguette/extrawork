import { normalizeForSearch } from '../identity/phone.js';

/**
 * Resolving the project an employee named in a WhatsApp message.
 *
 * They will not type the project number. They will type "tower 4", "1204",
 * "mehta flat", or the site nickname everyone on the crew uses. So this matches
 * generously, but it refuses to pick between close candidates: sending the
 * wrong client a contract for someone else's flat is a far worse outcome than
 * one extra round trip.
 */

export interface MatchCandidate {
  id: string;
  projectNumber: string;
  title: string;
  customerName: string;
}

export type MatchOutcome =
  | { kind: 'MATCHED'; project: MatchCandidate }
  /** Exactly one project available and none named — safe to assume. */
  | { kind: 'ASSUMED'; project: MatchCandidate }
  | { kind: 'AMBIGUOUS'; candidates: MatchCandidate[] }
  | { kind: 'NONE' };

/** Tokens that carry no distinguishing information in a project name. */
const STOP_WORDS = new Set([
  'project',
  'site',
  'job',
  'the',
  'at',
  'in',
  'of',
  'for',
  'and',
  'flat',
  'no',
  'number',
  'block',
  'phase',
]);

function tokens(value: string): string[] {
  return normalizeForSearch(value)
    .split(' ')
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

/**
 * Score in [0,1]. Deliberately simple and explainable: an exact project-number
 * hit wins outright, otherwise it is token overlap weighted towards rare
 * tokens like "1204" that a person uses precisely because they identify a site.
 */
export function scoreCandidate(query: string, candidate: MatchCandidate): number {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return 0;

  // An exact project number is unambiguous by construction.
  if (normalizeForSearch(candidate.projectNumber) === normalizedQuery) return 1;

  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return 0;

  const haystack = tokens(
    `${candidate.projectNumber} ${candidate.title} ${candidate.customerName}`,
  );
  if (haystack.length === 0) return 0;

  let hits = 0;
  let weight = 0;
  for (const token of queryTokens) {
    const matched = haystack.some(
      (h) =>
        h === token ||
        (token.length >= 4 && h.includes(token)) ||
        (h.length >= 4 && token.includes(h)),
    );

    // A token carrying a digit is how people actually pin down a site — "1204",
    // "Tower 4", "Flat 903". So an unmatched one is not weak evidence, it is
    // evidence of the *wrong* site: "Tower 7" must never resolve to Tower 4,
    // and neither must a typo like "Tower 45dffds". Disqualifying outright is
    // what stops a half-right query scoring its way over the threshold on the
    // strength of the word "tower" alone.
    const identifying = /\d/.test(token);
    if (identifying && !matched) return 0;

    const tokenWeight = identifying ? 2 : 1;
    weight += tokenWeight;
    if (matched) hits += tokenWeight;
  }

  return weight === 0 ? 0 : hits / weight;
}

export interface MatchOptions {
  /** Below this a candidate is not considered at all. */
  threshold?: number;
  /**
   * If the best and second-best are within this margin, the result is
   * AMBIGUOUS rather than a guess.
   */
  margin?: number;
}

export function matchProject(
  query: string | null,
  candidates: readonly MatchCandidate[],
  options: MatchOptions = {},
): MatchOutcome {
  // 0.6, not 0.5: at exactly half the weight matching, as many of the words the
  // employee typed were wrong as were right, and sending the wrong client a
  // contract for someone else's flat is far worse than one clarifying reply.
  const threshold = options.threshold ?? 0.6;
  const margin = options.margin ?? 0.2;

  if (candidates.length === 0) return { kind: 'NONE' };

  // No project named. One project means there is nothing to get wrong, which is
  // the common case for a worker on a single site — and the biggest single
  // friction saving in the whole flow.
  if (!query?.trim()) {
    const only = candidates[0];
    return candidates.length === 1 && only
      ? { kind: 'ASSUMED', project: only }
      : { kind: 'AMBIGUOUS', candidates: [...candidates] };
  }

  // An exact project-number hit is unambiguous by construction, so it is the
  // one case that may bypass the margin check below. A high *token* score is
  // not the same thing: "tower" overlaps Tower 4 and Tower 7 equally well.
  const normalizedQuery = normalizeForSearch(query);
  const exact = candidates.find((c) => normalizeForSearch(c.projectNumber) === normalizedQuery);
  if (exact) return { kind: 'MATCHED', project: exact };

  const scored = candidates
    .map((project) => ({ project, score: scoreCandidate(query, project) }))
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return { kind: 'NONE' };

  const runnerUp = scored[1];
  if (runnerUp && best.score - runnerUp.score < margin) {
    return {
      kind: 'AMBIGUOUS',
      candidates: scored.filter((e) => best.score - e.score < margin).map((e) => e.project),
    };
  }

  return { kind: 'MATCHED', project: best.project };
}
