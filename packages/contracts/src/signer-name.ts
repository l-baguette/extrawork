/**
 * Does the name typed on the approval page belong to the person the request was
 * addressed to?
 *
 * The typed name is the signature. A0 assurance is "the holder of a private
 * link typed the name shown and confirmed the statement" — so if the name typed
 * is not the recorded approver's, the record would attribute a decision to
 * someone who did not make it. Accepting anything and storing it is what makes
 * an evidence pack worthless later.
 *
 * The comparison is deliberately forgiving about how a name is *written* and
 * strict about *whose* name it is:
 *
 *   - case, punctuation and accents are ignored — "priya mehta", "Priya
 *     Mehta.", "PRIYA MEHTA" are the same person;
 *   - honorifics are dropped — "Mrs Priya Mehta" is still Priya Mehta;
 *   - word order is ignored — "Mehta Priya" is common in Indian usage;
 *   - every recorded word must be present, so "Priya" alone is refused, and so
 *     is "Priya Sharma".
 *
 * Extra words in the typed name are allowed, because a person may sign with a
 * middle name the contractor never recorded. Missing words are not, because
 * that is the case where two different people collapse onto one match.
 */

const HONORIFICS = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'dr',
  'prof',
  'shri',
  'sri',
  'smt',
  'kumari',
  'sh',
]);

/**
 * Lowercases, strips accents and punctuation, drops honorifics, and returns the
 * remaining words. `Dr. Priyá  Mehta-Rao` becomes `['priya', 'mehta', 'rao']`.
 */
export function signerNameTokens(value: string): string[] {
  return (
    value
      .normalize('NFD')
      // Combining marks: á -> a, so an accented spelling still matches.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // Hyphens and dots separate words rather than joining them.
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length > 0 && !HONORIFICS.has(token))
  );
}

export function signerNameMatches(typed: string, recorded: string): boolean {
  const typedTokens = signerNameTokens(typed);
  const recordedTokens = signerNameTokens(recorded);

  // A recorded name with nothing usable in it cannot be checked against, and
  // failing every decision would be worse than not checking. This only happens
  // if a contact was saved as punctuation or an honorific alone.
  if (recordedTokens.length === 0) return true;
  if (typedTokens.length === 0) return false;

  const typedSet = new Set(typedTokens);
  return recordedTokens.every((token) => typedSet.has(token));
}
