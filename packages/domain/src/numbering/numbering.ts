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

/**
 * MVP formats from the report: `EW-{zero-padded value}`.
 *
 * `CHANGE_ORDER` here is the legacy request format. New requests are numbered
 * with `formatRequestNumber` (spec 2026-10-12, D8); this entry stays so legacy
 * numbers keep parsing and nothing that was ever issued is reinterpreted.
 */
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

/**
 * A request number that says which project it belongs to and how many requests
 * came before it — spec 2026-10-12, D8: `P-0004-R03` is the third request on
 * project P-0004, `P-0004-R100` the hundredth.
 *
 * The per-project sequence is the same one `EW-` numbers came from; only the
 * format changes, and only for numbers allocated from now on. A stored number
 * is an identifier the customer may already have been shown, so it is never
 * rewritten into this form.
 */
export const REQUEST_NUMBER_PADDING = 2;

export function formatRequestNumber(projectNumber: string, allocated: number): string {
  if (!Number.isInteger(allocated) || allocated < 1) {
    throw new AppError('INTERNAL_ERROR', {
      message: `Sequence allocation must be a positive integer, received ${allocated}`,
    });
  }
  const project = projectNumber.trim();
  if (!project) {
    throw new AppError('INTERNAL_ERROR', { message: 'A request number needs a project number' });
  }
  return `${project}-R${String(allocated).padStart(REQUEST_NUMBER_PADDING, '0')}`;
}

/** Splits `P-0004-R03` into its project number and sequence, or null. */
export function parseRequestNumber(
  value: string,
): { projectNumber: string; sequence: number } | null {
  const match = /^(.+)-R(\d+)$/.exec(value.trim());
  if (!match) return null;
  const sequence = Number.parseInt(match[2] as string, 10);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
  return { projectNumber: match[1] as string, sequence };
}

/**
 * Parses a formatted number back to its allocation, for imports and support.
 * A change-order number may be either the legacy `EW-001` form or the
 * project-scoped `P-0004-R03` form; both resolve to the per-project sequence.
 */
export function parseDocumentNumber(kind: SequenceKind, value: string): number | null {
  const { prefix } = DEFAULT_FORMATS[kind];
  if (!value.startsWith(prefix)) {
    return kind === 'CHANGE_ORDER' ? (parseRequestNumber(value)?.sequence ?? null) : null;
  }
  const digits = value.slice(prefix.length);
  if (!/^\d+$/.test(digits)) return null;
  return Number.parseInt(digits, 10);
}
