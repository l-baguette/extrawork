import { describe, expect, it } from 'vitest';
import { DECIDED_LINK_RETENTION_DAYS, decidedLinkStillVisible } from '@extrawork/domain';

/**
 * How long a decided approval link keeps rendering — report §6.7.
 *
 * Before this rule existed there was no bound at all: `findByToken` applies no
 * time filter, and `resolve` skips `assertTokenUsable` entirely once a decision
 * exists, so a decided link rendered the customer's name, the approver's masked
 * contact, the full scope and the amount to anyone holding the URL, forever.
 *
 * The window is a disclosure bound, not an access grant. A second decision was
 * already impossible — the state machine refuses a terminal version — so this
 * governs visibility alone.
 */

const DAY = 86_400_000;
const DECIDED = new Date('2026-01-01T00:00:00Z');
const at = (days: number) => new Date(DECIDED.getTime() + days * DAY);

describe('decided link retention', () => {
  it('keeps the receipt readable the day it was decided', () => {
    expect(decidedLinkStillVisible(DECIDED, DECIDED)).toBe(true);
  });

  it('keeps it readable through a long invoice dispute', () => {
    expect(decidedLinkStillVisible(DECIDED, at(179))).toBe(true);
  });

  it('is inclusive on the final day rather than closing a day early', () => {
    expect(decidedLinkStillVisible(DECIDED, at(DECIDED_LINK_RETENTION_DAYS))).toBe(true);
  });

  it('closes the link once the window has passed', () => {
    // The record is still complete in the owner's evidence pack; it is only the
    // public URL that stops resolving.
    expect(decidedLinkStillVisible(DECIDED, at(DECIDED_LINK_RETENTION_DAYS + 1))).toBe(false);
  });

  it('closes a link found in an old phone backup years later', () => {
    expect(decidedLinkStillVisible(DECIDED, at(900))).toBe(false);
  });

  it('is six months, not a fortnight or forever', () => {
    expect(DECIDED_LINK_RETENTION_DAYS).toBe(180);
  });
});
