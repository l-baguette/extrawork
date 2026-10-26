import { describe, expect, it } from 'vitest';
import {
  explicitProjectHint,
  parseIntakeMessage,
  projectSpill,
  parserSignals,
  routeProject,
  type RouteCandidate,
} from '@extrawork/domain';

/**
 * Which project a WhatsApp message is filed under (spec 2026-10-12, WhatsApp
 * conversation rules §3). The failure this guards against is a guess between
 * two firms: a foreman on two rosters must be asked, never routed to whichever
 * firm sorts first.
 */

const alphaTower: RouteCandidate = {
  id: 'p-alpha-1',
  organizationId: 'org-alpha',
  projectNumber: 'P-0001',
  title: 'Tower 4 Flat 1204',
  customerName: 'Mehta',
};
const alphaVilla: RouteCandidate = {
  id: 'p-alpha-2',
  organizationId: 'org-alpha',
  projectNumber: 'P-0002',
  title: 'Sharma villa',
  customerName: 'Sharma',
};
const betaFlat: RouteCandidate = {
  id: 'p-beta-1',
  organizationId: 'org-beta',
  projectNumber: 'P-0001',
  title: 'Juhu sea-view flat',
  customerName: 'Kapoor',
};

describe('explicitProjectHint', () => {
  it('prefers the labelled project line', () => {
    expect(explicitProjectHint('Project: Tower 4\nP-0002 too', 'Tower 4')).toBe('Tower 4');
  });

  it('reads a project code anywhere in the text, padded', () => {
    expect(explicitProjectHint('tiles for p-7 arrived', null)).toBe('P-0007');
    expect(explicitProjectHint('about P-0004-R03, the client agreed', null)).toBe('P-0004');
  });

  it('reads only the first line of a Project: value the parser ran on', () => {
    const body = 'Project: P-0001\nCan we add a cove light in the master bedroom\nCost: 18500';
    const parsed = parseIntakeMessage(body);
    expect(explicitProjectHint(body, parsed.project)).toBe('P-0001');
    expect(projectSpill(parsed.project)).toBe('Can we add a cove light in the master bedroom');
    expect(explicitProjectHint('Project: Sharma villa\nskirting', 'Sharma villa\nskirting')).toBe(
      'Sharma villa',
    );
  });

  it('finds nothing in ordinary text', () => {
    expect(explicitProjectHint('Plumber came today', null)).toBeNull();
    expect(explicitProjectHint('PVC pipe 4 inch', null)).toBeNull();
  });
});

describe('routeProject', () => {
  it('asks when a project number exists in two firms', () => {
    const outcome = routeProject({
      hint: 'P-0001',
      candidates: [alphaTower, alphaVilla, betaFlat],
      sticky: null,
    });
    expect(outcome).toEqual({ kind: 'ASK', candidates: [alphaTower, betaFlat] });
  });

  it('takes an exact number that names one project', () => {
    const outcome = routeProject({
      hint: 'P-0002',
      candidates: [alphaTower, alphaVilla, betaFlat],
      sticky: null,
    });
    expect(outcome).toMatchObject({ kind: 'CHOSEN', candidate: alphaVilla, via: 'HINT' });
  });

  it('matches a title the way people actually name a site', () => {
    const outcome = routeProject({
      hint: 'sharma villa',
      candidates: [alphaTower, alphaVilla, betaFlat],
      sticky: null,
    });
    expect(outcome).toMatchObject({ kind: 'CHOSEN', candidate: alphaVilla });
  });

  it('asks with the full list when the hint matches nothing, ignoring the sticky project', () => {
    const outcome = routeProject({
      hint: 'Tower 7',
      candidates: [alphaTower, alphaVilla],
      sticky: { organizationId: 'org-alpha', projectId: alphaTower.id },
    });
    expect(outcome).toEqual({ kind: 'ASK', candidates: [alphaTower, alphaVilla] });
  });

  it('uses the sticky project when nothing is named', () => {
    const outcome = routeProject({
      hint: null,
      candidates: [alphaTower, betaFlat],
      sticky: { organizationId: 'org-beta', projectId: betaFlat.id },
    });
    expect(outcome).toMatchObject({ kind: 'CHOSEN', candidate: betaFlat, via: 'STICKY' });
  });

  it('ignores a sticky project the sender is no longer on', () => {
    const outcome = routeProject({
      hint: null,
      candidates: [alphaTower, alphaVilla],
      sticky: { organizationId: 'org-beta', projectId: betaFlat.id },
    });
    expect(outcome.kind).toBe('ASK');
  });

  it('assumes the only candidate', () => {
    expect(routeProject({ hint: null, candidates: [alphaTower], sticky: null })).toMatchObject({
      kind: 'CHOSEN',
      via: 'ONLY',
    });
  });

  it('asks when there are several and nothing to go on', () => {
    expect(
      routeProject({ hint: null, candidates: [alphaTower, betaFlat], sticky: null }).kind,
    ).toBe('ASK');
  });
});

describe('parserSignals', () => {
  it('counts an unreadable amount as a price, so the message is a request', () => {
    const signals = parserSignals(parseIntakeMessage('What: Extra points\nCost: 15-20k'));
    expect(signals.hasAmount).toBe(true);
  });

  it('does not count zero days as a time impact', () => {
    expect(parserSignals(parseIntakeMessage('What: Extra points\nDays: 0')).hasDays).toBe(false);
  });

  it('counts labels other than the description', () => {
    const signals = parserSignals(
      parseIntakeMessage('What: Two extra points\nWhy: Layout changed\nCost: 1500'),
    );
    expect(signals.labelledFieldCount).toBeGreaterThanOrEqual(2);
    expect(parserSignals(parseIntakeMessage('Plumber came today')).labelledFieldCount).toBe(0);
  });
});
