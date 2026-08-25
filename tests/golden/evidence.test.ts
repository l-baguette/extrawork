import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EVIDENCE_DISCLAIMER, ASSURANCE_COPY, TERMS_VERSION } from '@extrawork/contracts';
import { buildEvidenceViewModel, FixedClock } from '@extrawork/application';
import { CANONICALIZER_VERSION, canonicalize, verifyManifestDigest } from '@extrawork/domain';
import type { Container } from '@extrawork/runtime';
import {
  createTenant,
  createTestContainer,
  publicContext,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';
import {
  renderEvidenceHtml,
  renderProjectEvidencePackHtml,
} from '../../apps/worker/src/pdf/template.js';
import { ChromiumPdfRenderer } from '../../apps/worker/src/pdf/renderer.js';

/**
 * The signing date comes from the fixture's own pinned clock, not the wall
 * clock. The golden suite freezes time so the canonical JSON and its digest are
 * reproducible; a signing date taken from the real today would drift away from
 * that frozen instant every day and be refused as implausible — which is the
 * domain rule working, not a test to weaken.
 */
const today = () => clock.now().toISOString().slice(0, 10);

/**
 * Golden evidence tests — report §14.5:
 *
 *   "For fixed fixtures, retain canonical JSON, expected digest, rendered PDF
 *    text extraction, and page screenshots. A template change requires explicit
 *    golden review so a missing price, version, or decision cannot ship
 *    unnoticed."
 *
 * The fixture is pinned to a fixed clock and fixed inputs so the canonical JSON
 * and its digest are byte-stable. The rendered PDF is checked by extracting its
 * text and asserting that every commercially and legally material fact is
 * present — a missing price or a missing decision fails the build.
 */

let container: Container;
let tenant: TenantFixture;
const clock = new FixedClock(new Date('2026-08-14T06:00:00.000Z'));

beforeAll(() => {
  container = createTestContainer({ clock });
});
afterAll(async () => {
  await container.close();
});
beforeEach(async () => {
  clock.set(new Date('2026-08-14T06:00:00.000Z'));
  await truncateAll(container);
  tenant = await createTenant(container, {
    name: 'Shree Interiors',
    baselineSubtotalMinor: 1_820_000_00,
    baselineTaxMinor: 327_600_00,
  });
});

/** The fixed fixture: an approved two-line addition with a schedule impact. */
async function approvedFixture() {
  const created = await container.services.changeOrders.create(tenant.owner, tenant.projectId, {
    type: 'ADDITION',
    title: 'Additional electrical wiring for kitchen appliances',
    scope:
      'Supply and install two new 16A dedicated circuits from the distribution board to the ' +
      'kitchen counter, including 2.5 sq mm FR copper wiring in concealed conduit.',
    reason: 'Requested by customer after kitchen appliance selection changed.',
    lineItems: [
      {
        description: 'Dedicated 16A circuit',
        quantity: '2.000',
        unit: 'point',
        unitPriceMinor: 6_500_00,
        taxRateBps: 1800,
        direction: 1,
      },
      {
        description: 'Wall chasing and paint touch-up',
        quantity: '1.000',
        unit: 'lot',
        unitPriceMinor: 2_800_00,
        taxRateBps: 1800,
        direction: 1,
      },
    ],
    scheduleDeltaDays: 2,
    approverContactId: tenant.approverContactId,
    assuranceRequired: 'A0',
  });

  const sent = await container.services.send.send(tenant.owner, created.changeOrderId, {
    channel: 'WHATSAPP_NATIVE_SHARE',
  });
  const token = sent.approvalUrl.split('/r/')[1]!;

  const ctx = publicContext();
  const resolved = await container.services.publicApproval.resolve(token, ctx, undefined);
  const receipt = await container.services.decisions.decide(
    {
      plainToken: token,
      publicSessionToken: resolved.session!.token,
      input: {
        type: 'APPROVE',
        signerName: tenant.approverName,
        signedDate: today(),
        signedPlace: 'Bengaluru',
        comment: 'Please go ahead.',
        declarationAccepted: true,
      },
      idempotencyKey: randomUUID(),
      ifMatch: resolved.dto.etag,
    },
    ctx,
  );

  return { created, sent, receipt, versionId: created.version.id };
}

async function viewModel(versionId: string) {
  return buildEvidenceViewModel({
    db: container.uow.db,
    repos: container.repos,
    versionId,
    organizationId: tenant.organizationId,
    requestId: 'golden-test',
    generatorVersion: 'evidence-generator-v1',
    rendererVersion: 'golden-fixed',
    now: clock.now(),
  });
}

describe('canonical snapshot golden', () => {
  it('produces the exact expected canonical structure and a stable digest', async () => {
    const { versionId, sent } = await approvedFixture();
    const version = await container.repos.changeOrders.requireVersion(
      container.uow.db,
      tenant.owner.tenant,
      versionId,
    );

    const snapshot = version.canonicalSnapshot as Record<string, unknown>;

    // Structural golden: the exact top-level shape of a frozen snapshot.
    expect(Object.keys(snapshot).sort()).toEqual([
      'approver',
      'assuranceRequired',
      'attachments',
      'canonicalizerVersion',
      'change',
      'commercial',
      'expiresAt',
      'organization',
      'project',
      'schedule',
      'schemaVersion',
      'scope',
      'sentAt',
      'termsVersion',
    ]);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.canonicalizerVersion).toBe(CANONICALIZER_VERSION);
    expect(snapshot.termsVersion).toBe(TERMS_VERSION);

    // Money is serialised as strings, never JSON numbers.
    const commercial = snapshot.commercial as Record<string, unknown>;
    expect(commercial.subtotalDeltaMinor).toBe('1580000');
    expect(commercial.taxDeltaMinor).toBe('284400');
    expect(commercial.totalDeltaMinor).toBe('1864400');
    expect(commercial.revisedContractTotalMinor).toBe('216624400');

    // The recorded digest is exactly SHA-256 over the canonical serialisation.
    const recomputed = createHash('sha256').update(canonicalize(snapshot), 'utf8').digest('hex');
    expect(version.canonicalSha256?.toString('hex')).toBe(recomputed);
    expect(sent.canonicalSha256).toBe(recomputed);
  });

  it('keeps the manifest digest reproducible from the manifest alone', async () => {
    // The digest a recipient can verify: SHA-256 over the canonical form of the
    // manifest document, with nothing self-referential embedded in it.
    const { versionId } = await approvedFixture();
    const model = await viewModel(versionId);

    const recomputed = createHash('sha256')
      .update(canonicalize(model.manifest as never), 'utf8')
      .digest('hex');
    expect(model.manifestSha256).toBe(recomputed);
    expect(model.render.manifestSha256).toBe(recomputed);

    // A round trip through JSON — which is how a recipient receives it — must
    // still verify.
    const roundTripped = JSON.parse(JSON.stringify(model.manifest)) as unknown;
    expect(verifyManifestDigest(roundTripped, model.manifestSha256)).toBe(true);

    // And any alteration must fail.
    const tampered = JSON.parse(JSON.stringify(model.manifest)) as Record<string, unknown>;
    (tampered.generation as Record<string, unknown>).generatorVersion = 'tampered';
    expect(verifyManifestDigest(tampered, model.manifestSha256)).toBe(false);
  });

  it('verifies the audit chain at generation time', async () => {
    const { versionId } = await approvedFixture();
    const model = await viewModel(versionId);
    expect(model.render.chainVerified).toBe(true);
    expect(model.render.terminalEventHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('blocks evidence when the frozen snapshot digest no longer matches', async () => {
    const { versionId } = await approvedFixture();
    await repairUpdate(
      `UPDATE change_order_versions
       SET canonical_sha256 = decode(repeat('00', 32), 'hex')
       WHERE id = $1`,
      [versionId],
    );

    await expect(viewModel(versionId)).rejects.toMatchObject({
      code: 'PROJECT_INTEGRITY_REVIEW',
      details: { integrity: 'SNAPSHOT_DIGEST_MISMATCH' },
    });
  });

  it('blocks evidence when line items no longer recompute to the frozen total', async () => {
    const { versionId } = await approvedFixture();
    await repairUpdate(
      `UPDATE line_items
       SET unit_price_minor = unit_price_minor + 1
       WHERE version_id = $1`,
      [versionId],
    );

    await expect(viewModel(versionId)).rejects.toMatchObject({
      code: 'PROJECT_INTEGRITY_REVIEW',
      details: { integrity: 'TOTALS_MISMATCH' },
    });
  });

  it('blocks evidence when the append-only audit chain does not verify', async () => {
    const { versionId } = await approvedFixture();
    const version = await container.repos.changeOrders.requireVersion(
      container.uow.db,
      tenant.owner.tenant,
      versionId,
    );
    await repairUpdate(
      `UPDATE audit_events
       SET event_hash = decode(repeat('00', 32), 'hex')
       WHERE organization_id = $1 AND aggregate_type = 'change_order'
         AND aggregate_id = $2 AND sequence = 1`,
      [tenant.organizationId, version.changeOrderId],
    );

    await expect(viewModel(versionId)).rejects.toMatchObject({
      code: 'PROJECT_INTEGRITY_REVIEW',
      details: { integrity: 'AUDIT_CHAIN_MISMATCH' },
    });
  });

  it('blocks evidence when a valid hash chain is bound to the wrong project', async () => {
    const { versionId } = await approvedFixture();
    const version = await container.repos.changeOrders.requireVersion(
      container.uow.db,
      tenant.owner.tenant,
      versionId,
    );
    // project_id is routing metadata and is intentionally not part of the
    // event hash. This keeps the cryptographic chain valid while exercising
    // the separate semantic binding gate.
    await repairUpdate(
      `UPDATE audit_events SET project_id = NULL
       WHERE organization_id = $1 AND aggregate_type = 'change_order'
         AND aggregate_id = $2 AND sequence = 1`,
      [tenant.organizationId, version.changeOrderId],
    );

    await expect(viewModel(versionId)).rejects.toMatchObject({
      code: 'PROJECT_INTEGRITY_REVIEW',
      details: { integrity: 'AUDIT_CHAIN_MISMATCH' },
    });
  });
});

describe('rendered evidence golden', () => {
  it('renders a PDF whose text contains every material fact', async () => {
    const { versionId, receipt } = await approvedFixture();
    const model = await viewModel(versionId);
    const html = renderEvidenceHtml(model);

    const renderer = new ChromiumPdfRenderer(container.logger, 60_000);
    let pdf: Buffer;
    try {
      pdf = await renderer.render(html);
    } finally {
      await renderer.close();
    }

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(10_000);

    const text = await extractPdfText(pdf);

    // --- Report §4.4: every PDF shows these ------------------------------
    expect(text).toContain('Shree Interiors'); // business name
    expect(text).toContain(tenant.projectNumber); // project number
    expect(text).toContain(model.render.changeNumber); // change number
    expect(text).toContain('version 1'); // version
    expect(text).toContain('APPROVED'); // state
    expect(text).toContain(ASSURANCE_COPY.A0.label); // assurance level
    expect(text).toContain('Generated'); // generation timestamp

    // --- Prices must never silently disappear -----------------------------
    expect(text).toContain('6,500.00'); // unit rate
    expect(text).toContain('2,800.00'); // unit rate
    expect(text).toContain('15,800.00'); // subtotal
    expect(text).toContain('2,844.00'); // tax
    expect(text).toContain('18,644.00'); // total of this change
    expect(text).toContain('21,47,600.00'); // baseline, in lakh grouping
    expect(text).toContain('21,66,244.00'); // revised contract total

    // --- Schedule ---------------------------------------------------------
    expect(text).toContain('+2 days');

    // --- Decision ---------------------------------------------------------
    expect(text).toContain('APPROVE');
    // The name the approver typed, which must be their recorded name — the
    // decision is refused otherwise (SIGNER_NAME_MISMATCH).
    expect(text).toContain(tenant.approverName);
    expect(text).toContain(receipt.receiptId);

    // --- Honest assurance language (report §3.3, §12.4) -------------------
    expect(text).toContain('not a licensed or government-recognised electronic');
    expect(normalise(text)).toContain(normalise(EVIDENCE_DISCLAIMER.slice(0, 80)));

    // --- Integrity metadata -----------------------------------------------
    expect(text).toContain('evidence-pdf-v1');
    expect(text).toContain(CANONICALIZER_VERSION);
    expect(text).toContain(TERMS_VERSION);
    // The content digest appears in full (the template soft-wraps it).
    // The template soft-wraps long digests with a zero-width space so they
    // cannot overflow the page box; strip it before comparing.
    // eslint-disable-next-line no-irregular-whitespace
    expect(text.replace(/[\s​]/g, '')).toContain(model.render.canonicalSha256);
  }, 180_000);

  it('never claims a certified signature for an A0 decision', async () => {
    const { versionId } = await approvedFixture();
    const model = await viewModel(versionId);
    const html = renderEvidenceHtml(model);

    // A0 must not be dressed up as something stronger anywhere in the pack.
    expect(html).not.toMatch(/digital signature certificate/i);
    expect(html).not.toMatch(/legally binding/i);
    expect(html).not.toMatch(/court[- ]proof/i);
    expect(html).not.toMatch(/certified electronic signature/i);
    expect(html).toContain(ASSURANCE_COPY.A0.limitation);
  });

  it('renders a genuine combined project PDF with its cover, index and full record', async () => {
    const { versionId } = await approvedFixture();
    const model = await viewModel(versionId);
    const html = renderProjectEvidencePackHtml({
      organizationName: model.render.organizationName,
      organizationLegalName: model.render.organizationLegalName,
      projectNumber: model.render.projectNumber,
      projectTitle: model.render.projectTitle,
      generatedAt: model.render.generatedAt,
      templateVersion: 'evidence-pack-v1',
      manifestSha256: model.manifestSha256,
      records: [model],
    });

    const renderer = new ChromiumPdfRenderer(container.logger, 60_000);
    let pdf: Buffer;
    try {
      pdf = await renderer.render(html);
    } finally {
      await renderer.close();
    }

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = await extractPdfText(pdf);
    expect(text).toContain('Complete project evidence pack');
    expect(text).toContain('Contents');
    expect(text).toContain(model.render.changeNumber);
    expect(text).toContain(model.render.title);
    // eslint-disable-next-line no-irregular-whitespace
    const compactText = text.replace(/[\s​]/g, '');
    expect(compactText).toContain(model.render.canonicalSha256);
    expect(compactText).toContain(model.render.manifestSha256);
  }, 180_000);

  it('marks the pack when the chain does not verify', async () => {
    const { versionId } = await approvedFixture();
    const model = await viewModel(versionId);
    const html = renderEvidenceHtml({
      ...model,
      render: { ...model.render, chainVerified: false },
    });
    expect(html).toContain('Integrity warning');
    expect(html).toContain('FAILED verification');
  });

  it('renders a pending pack for a sent-but-undecided version honestly', async () => {
    const created = await container.services.changeOrders.create(tenant.owner, tenant.projectId, {
      type: 'TIME_ONLY',
      title: 'Programme extension only',
      scope: 'Extend the programme by five working days with no change to the contract price.',
      lineItems: [],
      scheduleDeltaDays: 5,
      approverContactId: tenant.approverContactId,
      assuranceRequired: 'A0',
    });
    await container.services.send.send(tenant.owner, created.changeOrderId, {
      channel: 'WHATSAPP_NATIVE_SHARE',
    });

    const model = await viewModel(created.version.id);
    const html = renderEvidenceHtml(model);

    expect(html).toContain('No decision has been recorded');
    expect(html).toContain('documents what was sent, not an outcome');
    // A zero-price change says so rather than showing an empty table.
    expect(html).toContain('No priced line items');
  });
});

/** Extracts text from every page, for the golden assertions above. */
async function extractPdfText(pdf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
  let text = '';
  for (let page = 1; page <= doc.numPages; page += 1) {
    const content = await (await doc.getPage(page)).getTextContent();
    text += `${content.items.map((item) => ('str' in item ? item.str : '')).join(' ')}\n`;
  }
  await doc.destroy();
  // PDF text extraction splits ligatures ("fi t-out"), so collapse whitespace.
  return text;
}

function normalise(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Test-only forensic corruption by explicitly disabling user triggers as the
 * disposable test database superuser. Production application roles cannot do
 * this, and there is deliberately no repair-mode setting anymore.
 */
async function repairUpdate(query: string, values: unknown[]): Promise<void> {
  const client = await container.uow.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query(query, values);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
