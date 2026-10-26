import { describe, expect, it } from 'vitest';
import { AppError } from '@extrawork/contracts';
import {
  buildCanonicalSnapshot,
  collectSendBlockers,
  formatDocumentNumber,
  formatRequestNumber,
  freezeSnapshot,
  inferRoom,
  inferWorkCategory,
  parseDocumentNumber,
  parseIntakeMessage,
  parseRequestNumber,
  validateDraft,
} from '@extrawork/domain';

/**
 * Spec 2026-10-12, slice B: room and type of work in the frozen record (D9),
 * project-scoped request numbers (D8), proposals that may be incomplete (D4),
 * and the parser that reads room and type of work out of a pasted message.
 */

function snapshotInput() {
  return {
    organization: { legalName: 'Shree Interiors LLP', displayName: 'Shree Interiors', gstin: null },
    project: {
      id: '019f0000-0000-7000-8000-000000000001',
      number: 'P-0001',
      title: 'Flat fit-out',
      baselineTotalMinor: 214_760_000n,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
    },
    change: {
      id: '019f0000-0000-7000-8000-000000000002',
      number: 'EW-001',
      version: 1,
      type: 'ADDITION',
    },
    scope: { title: 'Wiring', description: 'Two circuits', reason: null } as {
      title: string;
      description: string;
      reason: string | null;
      room?: string | null;
      workCategory?: string | null;
    },
    commercial: {
      currency: 'INR',
      lines: [
        {
          position: 0,
          description: 'Circuit',
          quantity: '2.000',
          unit: 'point',
          unitPriceMinor: 650_000n,
          taxRateBps: 1800,
          direction: 1 as const,
          subtotalMinor: 1_300_000n,
          taxMinor: 234_000n,
          totalMinor: 1_534_000n,
        },
      ],
      subtotalDeltaMinor: 1_300_000n,
      taxDeltaMinor: 234_000n,
      totalDeltaMinor: 1_534_000n,
      priorApprovedDeltaMinor: 0n,
      revisedContractTotalMinor: 216_294_000n,
    },
    schedule: { deltaDays: 2, revisedCompletionDate: '2026-10-14' },
    approver: {
      contactId: '019f0000-0000-7000-8000-000000000003',
      name: 'Priya Mehta',
      maskedPhone: '+91******2345',
      maskedEmail: null,
      authorityNote: null,
    },
    attachments: [],
    assuranceRequired: 'A0',
    expiresAt: '2026-08-28T18:30:00.000Z',
    sentAt: '2026-08-14T06:00:00.000Z',
  };
}

describe('room and type of work in the snapshot (D9)', () => {
  it('leaves a version without them byte-identical to before they existed', () => {
    const plain = freezeSnapshot(snapshotInput());
    const explicitNulls = snapshotInput();
    explicitNulls.scope = { ...explicitNulls.scope, room: null, workCategory: null };
    const withNulls = freezeSnapshot(explicitNulls);

    expect(withNulls.canonicalJson).toBe(plain.canonicalJson);
    expect(withNulls.sha256Hex).toBe(plain.sha256Hex);
    const scope = (buildCanonicalSnapshot(explicitNulls) as { scope: Record<string, unknown> })
      .scope;
    expect(Object.keys(scope).sort()).toEqual(['description', 'reason', 'title']);
  });

  it('freezes them as terms when present, so they change the digest', () => {
    const plain = freezeSnapshot(snapshotInput());
    const input = snapshotInput();
    input.scope = { ...input.scope, room: 'Master bedroom', workCategory: 'ELECTRICAL' };
    const frozen = freezeSnapshot(input);

    expect(frozen.sha256Hex).not.toBe(plain.sha256Hex);
    const scope = (frozen.snapshot as { scope: Record<string, unknown> }).scope;
    expect(scope.room).toBe('Master bedroom');
    expect(scope.workCategory).toBe('ELECTRICAL');

    const onlyRoom = snapshotInput();
    onlyRoom.scope = { ...onlyRoom.scope, room: 'Kitchen' };
    const onlyRoomScope = (buildCanonicalSnapshot(onlyRoom) as { scope: Record<string, unknown> })
      .scope;
    expect(onlyRoomScope).not.toHaveProperty('workCategory');
  });
});

describe('request numbers (D8)', () => {
  it('carries the project number and how many requests came before', () => {
    expect(formatRequestNumber('P-0004', 3)).toBe('P-0004-R03');
    expect(formatRequestNumber('P-0004', 12)).toBe('P-0004-R12');
    expect(formatRequestNumber('P-0004', 100)).toBe('P-0004-R100');
  });

  it('refuses allocations that cannot come from the sequence', () => {
    expect(() => formatRequestNumber('P-0004', 0)).toThrow(AppError);
    expect(() => formatRequestNumber('P-0004', 1.5)).toThrow(AppError);
    expect(() => formatRequestNumber('  ', 1)).toThrow(AppError);
  });

  it('parses both the new form and legacy EW- numbers back to the sequence', () => {
    expect(parseRequestNumber('P-0004-R03')).toEqual({ projectNumber: 'P-0004', sequence: 3 });
    expect(parseDocumentNumber('CHANGE_ORDER', 'P-0004-R100')).toBe(100);
    expect(parseDocumentNumber('CHANGE_ORDER', 'EW-007')).toBe(7);
    expect(formatDocumentNumber('CHANGE_ORDER', 7)).toBe('EW-007');
    expect(parseRequestNumber('P-0004')).toBeNull();
    expect(parseDocumentNumber('CHANGE_ORDER', 'nonsense')).toBeNull();
  });
});

