import { AppError, assuranceCopy } from '@extrawork/contracts';
import type { Database, Repositories } from '@extrawork/db';
import { readChain, verifyAggregateChain } from '@extrawork/db';
import {
  EVIDENCE_TEMPLATE_VERSION,
  type JsonValue,
  buildEvidenceManifest,
  calculateVersionTotals,
  formatMoney,
  maskPhone,
  systemTenantContext,
  verifySnapshotDigest,
  type ManifestInput,
} from '@extrawork/domain';

/**
 * Assembles everything an evidence pack needs — report §8.5.
 *
 * Runs two integrity checks before producing anything, so a corrupted record
 * cannot be laundered into an official-looking PDF:
 *   1. the stored canonical snapshot still hashes to its recorded digest;
 *   2. the aggregate's audit chain recomputes cleanly.
 * Report §8.1 requires a mismatch to block new evidence generation.
 */

export interface EvidenceViewModel {
  /**
   * The manifest *document* itself — the JSON a recipient is handed. Its digest
   * is `manifestSha256`, reproducible by anyone holding this object alone via
   * `verifyManifestDigest`. Exposing the builder's wrapper here instead would
   * embed the digest inside the thing being digested.
   */
  manifest: JsonValue;
  manifestSha256: string;
  manifestCanonicalJson: string;
  templateVersion: string;
  render: {
    organizationName: string;
    organizationLegalName: string | null;
    organizationGstin: string | null;
    projectTitle: string;
    projectNumber: string;
    customerName: string;
    changeNumber: string;
    versionNumber: number;
    status: string;
    statusLabel: string;
    title: string;
    scope: string;
    reason: string | null;
    currency: string;
    lineItems: Array<{
      description: string;
      quantity: string;
      unit: string | null;
      unitPrice: string;
      taxRate: string;
      total: string;
    }>;
    subtotalDelta: string;
    taxDelta: string;
    totalDelta: string;
    baselineTotal: string;
    priorApprovedDelta: string;
    revisedContractTotal: string;
    scheduleDeltaDays: number;
    revisedCompletionDate: string | null;
    approverName: string;
    approverMaskedContact: string;
    assuranceLabel: string;
    assuranceStatement: string;
    assuranceLimitation: string;
    disclaimer: string;
    decision: {
      type: string;
      signerName: string;
      comment: string | null;
      occurredAt: string;
      receiptId: string;
      declarationText: string;
    } | null;
    attachments: Array<{ filename: string; sha256: string; mimeType: string; byteSize: string }>;
    events: Array<{ sequence: number; type: string; occurredAt: string; actor: string }>;
    canonicalSha256: string;
    manifestSha256: string;
    terminalEventHash: string;
    chainVerified: boolean;
    generatedAt: string;
    templateVersion: string;
    canonicalizerVersion: string;
    termsVersion: string;
  };
}

export interface BuildEvidenceOptions {
  db: Database;
  repos: Repositories;
  versionId: string;
  organizationId: string;
  requestId: string;
  generatorVersion: string;
  rendererVersion: string;
  now: Date;
  locale?: string;
}

