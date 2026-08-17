import { describe, expect, it } from 'vitest';
import { signerNameMatches, signerNameTokens } from '@extrawork/contracts';

/**
 * The typed name is the signature.
 *
 * A0 assurance states that "the holder of a private link typed the name shown
 * below and confirmed the statement". If any name were accepted, that sentence
 * would be false on every record that used a different one — so the comparison
 * is forgiving about spelling and strict about identity.
 */
describe('signer name matching', () => {
  it('accepts the same name written differently', () => {
    for (const typed of [
      'Priya Mehta',
      'priya mehta',
      'PRIYA MEHTA',
      '  Priya   Mehta  ',
      'Priya Mehta.',
      'Mrs Priya Mehta',
      'Smt. Priya Mehta',
      'Mehta Priya',
      'Priyá Mehta',
    ]) {
      expect(signerNameMatches(typed, 'Priya Mehta'), typed).toBe(true);
    }
  });

  it('accepts a middle name the contractor never recorded', () => {
    expect(signerNameMatches('Priya R Mehta', 'Priya Mehta')).toBe(true);
  });

  it('refuses somebody else', () => {
    for (const typed of ['Arun Kumar', 'Priya Sharma', 'Rajesh Mehta', 'X']) {
      expect(signerNameMatches(typed, 'Priya Mehta'), typed).toBe(false);
    }
  });

  it('refuses a first name alone', () => {
    // Two people on one project can share a first name; the surname is what
    // distinguishes them.
    expect(signerNameMatches('Priya', 'Priya Mehta')).toBe(false);
  });

  it('refuses an empty or punctuation-only entry', () => {
    expect(signerNameMatches('', 'Priya Mehta')).toBe(false);
    expect(signerNameMatches('...', 'Priya Mehta')).toBe(false);
  });

  it('splits hyphenated names into words', () => {
    expect(signerNameTokens('Priya Mehta-Rao')).toEqual(['priya', 'mehta', 'rao']);
    expect(signerNameMatches('Priya Mehta Rao', 'Priya Mehta-Rao')).toBe(true);
  });

  it('does not lock out a contact recorded as an honorific alone', () => {
    // Nothing usable to compare against, and failing every decision would be
    // worse than not checking this one.
    expect(signerNameMatches('Anyone', 'Mr.')).toBe(true);
  });

  it('handles a company name as the approver', () => {
    expect(signerNameMatches('Nandi Cafe Pvt Ltd', 'Nandi Cafe Pvt Ltd')).toBe(true);
    expect(signerNameMatches('Nandi Cafe', 'Nandi Cafe Pvt Ltd')).toBe(false);
  });
});