describe('drafts may be incomplete, sends may not (D4)', () => {
  const base = {
    projectCurrency: 'INR',
    currency: 'INR',
    projectStatus: 'ACTIVE',
    baselineTotalMinor: 100_000n,
    priorApprovedDeltaMinor: 0n,
    lineItems: [],
    scheduleDeltaDays: 0,
    type: 'TIME_ONLY' as const,
    assuranceRequired: 'A0' as const,
    attachmentScanStatuses: [],
  };

  // Any draft may be saved empty: the composer autosaves from the first step
  // and a photo picked before any price needs a draft to attach to. Substance
  // is enforced at send, below.
  it('saves an empty draft', () => {
    expect(validateDraft(base).totalDeltaMinor).toBe(0n);
  });

  it('still refuses what saving an empty draft does not excuse', () => {
    expect(() => validateDraft({ ...base, currency: 'USD' })).toThrow(
      expect.objectContaining({ code: 'CURRENCY_MISMATCH' }),
    );
  });

  it('still blocks the send of an empty proposal', () => {
    const blockers = collectSendBlockers({
      lineItems: [],
      scheduleDeltaDays: 0,
      attachmentScanStatuses: [],
      approverHasContactChannel: true,
      projectStatus: 'ACTIVE',
      scopeLength: 40,
      readOnlySubscription: false,
    });
    expect(blockers.map((b) => b.code)).toContain('EMPTY_CHANGE');
  });
});

describe('room and type of work from a message', () => {
  it('reads labelled room and type', () => {
    const parsed = parseIntakeMessage(
      'Room: Master bedroom\nType: electrical\nAdd 4 sockets near the bed\nCost: 3200',
    );
    expect(parsed.room).toBe('Master bedroom');
    expect(parsed.workCategory).toBe('ELECTRICAL');
    expect(parsed.amountMinor).toBe(320_000n);
  });

  it('accepts area:, category: and the category code or label', () => {
    expect(parseIntakeMessage('Area: Balcony 2\nCategory: PLUMBING\nTap shift').room).toBe(
      'Balcony 2',
    );
    expect(parseIntakeMessage('Category: Plumbing & sanitary\nShift the tap').workCategory).toBe(
      'PLUMBING',
    );
    expect(parseIntakeMessage('Area: Kitchen\nCategory: false ceiling\nx').workCategory).toBe(
      'FALSE_CEILING',
    );
  });

  it('keeps location: as the project unless it names a room', () => {
    const project = parseIntakeMessage('Extra wiring in hall\nLocation: Tower 4, 1204');
    expect(project.project).toBe('Tower 4, 1204');
    expect(project.room).toBeNull();

    const room = parseIntakeMessage('Extra wiring\nLocation: kitchen');
    expect(room.room).toBe('Kitchen');
    expect(room.project).toBeNull();
  });

  it('keeps work: as the description unless it is just a trade', () => {
    const described = parseIntakeMessage('Work: 4 extra sockets in hall\nCost: 3000');
    expect(described.description).toBe('4 extra sockets in hall');
    expect(described.workCategory).toBe('ELECTRICAL');

    const short = parseIntakeMessage('Work: 4 sockets\nCost: 3000');
    expect(short.description).toBe('4 sockets');

    const trade = parseIntakeMessage('Work: plumbing\nWhat: shift the kitchen tap 2 feet');
    expect(trade.workCategory).toBe('PLUMBING');
    expect(trade.description).toBe('shift the kitchen tap 2 feet');
  });

  it('infers the room from exactly one phrase in the description', () => {
    expect(inferRoom('Shift the light point in the master bedroom')).toBe('Master bedroom');
    expect(inferRoom("Paint the kids' bedroom walls")).toBe("Kids' bedroom");
    // Two rooms named: not a guess.
    expect(inferRoom('Move tiles from kitchen to balcony')).toBeNull();
    expect(inferRoom('Add a socket')).toBeNull();
    expect(inferRoom(null)).toBeNull();
  });

  it('infers the type of work from a keyword map, and only when unambiguous', () => {
    const cases: Array<[string, string]> = [
      ['Replace the leaking pipe', 'PLUMBING'],
      ['Add two more switch points', 'ELECTRICAL'],
      ['Repaint the hall', 'PAINTING'],
      ['Change marble near entrance', 'FLOORING'],
      ['Gypsum false ceiling in the hall', 'FALSE_CEILING'],
      ['POP cornice', 'FALSE_CEILING'],
      ['Extra wardrobe shutters', 'CARPENTRY'],
      ['Modular kitchen tall unit', 'MODULAR_KITCHEN'],
      ['AC duct reroute', 'HVAC'],
      ['Waterproofing on the terrace', 'WATERPROOFING'],
      ['Demolish the ledge', 'DEMOLITION'],
      ['Brick wall with plaster', 'CIVIL'],
      ['Glass partition', 'GLASS_ALUMINIUM'],
      ['MS grill for window', 'FABRICATION'],
      ['New sofa', 'FURNITURE'],
    ];
    for (const [text, category] of cases) {
      expect(inferWorkCategory(text), text).toBe(category);
    }
    // Two trades: null, never a guess.
    expect(inferWorkCategory('Paint and tile the bathroom')).toBeNull();
    // POP and MS only count in capitals.
    expect(inferWorkCategory('pop by tomorrow')).toBeNull();
    expect(inferWorkCategory('ms sharma asked')).toBeNull();
    expect(inferWorkCategory('Something else entirely')).toBeNull();
  });

  it('does not infer over a label, even a label it could not read', () => {
    const parsed = parseIntakeMessage('Repaint the kitchen wall\nType: something odd');
    expect(parsed.workCategory).toBeNull();
    expect(parsed.room).toBe('Kitchen');
  });
});
