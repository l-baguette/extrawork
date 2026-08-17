import { createHash } from 'node:crypto';
import { EVIDENCE_DISCLAIMER, TERMS_VERSION, type AssuranceLevel } from '@extrawork/contracts';
import { CANONICALIZER_VERSION, canonicalize, type JsonValue } from '../canonical/jcs.js';

/**
 * Evidence manifest — report §8.5.
 *
 * An evidence pack is a PDF *plus* a machine-readable manifest. The manifest
 * carries the canonical snapshot digest, every attachment digest, the terminal
 * audit-event hash, and the generation metadata needed to certify custody
 * later (report §12.4) — without claiming the PDF settles admissibility.
 *
 * Regenerating the PDF may produce different bytes (fonts, metadata, renderer
 * version). The canonical snapshot hash, not the PDF hash, is the commercial
 * identity of the record. Both are recorded.
 */

export const EVIDENCE_TEMPLATE_VERSION = 'evidence-pdf-v1';
export const MANIFEST_SCHEMA_VERSION = 1;

export interface ManifestInput {
  organization: { id: string; displayName: string; legalName: string | null; gstin: string | null };
  project: { id: string; number: string; title: string; currency: string; timezone: string };
  changeOrder: { id: string; number: string };
  version: {
    id: string;
    versionNumber: number;
    status: string;
    canonicalSha256: string;
    canonicalizerVersion: string;
    termsVersion: string;
    sentAt: string;
    expiresAt: string;
  };
  commercial: {
    baselineTotalMinor: string;
    priorApprovedDeltaMinor: string;
    subtotalDeltaMinor: string;
    taxDeltaMinor: string;
    totalDeltaMinor: string;
    revisedContractTotalMinor: string;
  };
  schedule: { deltaDays: number; revisedCompletionDate: string | null };
  decision: {
    id: string;
    type: string;
    signerName: string;
    comment: string | null;
    assuranceAchieved: AssuranceLevel;
    verifiedPhoneMasked: string | null;
    occurredAt: string;
    ipHashHex: string | null;
    userAgent: string | null;
    receiptId: string;
  } | null;
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sha256: string;
    byteSize: number;
  }>;
  auditChain: {
    eventCount: number;
    firstSequence: number;
    lastSequence: number;
    terminalEventHash: string;
    verified: boolean;
  };
  generation: {
    generatedAt: string;
    templateVersion: string;
    rendererVersion: string;
    generatorVersion: string;
  };
}

export interface EvidenceManifest {
  manifest: JsonValue;
  canonicalJson: string;
  sha256Hex: string;
}

export function buildEvidenceManifest(input: ManifestInput): EvidenceManifest {
  const manifest: JsonValue = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    canonicalizerVersion: CANONICALIZER_VERSION,
    termsVersion: TERMS_VERSION,
    disclaimer: EVIDENCE_DISCLAIMER,
    organization: {
      displayName: input.organization.displayName,
      gstin: input.organization.gstin,
      id: input.organization.id,
      legalName: input.organization.legalName,
    },
    project: {
      currency: input.project.currency,
      id: input.project.id,
      number: input.project.number,
      timezone: input.project.timezone,
      title: input.project.title,
    },
    changeOrder: { id: input.changeOrder.id, number: input.changeOrder.number },
    version: {
      canonicalSha256: input.version.canonicalSha256,
      canonicalizerVersion: input.version.canonicalizerVersion,
      expiresAt: input.version.expiresAt,
      id: input.version.id,
      sentAt: input.version.sentAt,
      status: input.version.status,
      termsVersion: input.version.termsVersion,
      versionNumber: input.version.versionNumber,
    },
    commercial: {
      baselineTotalMinor: input.commercial.baselineTotalMinor,
      priorApprovedDeltaMinor: input.commercial.priorApprovedDeltaMinor,
      revisedContractTotalMinor: input.commercial.revisedContractTotalMinor,
      subtotalDeltaMinor: input.commercial.subtotalDeltaMinor,
      taxDeltaMinor: input.commercial.taxDeltaMinor,
      totalDeltaMinor: input.commercial.totalDeltaMinor,
    },
    schedule: {
      deltaDays: input.schedule.deltaDays,
      revisedCompletionDate: input.schedule.revisedCompletionDate,
    },
    decision: input.decision
      ? {
          assuranceAchieved: input.decision.assuranceAchieved,
          comment: input.decision.comment,
          id: input.decision.id,
          ipHashHex: input.decision.ipHashHex,
          occurredAt: input.decision.occurredAt,
          receiptId: input.decision.receiptId,
          signerName: input.decision.signerName,
          type: input.decision.type,
          userAgent: input.decision.userAgent,
          verifiedPhoneMasked: input.decision.verifiedPhoneMasked,
        }
      : null,
    attachments: input.attachments
      .slice()
      .sort((a, b) => a.sha256.localeCompare(b.sha256))
      .map((a) => ({
        byteSize: a.byteSize,
        filename: a.filename,
        id: a.id,
        mimeType: a.mimeType,
        sha256: a.sha256,
      })),
    auditChain: {
      eventCount: input.auditChain.eventCount,
      firstSequence: input.auditChain.firstSequence,
      lastSequence: input.auditChain.lastSequence,
      terminalEventHash: input.auditChain.terminalEventHash,
      verified: input.auditChain.verified,
    },
    generation: {
      generatedAt: input.generation.generatedAt,
      generatorVersion: input.generation.generatorVersion,
      rendererVersion: input.generation.rendererVersion,
      templateVersion: input.generation.templateVersion,
    },
  };

  const canonicalJson = canonicalize(manifest);
  return {
    manifest,
    canonicalJson,
    sha256Hex: createHash('sha256').update(canonicalJson, 'utf8').digest('hex'),
  };
}

/**
 * Verifies a stored manifest against a freshly computed digest. Used by the
 * golden tests and by the operational integrity job.
 */
export function verifyManifestDigest(manifest: unknown, expectedHex: string): boolean {
  const actual = createHash('sha256').update(canonicalize(manifest), 'utf8').digest('hex');
  return actual === expectedHex;
}
