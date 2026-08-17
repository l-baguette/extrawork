import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OUTBOX_TOPICS } from '@extrawork/contracts';
import { systemTenantContext, verifyChain, verifySnapshotDigest } from '@extrawork/domain';
import { readChain } from '@extrawork/db';
import type { Container } from '@extrawork/runtime';
import {
  createDraftChangeOrder,
  createSentChangeOrder,
  createTenant,
  createTestContainer,
  publicContext,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * Version rules, freezing, atomic commits and projections — report §4.4, §8.3,
 * §13.2 and §13.3.
 */

let container: Container;
let tenant: TenantFixture;

beforeAll(() => {
  container = createTestContainer();
});
afterAll(async () => {
  await container.close();
});
beforeEach(async () => {
  await truncateAll(container);
  tenant = await createTenant(container);
});

async function decide(token: string, type: 'APPROVE' | 'DECLINE' | 'REQUEST_REVISION') {
  const ctx = publicContext();
  const resolved = await container.services.publicApproval.resolve(token, ctx, undefined);
  if (!resolved.session) throw new Error('no public session');
  return container.services.decisions.decide(
    {
      plainToken: token,
      publicSessionToken: resolved.session.token,
      input: {
        type,
        signerName: tenant.approverName,
        ...(type === 'REQUEST_REVISION' ? { comment: 'Please split the waterproofing line.' } : {}),
        declarationAccepted: true,
      },
      idempotencyKey: randomUUID(),
      ifMatch: resolved.dto.etag,
    },
    ctx,
  );
}

describe('draft editing and freezing', () => {
  it('keeps a draft at version 1 across repeated edits', async () => {
    // Report §4.4: "Draft edits may update the same draft version until first send."
    const created = await createDraftChangeOrder(container, tenant);
    let lockVersion = created.version.lockVersion;

    for (let i = 0; i < 3; i += 1) {
      const updated = await container.services.changeOrders.updateDraft(
        tenant.owner,
        created.changeOrderId,
        lockVersion,
        {
          type: 'ADDITION',
          title: `Edit ${i}`,
          scope: 'A scope description long enough to satisfy validation on every edit.',
          lineItems: [],
          scheduleDeltaDays: i + 1,
          approverContactId: tenant.approverContactId,
          assuranceRequired: 'A0',
        },
      );
      lockVersion = updated.lockVersion;
      expect(updated.versionNumber).toBe(1);
    }

    const versions = await container.repos.changeOrders.listVersions(
      tenant.owner.tenant,
      created.changeOrderId,
    );
    expect(versions).toHaveLength(1);
  });

  it('has no canonical snapshot while a draft, and one after send', async () => {
    // Mirrors the database CHECK from report §9.3.
    const created = await createDraftChangeOrder(container, tenant);
    expect(created.version.canonicalSnapshot).toBeNull();
    expect(created.version.canonicalSha256).toBeNull();

    await container.services.send.send(tenant.owner, created.changeOrderId, {
      channel: 'WHATSAPP_NATIVE_SHARE',
    });

    const sent = await container.repos.changeOrders.getCurrentVersion(
      tenant.owner.tenant,
      created.changeOrderId,
    );
    expect(sent?.canonicalSnapshot).not.toBeNull();
    expect(sent?.canonicalSha256).not.toBeNull();
    expect(sent?.canonicalizerVersion).toBe('jcs-rfc8785-v1');
    expect(sent?.termsVersion).toBe('approval-terms-in-v1');
  });

  it('freezes a snapshot whose digest verifies', async () => {
    const { changeOrder } = await createSentChangeOrder(container, tenant);
    const version = await container.repos.changeOrders.requireVersion(
      container.uow.db,
      tenant.owner.tenant,
      changeOrder.version.id,
    );
    expect(verifySnapshotDigest(version.canonicalSnapshot, version.canonicalSha256!)).toBe(true);
  });

  it('refuses to edit a version once sent', async () => {
    const { changeOrder } = await createSentChangeOrder(container, tenant);
    await expect(
      container.services.changeOrders.updateDraft(
        tenant.owner,
        changeOrder.changeOrderId,
        changeOrder.version.lockVersion,
        {
          type: 'ADDITION',
          title: 'Sneaky edit',
          scope: 'An attempt to change what the customer was already shown after sending.',
          lineItems: [],
          scheduleDeltaDays: 1,
          approverContactId: tenant.approverContactId,
          assuranceRequired: 'A0',
        },
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }));
  });
});

