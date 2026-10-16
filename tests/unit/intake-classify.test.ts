import { describe, expect, it } from 'vitest';
import { classifyMessage, detectCommand, parseChoice } from '@extrawork/domain';

const none = { hasAmount: false, hasDays: false, labelledFieldCount: 0 };

describe('WhatsApp message classification (spec 2026-10-12, D6)', () => {
  it('answers whole-message commands, case and punctuation aside', () => {
    expect(detectCommand('Help')).toEqual({ command: 'HELP' });
    expect(detectCommand('  contracts. ')).toEqual({ command: 'CONTRACTS' });
    expect(detectCommand('past contracts')).toEqual({ command: 'CONTRACTS' });
    expect(detectCommand('PROJECTS')).toEqual({ command: 'PROJECTS' });
    expect(detectCommand('request')).toEqual({ command: 'CONVERT_TO_REQUEST' });
    expect(detectCommand('file')).toEqual({ command: 'CONVERT_TO_CONTENT' });
  });

  it('never reads a sentence as a command just because it contains one', () => {
    expect(detectCommand('please file the drawing under plans')).toBeNull();
    expect(detectCommand('help me with the kitchen layout')).toBeNull();
  });

  it('reads a numbered or project-number answer to a pending choice', () => {
    expect(parseChoice('2')).toEqual({ command: 'CHOOSE', index: 2 });
    expect(parseChoice('#1')).toEqual({ command: 'CHOOSE', index: 1 });
    expect(parseChoice('p-4')).toEqual({ command: 'CHOOSE_PROJECT', projectNumber: 'P-0004' });
    expect(parseChoice('P 0012')).toEqual({
      command: 'CHOOSE_PROJECT',
      projectNumber: 'P-0012',
    });
    expect(parseChoice('0')).toBeNull();
    expect(parseChoice('two tiles cracked')).toBeNull();
  });

  it('treats a price, a time impact or the labelled format as a request', () => {
    expect(classifyMessage('4 points', 0, { ...none, hasAmount: true })).toEqual({
      kind: 'REQUEST',
      reasons: ['AMOUNT'],
    });
    expect(classifyMessage('x', 0, { ...none, hasDays: true }).kind).toBe('REQUEST');
    expect(classifyMessage('x', 0, { ...none, labelledFieldCount: 2 }).kind).toBe('REQUEST');
  });

  it('treats change language as a request, with or without a photo', () => {
    expect(classifyMessage('Can we move the switchboard near the door?', 0, none).kind).toBe(
      'REQUEST',
    );
    expect(classifyMessage('Use matt finish instead of gloss', 1, none).kind).toBe('REQUEST');
    expect(classifyMessage('Please add a shelf above the TV', 0, none).kind).toBe('REQUEST');
    expect(classifyMessage('mujhe yahan ek aur socket chahiye', 0, none).kind).toBe('REQUEST');
  });

  it('files everything else as content', () => {
    expect(classifyMessage('Tiles arrived today, stacked in the balcony', 0, none)).toEqual({
      kind: 'CONTENT',
    });
    expect(classifyMessage('', 3, none)).toEqual({ kind: 'CONTENT' });
    expect(classifyMessage('The extra tiles came back from the shop', 2, none).kind).toBe(
      'CONTENT',
    );
    // A single label is a caption, not the request format.
    expect(classifyMessage('site: Sharma flat', 1, { ...none, labelledFieldCount: 1 }).kind).toBe(
      'CONTENT',
    );
  });

  it('does not treat a command word with a photo as a command', () => {
    expect(classifyMessage('file', 1, none)).toEqual({ kind: 'CONTENT' });
  });
});
