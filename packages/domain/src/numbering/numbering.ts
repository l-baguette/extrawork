import { AppError } from '@extrawork/contracts';

/**
 * Numbering engine — report §8.2.
 *
 * Allocation itself is a single atomic UPSERT in `packages/db` (the report's
 * `document_sequences` statement). This module owns only the *format* and the
 * rules around it, so a format change never risks the allocation semantics.
 *
 * Numbers are identifiers, not accounting sequences: gaps are expected after a
 * rolled-back transaction or a cancelled draft, and a number is never reused
 * because reuse damages auditability.
 */

export const SEQUENCE_KINDS = ['CHANGE_ORDER', 'PROJECT', 'EVIDENCE_PACK'] as const;
export type SequenceKind = (typeof SEQUENCE_KINDS)[number];

export interface NumberFormat {
  prefix: string;
  padding: number;
}

/** MVP format from the report: `EW-{zero-padded value}`. */
export const DEFAULT_FORMATS: Record<SequenceKind, NumberFormat> = {
  CHANGE_ORDER: { prefix: 'EW-', padding: 3 },
  PROJECT: { prefix: 'P-', padding: 4 },
  EVIDENCE_PACK: { prefix: 'EP-', padding: 4 },
};

export function formatDocumentNumber(
  kind: SequenceKind,
  allocated: number,
  override?: Partial<NumberFormat>,
): string {
  if (!Number.isInteger(allocated) || allocated < 1) {
    throw new AppError('INTERNAL_ERROR', {
      message: `Sequence allocation must be a positive integer, received ${allocated}`,
    });
  }
  const base = DEFAULT_FORMATS[kind];
  const format = { ...base, ...override };
  return `${format.prefix}${String(allocated).padStart(format.padding, '0')}`;
}

/**
 * Scope of a sequence. Change orders are numbered per project (the report's
 * `UNIQUE (project_id, number)`); projects are numbered per organization.
 */
export function sequenceScope(
  kind: SequenceKind,
  projectId: string | null,
): {
  kind: SequenceKind;
  projectId: string | null;
} {
  if (kind === 'CHANGE_ORDER' || kind === 'EVIDENCE_PACK') {
    if (!projectId) {
      throw new AppError('INTERNAL_ERROR', { message: `${kind} numbering requires a project` });
    }
    return { kind, projectId };
  }
  return { kind, projectId: null };
}

/** Parses a formatted number back to its allocation, for imports and support. */
export function parseDocumentNumber(kind: SequenceKind, value: string): number | null {
  const { prefix } = DEFAULT_FORMATS[kind];
  if (!value.startsWith(prefix)) return null;
  const digits = value.slice(prefix.length);
  if (!/^\d+$/.test(digits)) return null;
  return Number.parseInt(digits, 10);
}