export async function buildEvidenceViewModel(
  options: BuildEvidenceOptions,
): Promise<EvidenceViewModel> {
  const tenant = systemTenantContext(options.organizationId, options.requestId);
  const { repos, db } = options;

  const version = await repos.changeOrders.requireVersion(db, tenant, options.versionId);
  if (!version.canonicalSnapshot || !version.canonicalSha256) {
    throw new AppError('INVALID_STATE_TRANSITION', {
      message: 'Evidence can only be produced for a version that has been sent.',
    });
  }

  // Integrity gate 1: the snapshot must still hash to its recorded digest.
  if (!verifySnapshotDigest(version.canonicalSnapshot, version.canonicalSha256)) {
    throw new AppError('INTERNAL_ERROR', {
      message:
        'The stored change snapshot does not match its recorded digest. Evidence generation is blocked pending review.',
      details: { versionId: version.id, integrity: 'SNAPSHOT_DIGEST_MISMATCH' },
    });
  }

  const [changeOrder, project, organization, lineItems, attachments, approver, decision] =
    await Promise.all([
      repos.changeOrders.requireChangeOrder(db, tenant, version.changeOrderId),
      repos.projects.requireById(tenant, version.projectId),
      repos.organizations.findById(tenant),
      repos.changeOrders.listLineItems(db, version.id),
      repos.changeOrders.listAttachments(db, version.id),
      repos.customers.requireContact(tenant, version.approverContactId),
      repos.approvals.findDecisionByVersion(db, tenant, version.id),
    ]);
  if (!organization) throw new AppError('NOT_FOUND');
  const customer = await repos.customers.requireById(tenant, project.customerId);

  // Integrity gate 2: totals must recompute to the stored values.
  const recomputed = calculateVersionTotals(
    lineItems.map((l) => ({
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      taxRateBps: l.taxRateBps,
      direction: l.direction,
    })),
  );
  if (recomputed.totalDeltaMinor !== version.totalDeltaMinor) {
    throw new AppError('INTERNAL_ERROR', {
      message:
        'The stored totals do not match a recomputation from line items. Evidence generation is blocked pending review.',
      details: { versionId: version.id, integrity: 'TOTALS_MISMATCH' },
    });
  }

  // Integrity gate 3: the audit chain must recompute (report §8.5).
  const chain = await verifyAggregateChain(db, tenant, 'change_order', version.changeOrderId);
  const events = await readChain(db, tenant, 'change_order', version.changeOrderId);

  const decisionCopy = decision ? assuranceCopy(decision.assuranceAchieved) : null;
  const requiredCopy = assuranceCopy(version.assuranceRequired);

  const manifestInput: ManifestInput = {
    organization: {
      id: organization.id,
      displayName: organization.displayName,
      legalName: organization.legalName,
      gstin: organization.gstin,
    },
    project: {
      id: project.id,
      number: project.projectNumber,
      title: project.title,
      currency: project.currency,
      timezone: project.timezone,
    },
    changeOrder: { id: changeOrder.id, number: changeOrder.number },
    version: {
      id: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      canonicalSha256: version.canonicalSha256.toString('hex'),
      canonicalizerVersion: version.canonicalizerVersion ?? 'unknown',
      termsVersion: version.termsVersion ?? 'unknown',
      sentAt: (version.sentAt ?? version.createdAt).toISOString(),
      expiresAt: (version.expiresAt ?? version.createdAt).toISOString(),
    },
    commercial: {
      baselineTotalMinor: (version.baselineTotalMinor ?? project.baselineTotalMinor).toString(),
      priorApprovedDeltaMinor: (version.priorApprovedDeltaMinor ?? 0n).toString(),
      subtotalDeltaMinor: version.subtotalDeltaMinor.toString(),
      taxDeltaMinor: version.taxDeltaMinor.toString(),
      totalDeltaMinor: version.totalDeltaMinor.toString(),
      revisedContractTotalMinor: (
        version.revisedContractTotalMinor ?? project.revisedTotalMinor
      ).toString(),
    },
    schedule: {
      deltaDays: version.scheduleDeltaDays,
      revisedCompletionDate: version.revisedCompletionDate,
    },
    decision: decision
      ? {
          id: decision.id,
          type: decision.type,
          signerName: decision.signerName,
          comment: decision.signerComment,
          assuranceAchieved: decision.assuranceAchieved,
          verifiedPhoneMasked: maskPhone(decision.verifiedPhoneE164),
          occurredAt: decision.occurredAt.toISOString(),
          // Recorded as a keyed hash, never a raw address (report §12.3).
          ipHashHex: null,
          userAgent: null,
          receiptId: decision.receiptDisplayId,
        }
      : null,
    attachments: attachments.map((a) => ({
      id: a.fileObjectId,
      filename: a.filename,
      mimeType: a.mimeType,
      sha256: a.sha256?.toString('hex') ?? '',
      byteSize: Number(a.byteSize),
    })),
    auditChain: {
      eventCount: chain.eventCount,
      firstSequence: events[0]?.sequence ?? 0,
      lastSequence: events[events.length - 1]?.sequence ?? 0,
      terminalEventHash: chain.terminalHash ?? '',
      verified: chain.valid,
    },
    generation: {
      generatedAt: options.now.toISOString(),
      templateVersion: EVIDENCE_TEMPLATE_VERSION,
      rendererVersion: options.rendererVersion,
      generatorVersion: options.generatorVersion,
    },
  };

  const manifest = buildEvidenceManifest(manifestInput);
  const locale = options.locale ?? 'en-IN';
  const money = (value: bigint) => formatMoney(value, version.currency, locale);

  return {
    manifest: manifest.manifest,
    manifestSha256: manifest.sha256Hex,
    manifestCanonicalJson: manifest.canonicalJson,
    templateVersion: EVIDENCE_TEMPLATE_VERSION,
    render: {
      organizationName: organization.displayName,
      organizationLegalName: organization.legalName,
      organizationGstin: organization.gstin,
      projectTitle: project.title,
      projectNumber: project.projectNumber,
      customerName: customer.displayName,
      changeNumber: changeOrder.number,
      versionNumber: version.versionNumber,
      status: version.status,
      statusLabel: version.status.replace(/_/g, ' ').toLowerCase(),
      title: version.title,
      scope: version.scopeDescription,
      reason: version.reason,
      currency: version.currency,
      lineItems: lineItems.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: money(l.unitPriceMinor),
        taxRate: `${(l.taxRateBps / 100).toFixed(2)}%`,
        total: money(l.totalMinor),
      })),
      subtotalDelta: money(version.subtotalDeltaMinor),
      taxDelta: money(version.taxDeltaMinor),
      totalDelta: money(version.totalDeltaMinor),
      baselineTotal: money(version.baselineTotalMinor ?? project.baselineTotalMinor),
      priorApprovedDelta: money(version.priorApprovedDeltaMinor ?? 0n),
      revisedContractTotal: money(version.revisedContractTotalMinor ?? project.revisedTotalMinor),
      scheduleDeltaDays: version.scheduleDeltaDays,
      revisedCompletionDate: version.revisedCompletionDate,
      approverName: approver.name,
      approverMaskedContact:
        maskPhone(approver.phoneE164) ?? approver.emailNormalized ?? 'contact on file',
      assuranceLabel: (decisionCopy ?? requiredCopy).label,
      assuranceStatement: (decisionCopy ?? requiredCopy).evidenceStatement,
      assuranceLimitation: (decisionCopy ?? requiredCopy).limitation,
      disclaimer: manifestInput.decision
        ? (manifest.manifest as { disclaimer: string }).disclaimer
        : (manifest.manifest as { disclaimer: string }).disclaimer,
      decision: decision
        ? {
            type: decision.type,
            signerName: decision.signerName,
            comment: decision.signerComment,
            occurredAt: formatInTimezone(decision.occurredAt, project.timezone),
            receiptId: decision.receiptDisplayId,
            declarationText: (decisionCopy ?? requiredCopy).evidenceStatement,
          }
        : null,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        sha256: a.sha256?.toString('hex') ?? '(not recorded)',
        mimeType: a.mimeType,
        // A display byte count, not a monetary amount; the money rounding rule
        // does not apply here.
        // eslint-disable-next-line no-restricted-syntax
        byteSize: `${Math.max(1, Math.round(Number(a.byteSize) / 1024))} KB`,
      })),
      events: events.map((e) => ({
        sequence: e.sequence,
        type: e.eventType,
        occurredAt: formatInTimezone(e.occurredAt, project.timezone),
        actor: e.actorType,
      })),
      canonicalSha256: version.canonicalSha256.toString('hex'),
      manifestSha256: manifest.sha256Hex,
      terminalEventHash: chain.terminalHash ?? '',
      chainVerified: chain.valid,
      generatedAt: formatInTimezone(options.now, project.timezone),
      templateVersion: EVIDENCE_TEMPLATE_VERSION,
      canonicalizerVersion: version.canonicalizerVersion ?? 'unknown',
      termsVersion: version.termsVersion ?? 'unknown',
    },
  };
}

/** Report §2.2: stored in UTC, rendered in the organization's timezone. */
export function formatInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
  }).format(date);
}