describe('revisions', () => {
  it('creates v2, supersedes v1 and revokes its token', async () => {
    // Report §4.4: "Any change after send creates version n + 1, marks the
    // prior version SUPERSEDED, and revokes its token."
    const { changeOrder, token } = await createSentChangeOrder(container, tenant);

    await container.services.changeOrders.createRevision(tenant.owner, changeOrder.changeOrderId);

    const versions = await container.repos.changeOrders.listVersions(
      tenant.owner.tenant,
      changeOrder.changeOrderId,
    );
    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.versionNumber === 1)?.status).toBe('SUPERSEDED');
    expect(versions.find((v) => v.versionNumber === 2)?.status).toBe('DRAFT');

    const oldToken = await container.repos.approvals.findByToken(token);
    expect(oldToken?.revokedAt).not.toBeNull();
    expect(oldToken?.revokedReason).toBe('SUPERSEDED');
  });

  it('preserves the superseded version’s frozen snapshot untouched', async () => {
    const { changeOrder } = await createSentChangeOrder(container, tenant);
    const before = await container.repos.changeOrders.requireVersion(
      container.uow.db,
      tenant.owner.tenant,
      changeOrder.version.id,
    );

    await container.services.changeOrders.createRevision(tenant.owner, changeOrder.changeOrderId);

    const after = await container.repos.changeOrders.requireVersion(
      container.uow.db,
      tenant.owner.tenant,
      changeOrder.version.id,
    );
    expect(after.canonicalSha256?.toString('hex')).toBe(before.canonicalSha256?.toString('hex'));
    expect(JSON.stringify(after.canonicalSnapshot)).toBe(JSON.stringify(before.canonicalSnapshot));
  });

  it('refuses a revision of an approved version', async () => {
    // Report §4.3: an approved change is corrected by a new linked change.
    const { changeOrder, token } = await createSentChangeOrder(container, tenant);
    await decide(token, 'APPROVE');
    await expect(
      container.services.changeOrders.createRevision(tenant.owner, changeOrder.changeOrderId),
    ).rejects.toThrowError(expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }));
  });

  it('allows a revision after the customer asks for one', async () => {
    const { changeOrder, token } = await createSentChangeOrder(container, tenant);
    await decide(token, 'REQUEST_REVISION');
    const v2 = await container.services.changeOrders.createRevision(
      tenant.owner,
      changeOrder.changeOrderId,
    );
    expect(v2.versionNumber).toBe(2);
    expect(v2.status).toBe('DRAFT');
  });
});

describe('numbering', () => {
  it('numbers change orders per project and tolerates gaps', async () => {
    // Report §8.2: numbers are identifiers, not accounting sequences.
    const first = await createDraftChangeOrder(container, tenant, { title: 'One' });
    const second = await createDraftChangeOrder(container, tenant, { title: 'Two' });
    expect(first.number).toBe('EW-001');
    expect(second.number).toBe('EW-002');

    const otherProject = await createTenant(container);
    const elsewhere = await createDraftChangeOrder(container, otherProject, { title: 'Other' });
    // A different project restarts its own sequence.
    expect(elsewhere.number).toBe('EW-001');
  });

  it('never reuses a number after a cancellation', async () => {
    const first = await createDraftChangeOrder(container, tenant);
    await container.services.changeOrders.cancel(tenant.owner, first.changeOrderId, 'Not needed');
    const second = await createDraftChangeOrder(container, tenant);
    expect(second.number).not.toBe(first.number);
    expect(second.number).toBe('EW-002');
  });
});

describe('atomic commit of domain, audit and outbox', () => {
  it('writes the decision, its audit events and the outbox event together', async () => {
    // Report §7.5: audit and outbox records are written in the same transaction
    // as the domain change.
    const { token, changeOrder } = await createSentChangeOrder(container, tenant);
    const receipt = await decide(token, 'APPROVE');

    const decisions = await container.uow.pool.query('SELECT id FROM decisions');
    expect(decisions.rows).toHaveLength(1);

    const outbox = await container.uow.pool.query<{
      topic: string;
      payload: Record<string, unknown>;
    }>('SELECT topic, payload FROM outbox_events WHERE topic = $1', [
      OUTBOX_TOPICS.APPROVAL_DECIDED,
    ]);
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]?.payload.decisionId).toBe(receipt.decisionId);

    const events = await readChain(
      container.uow.db,
      systemTenantContext(tenant.organizationId, 'test'),
      'change_order',
      changeOrder.changeOrderId,
    );
    expect(events.map((e) => e.eventType)).toContain('approval.decided.v1');
    expect(verifyChain(events).valid).toBe(true);
  });

  it('leaves no outbox event behind when the domain transaction fails', async () => {
    const { token } = await createSentChangeOrder(container, tenant);
    await decide(token, 'APPROVE');
    const before = await container.uow.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM outbox_events',
    );

    // A second decision fails on the terminal-state guard; nothing new should
    // be published.
    await expect(decide(token, 'DECLINE')).rejects.toThrow();

    const after = await container.uow.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM outbox_events',
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it('enqueues evidence generation inside the decision transaction', async () => {
    const { token } = await createSentChangeOrder(container, tenant);
    await decide(token, 'APPROVE');

    const jobs = await container.uow.pool.query<{ kind: string; organization_id: string }>(
      'SELECT kind, organization_id FROM job_queue ORDER BY kind',
    );
    const kinds = jobs.rows.map((r) => r.kind);
    expect(kinds).toContain('generate_evidence');
    expect(kinds).toContain('send_decision_receipt');
    // Every job carries its tenant, which the handlers rely on.
    for (const row of jobs.rows) expect(row.organization_id).toBe(tenant.organizationId);

    const documents = await container.uow.pool.query<{ status: string }>(
      "SELECT status FROM generated_documents WHERE kind = 'EVIDENCE_PDF'",
    );
    expect(documents.rows).toHaveLength(1);
    expect(documents.rows[0]?.status).toBe('PENDING');
  });
});

