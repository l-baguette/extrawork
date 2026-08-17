import { createHash } from 'node:crypto';
import { TERMS_VERSION } from '@extrawork/contracts';
import { CANONICALIZER_VERSION, canonicalBytes, canonicalize, type JsonValue } from './jcs.js';

/**
 * Snapshot and version engine — report §8.3. At send, the exact commercial and
 * scope state is frozen into a canonical JSON object. That object, its digest,
 * the canonicalizer version and the terms version are permanent for that
 * version and are never rewritten (report §9.6).
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface SnapshotInput {
  organization: {
    legalName: string | null;
    displayName: string;
    gstin: string | null;
  };
  project: {
    id: string;
    number: string;
    title: string;
    baselineTotalMinor: bigint;
    currency: string;
    timezone: string;
  };
  change: {
    id: string;
    number: string;
    version: number;
    type: string;
  };
  scope: {
    title: string;
    description: string;
    reason: string | null;
  };
  commercial: {
    currency: string;
    lines: Array<{
      position: number;
      description: string;
      quantity: string;
      unit: string | null;
      unitPriceMinor: bigint;
      taxRateBps: number;
      direction: 1 | -1;
      subtotalMinor: bigint;
      taxMinor: bigint;
      totalMinor: bigint;
    }>;
    subtotalDeltaMinor: bigint;
    taxDeltaMinor: bigint;
    totalDeltaMinor: bigint;
    priorApprovedDeltaMinor: bigint;
    revisedContractTotalMinor: bigint;
  };
  schedule: {
    deltaDays: number;
    revisedCompletionDate: string | null;
  };
  approver: {
    contactId: string;
    name: string;
    maskedPhone: string | null;
    maskedEmail: string | null;
    authorityNote: string | null;
  };
  attachments: Array<{
    id: string;
    sha256: string;
    mimeType: string;
    filename: string;
    byteSize: number;
    caption: string | null;
  }>;
  assuranceRequired: string;
  expiresAt: string;
  sentAt: string;
}

/**
 * Monetary values are emitted as decimal strings, not JSON numbers. A digest
 * must not depend on how a JSON parser happens to represent a large integer,
 * and the report forbids float money end to end.
 */
export function buildCanonicalSnapshot(input: SnapshotInput): JsonValue {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    canonicalizerVersion: CANONICALIZER_VERSION,
    termsVersion: TERMS_VERSION,
    organization: {
      displayName: input.organization.displayName,
      gstin: input.organization.gstin,
      legalName: input.organization.legalName,
    },
    project: {
      baselineTotalMinor: input.project.baselineTotalMinor.toString(),
      currency: input.project.currency,
      id: input.project.id,
      number: input.project.number,
      timezone: input.project.timezone,
      title: input.project.title,
    },
    change: {
      id: input.change.id,
      number: input.change.number,
      type: input.change.type,
      version: input.change.version,
    },
    scope: {
      description: input.scope.description,
      reason: input.scope.reason,
      title: input.scope.title,
    },
    commercial: {
      currency: input.commercial.currency,
      lines: input.commercial.lines.map((line) => ({
        description: line.description,
        direction: line.direction,
        position: line.position,
        quantity: line.quantity,
        subtotalMinor: line.subtotalMinor.toString(),
        taxMinor: line.taxMinor.toString(),
        taxRateBps: line.taxRateBps,
        totalMinor: line.totalMinor.toString(),
        unit: line.unit,
        unitPriceMinor: line.unitPriceMinor.toString(),
      })),
      priorApprovedDeltaMinor: input.commercial.priorApprovedDeltaMinor.toString(),
      revisedContractTotalMinor: input.commercial.revisedContractTotalMinor.toString(),
      subtotalDeltaMinor: input.commercial.subtotalDeltaMinor.toString(),
      taxDeltaMinor: input.commercial.taxDeltaMinor.toString(),
      totalDeltaMinor: input.commercial.totalDeltaMinor.toString(),
    },
    schedule: {
      deltaDays: input.schedule.deltaDays,
      revisedCompletionDate: input.schedule.revisedCompletionDate,
    },
    approver: {
      authorityNote: input.approver.authorityNote,
      contactId: input.approver.contactId,
      maskedEmail: input.approver.maskedEmail,
      maskedPhone: input.approver.maskedPhone,
      name: input.approver.name,
    },
    attachments: input.attachments
      // Sorted so attachment upload order cannot change the digest.
      .slice()
      .sort((a, b) =>
        a.sha256 === b.sha256 ? a.id.localeCompare(b.id) : a.sha256.localeCompare(b.sha256),
      )
      .map((a) => ({
        byteSize: a.byteSize,
        caption: a.caption,
        filename: a.filename,
        id: a.id,
        mimeType: a.mimeType,
        sha256: a.sha256,
      })),
    assuranceRequired: input.assuranceRequired,
    expiresAt: input.expiresAt,
    sentAt: input.sentAt,
  };
}

export interface FrozenSnapshot {
  snapshot: JsonValue;
  canonicalJson: string;
  sha256: Buffer;
  sha256Hex: string;
  canonicalizerVersion: string;
  termsVersion: string;
}

export function freezeSnapshot(input: SnapshotInput): FrozenSnapshot {
  const snapshot = buildCanonicalSnapshot(input);
  const canonicalJson = canonicalize(snapshot);
  const sha256 = createHash('sha256').update(canonicalJson, 'utf8').digest();
  return {
    snapshot,
    canonicalJson,
    sha256,
    sha256Hex: sha256.toString('hex'),
    canonicalizerVersion: CANONICALIZER_VERSION,
    termsVersion: TERMS_VERSION,
  };
}

/** Recomputes the digest of a stored snapshot to detect later modification. */
export function verifySnapshotDigest(snapshot: unknown, expected: Buffer | string): boolean {
  const actual = createHash('sha256').update(canonicalBytes(snapshot)).digest();
  const expectedBuffer = typeof expected === 'string' ? Buffer.from(expected, 'hex') : expected;
  return actual.length === expectedBuffer.length && actual.equals(expectedBuffer);
}

export function sha256Hex(value: Buffer | string): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? Buffer.from(value, 'utf8') : value)
    .digest('hex');
}