describe('project projection', () => {
  it('moves the approved delta only on approval', async () => {
    const approved = await createSentChangeOrder(container, tenant, { unitPriceMinor: 10_000_00 });
    const declined = await createSentChangeOrder(container, tenant, { unitPriceMinor: 30_000_00 });

    await decide(approved.token, 'APPROVE');
    await decide(declined.token, 'DECLINE');

    const project = await container.repos.projects.requireById(
      tenant.owner.tenant,
      tenant.projectId,
    );
    const approvedVersion = await container.repos.changeOrders.requireVersion(
      container.uow.db,
      tenant.owner.tenant,
      approved.changeOrder.version.id,
    );
    expect(project.approvedDeltaMinor).toBe(approvedVersion.totalDeltaMinor);
    expect(project.revisedTotalMinor).toBe(
      project.baselineTotalMinor + approvedVersion.totalDeltaMinor,
    );
  });

  it('agrees with a recomputation from approved versions', async () => {
    // Report §13.3's integrity query must find nothing after normal operation.
    for (const price of [5_000_00, 12_500_00, 7_250_00]) {
      const sent = await createSentChangeOrder(container, tenant, { unitPriceMinor: price });
      await decide(sent.token, 'APPROVE');
    }
    const mismatches = await container.repos.projects.findIntegrityMismatches();
    expect(mismatches).toHaveLength(0);
  });

  it('detects a tampered projection and flags the project for review', async () => {
    const sent = await createSentChangeOrder(container, tenant);
    await decide(sent.token, 'APPROVE');

    // Simulate corruption that the nightly job must catch. Both columns move
    // together so the row-level CHECK (revised = baseline + approved) still
    // holds — the corruption being detected is the divergence between the
    // projection and a recomputation from approved versions (report §13.3),
    // which no single-row constraint can catch.
    await container.uow.pool.query(
      `UPDATE projects
          SET approved_delta_minor = approved_delta_minor + 12345,
              revised_total_minor = revised_total_minor + 12345
        WHERE id = $1`,
      [tenant.projectId],
    );

    const mismatches = await container.repos.projects.findIntegrityMismatches();
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.projectId).toBe(tenant.projectId);

    // The controlled repair command restores it and the mismatch clears.
    await container.uow.transaction((tx) =>
      container.repos.projects.rebuildProjection(tx, tenant.projectId),
    );
    expect(await container.repos.projects.findIntegrityMismatches()).toHaveLength(0);
  });
});

describe('baseline rules', () => {
  it('locks the baseline once a change has been sent', async () => {
    // Report §4.1 and §4.6.
    await createSentChangeOrder(container, tenant);
    await expect(
      container.services.projects.updateBaselineBeforeFirstSend(tenant.owner, tenant.projectId, {
        subtotalMinor: 1,
        taxMinor: 0,
        totalMinor: 1,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'BASELINE_LOCKED' }));
  });

  it('records an explicit, audited baseline amendment instead', async () => {
    await createSentChangeOrder(container, tenant);
    await container.services.projects.amendBaseline(tenant.owner, tenant.projectId, {
      baseline: { subtotalMinor: 200_000_00, taxMinor: 36_000_00, totalMinor: 236_000_00 },
      reason: 'Original quotation revised after the client signed the amended BOQ.',
    });

    const project = await container.repos.projects.requireById(
      tenant.owner.tenant,
      tenant.projectId,
    );
    expect(project.baselineTotalMinor).toBe(23_600_000n);

    const events = await readChain(
      container.uow.db,
      systemTenantContext(tenant.organizationId, 'test'),
      'project',
      tenant.projectId,
    );
    expect(events.map((e) => e.eventType)).toContain('project.baseline_amended.v1');
    expect(verifyChain(events).valid).toBe(true);
  });
});
