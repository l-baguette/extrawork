import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@extrawork/contracts';
import type { Container } from '@extrawork/runtime';
import {
  createSentChangeOrder,
  createTestContainer,
  publicContext,
  truncateAll,
  createTenant,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * Concurrency and idempotency on real PostgreSQL — report §16.3 launch blocker
 * #2: "Approval races and idempotency are proven against real PostgreSQL."
 *
 * Report §4.6: "If two decisions race, the first committed terminal decision
 * wins; the second receives 409 ALREADY_DECIDED and the recorded state."
 * Report §7.8: "A unique partial index allows at most one terminal decision per
 * version."
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

/** Resolves a link and returns everything a decision POST needs. */
async function openLink(token: string) {
  const ctx = publicContext();
  const resolved = await container.services.publicApproval.resolve(token, ctx, undefined);
  if (!resolved.session) throw new Error('expected a public session on first view');
  return { ctx, session: resolved.session, dto: resolved.dto };
}

describe('simultaneous decisions', () => {
  it('records exactly one decision when two approvals race', async () => {
    const { token } = await createSentChangeOrder(container, tenant);
    const a = await openLink(token);
    const b = await openLink(token);

    const results = await Promise.allSettled([
      container.services.decisions.decide(
        {
          plainToken: token,
          publicSessionToken: a.session.token,
          input: { type: 'APPROVE', signerName: tenant.approverName, declarationAccepted: true },
          idempotencyKey: randomUUID(),
          ifMatch: a.dto.etag,
        },
        a.ctx,
      ),
      container.services.decisions.decide(
        {
          plainToken: token,
          publicSessionToken: b.session.token,
          input: { type: 'DECLINE', signerName: tenant.approverName, declarationAccepted: true },
          idempotencyKey: randomUUID(),
          ifMatch: b.dto.etag,
        },
        b.ctx,
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const error = (rejected[0] as PromiseRejectedResult).reason as AppError;
    expect(AppError.is(error)).toBe(true);
    expect(error.code).toBe('ALREADY_DECIDED');

    const { rows } = await container.uow.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM decisions',
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('holds under a burst of eight concurrent decisions', async () => {
    const { token } = await createSentChangeOrder(container, tenant);
    const opened = await Promise.all(Array.from({ length: 8 }, () => openLink(token)));

    const results = await Promise.allSettled(
      opened.map((session, index) =>
        container.services.decisions.decide(
          {
            plainToken: token,
            publicSessionToken: session.session.token,
            input: {
              type: index % 2 === 0 ? 'APPROVE' : 'DECLINE',
              signerName: tenant.approverName,
              declarationAccepted: true,
            },
            idempotencyKey: randomUUID(),
            ifMatch: session.dto.etag,
          },
          session.ctx,
        ),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const { rows } = await container.uow.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM decisions',
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('is enforced by a database constraint, not only application code', async () => {
    // Report §7.8. Bypassing the service must still be impossible.
    const { token, changeOrder } = await createSentChangeOrder(container, tenant);
    const opened = await openLink(token);
    await container.services.decisions.decide(
      {
        plainToken: token,
        publicSessionToken: opened.session.token,
        input: { type: 'APPROVE', signerName: tenant.approverName, declarationAccepted: true },
        idempotencyKey: randomUUID(),
        ifMatch: opened.dto.etag,
      },
      opened.ctx,
    );

    await expect(
      container.uow.pool.query(
        `INSERT INTO decisions
           (id, organization_id, project_id, version_id, type, signer_name,
            assurance_achieved, declaration_text, terms_version, occurred_at,
            receipt_display_id)
         VALUES (gen_random_uuid(), $1, $2, $3, 'DECLINE', 'Direct Insert',
                 'A0', 'bypass attempt', 'approval-terms-in-v1', now(),
                 'EW-R-XXXXXX')`,
        [tenant.organizationId, tenant.projectId, changeOrder.version.id],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});

describe('idempotency', () => {
  it('replays the same response for a repeated key and payload', async () => {
    // Report §7.6 and §14.5: "Repeating idempotent command produces one
    // decision and same response."
    const { token } = await createSentChangeOrder(container, tenant);
    const opened = await openLink(token);
    const key = randomUUID();
    const command = {
      plainToken: token,
      publicSessionToken: opened.session.token,
      input: {
        type: 'APPROVE' as const,
        signerName: tenant.approverName,
        declarationAccepted: true,
      },
      idempotencyKey: key,
      ifMatch: opened.dto.etag,
    };

    const first = await container.services.decisions.decide(command, opened.ctx);
    const second = await container.services.decisions.decide(command, opened.ctx);

    expect(second.decisionId).toBe(first.decisionId);
    expect(second.receiptId).toBe(first.receiptId);
    expect(second.occurredAt).toBe(first.occurredAt);

    const { rows } = await container.uow.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM decisions',
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('rejects the same key with a different payload', async () => {
    const { token } = await createSentChangeOrder(container, tenant);
    const opened = await openLink(token);
    const key = randomUUID();

    await container.services.decisions.decide(
      {
        plainToken: token,
        publicSessionToken: opened.session.token,
        input: { type: 'APPROVE', signerName: tenant.approverName, declarationAccepted: true },
        idempotencyKey: key,
        ifMatch: opened.dto.etag,
      },
      opened.ctx,
    );

    await expect(
      container.services.decisions.decide(
        {
          plainToken: token,
          publicSessionToken: opened.session.token,
          input: { type: 'DECLINE', signerName: tenant.approverName, declarationAccepted: true },
          idempotencyKey: key,
          ifMatch: opened.dto.etag,
        },
        opened.ctx,
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }));
  });

  it('does not double-count the project total on a replay', async () => {
    const { token } = await createSentChangeOrder(container, tenant, { unitPriceMinor: 50_000_00 });
    const opened = await openLink(token);
    const command = {
      plainToken: token,
      publicSessionToken: opened.session.token,
      input: {
        type: 'APPROVE' as const,
        signerName: tenant.approverName,
        declarationAccepted: true,
      },
      idempotencyKey: randomUUID(),
      ifMatch: opened.dto.etag,
    };

    await container.services.decisions.decide(command, opened.ctx);
    await container.services.decisions.decide(command, opened.ctx);

    const project = await container.repos.projects.requireById(
      tenant.owner.tenant,
      tenant.projectId,
    );
    const recomputed = await container.uow.pool.query<{ sum: string }>(
      `SELECT COALESCE(SUM(total_delta_minor), 0)::text AS sum
         FROM change_order_versions WHERE project_id = $1 AND status = 'APPROVED'`,
      [tenant.projectId],
    );
    expect(project.approvedDeltaMinor.toString()).toBe(recomputed.rows[0]?.sum);
  });
});

describe('stale and superseded links', () => {
  it('returns VERSION_SUPERSEDED when the contractor revises while the page is open', async () => {
    // Report §4.6: "If the contractor supersedes while the customer page is
    // open, the decision receives 409 VERSION_SUPERSEDED."
    const { token, changeOrder } = await createSentChangeOrder(container, tenant);
    const opened = await openLink(token);

    await container.services.changeOrders.createRevision(tenant.owner, changeOrder.changeOrderId);

    await expect(
      container.services.decisions.decide(
        {
          plainToken: token,
          publicSessionToken: opened.session.token,
          input: { type: 'APPROVE', signerName: tenant.approverName, declarationAccepted: true },
          idempotencyKey: randomUUID(),
          ifMatch: opened.dto.etag,
        },
        opened.ctx,
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: 'VERSION_SUPERSEDED' }));
  });

  it('rejects a decision whose ETag no longer matches the frozen content', async () => {
    const { token } = await createSentChangeOrder(container, tenant);
    const opened = await openLink(token);

    await expect(
      container.services.decisions.decide(
        {
          plainToken: token,
          publicSessionToken: opened.session.token,
          input: { type: 'APPROVE', signerName: tenant.approverName, declarationAccepted: true },
          idempotencyKey: randomUUID(),
          ifMatch: '"0000000000000000000000000000000000000000"',
        },
        opened.ctx,
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: 'ETAG_MISMATCH' }));
  });

  it('keeps the ETag stable across the first view, which itself changes status', () => {
    // Regression guard: the SENT -> VIEWED transition writes to the version
    // row. If the ETag were derived from lock_version, the tag handed to the
    // customer during their own page load would already be stale and every
    // first-time approval would fail with 412.
    return (async () => {
      const { token } = await createSentChangeOrder(container, tenant);
      const first = await openLink(token);
      const second = await openLink(token);
      expect(second.dto.etag).toBe(first.dto.etag);

      await expect(
        container.services.decisions.decide(
          {
            plainToken: token,
            publicSessionToken: second.session.token,
            input: { type: 'APPROVE', signerName: tenant.approverName, declarationAccepted: true },
            idempotencyKey: randomUUID(),
            ifMatch: first.dto.etag,
          },
          second.ctx,
        ),
      ).resolves.toMatchObject({ type: 'APPROVE' });
    })();
  });
});

describe('draft optimistic locking', () => {
  it('rejects a second concurrent draft update with LOCK_CONFLICT', async () => {
    const created = await container.services.changeOrders.create(tenant.owner, tenant.projectId, {
      type: 'ADDITION',
      title: 'Draft under contention',
      scope: 'A scope description long enough to satisfy the composer validation rules.',
      lineItems: [
        {
          description: 'Item',
          quantity: '1.000',
          unitPriceMinor: 100_000,
          taxRateBps: 1800,
          direction: 1,
        },
      ],
      scheduleDeltaDays: 1,
      approverContactId: tenant.approverContactId,
      assuranceRequired: 'A0',
    });

    const payload = {
      type: 'ADDITION' as const,
      title: 'Updated',
      scope: 'An updated scope description that is also long enough to be valid.',
      lineItems: [],
      scheduleDeltaDays: 3,
      approverContactId: tenant.approverContactId,
      assuranceRequired: 'A0' as const,
    };

    const lockVersion = created.version.lockVersion;
    await container.services.changeOrders.updateDraft(
      tenant.owner,
      created.changeOrderId,
      lockVersion,
      payload,
    );

    // The same expected lock version is now stale.
    await expect(
      container.services.changeOrders.updateDraft(
        tenant.owner,
        created.changeOrderId,
        lockVersion,
        payload,
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: 'LOCK_CONFLICT' }));
  });
});

/**
 * The typed name is the signature (report §3.3).
 *
 * A0 records that "the holder of a private link typed the name shown below and
 * confirmed the statement". Accepting a different name would make that sentence
 * false on the record, so the decision is refused before anything is written.
 */
describe('signer name must be the approver', () => {
  it('refuses a decision signed with somebody else’s name', async () => {
    const { token } = await createSentChangeOrder(container, tenant);
    const opened = await openLink(token);

    await expect(
      container.services.decisions.decide(
        {
          plainToken: token,
          publicSessionToken: opened.session.token,
          input: { type: 'APPROVE', signerName: 'Someone Else', declarationAccepted: true },
          idempotencyKey: randomUUID(),
          ifMatch: opened.dto.etag,
        },
        opened.ctx,
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: 'SIGNER_NAME_MISMATCH' }));
  });

  it('records nothing at all when the name is refused', async () => {
    const { token, changeOrder } = await createSentChangeOrder(container, tenant);
    const opened = await openLink(token);

    await container.services.decisions
      .decide(
        {
          plainToken: token,
          publicSessionToken: opened.session.token,
          input: { type: 'APPROVE', signerName: 'Someone Else', declarationAccepted: true },
          idempotencyKey: randomUUID(),
          ifMatch: opened.dto.etag,
        },
        opened.ctx,
      )
      .catch(() => undefined);

    const { rows } = await container.uow.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM decisions WHERE organization_id = $1',
      [tenant.organizationId],
    );
    expect(rows[0]?.count).toBe('0');

    // And the request is still awaiting a decision, not stuck in a half state.
    const version = await container.repos.changeOrders.getCurrentVersion(
      tenant.owner.tenant,
      changeOrder.changeOrderId,
    );
    expect(version?.status).toBe('VIEWED');
  });

  it('accepts the approver’s name written casually', async () => {
    const { token } = await createSentChangeOrder(container, tenant);
    const opened = await openLink(token);

    const receipt = await container.services.decisions.decide(
      {
        plainToken: token,
        publicSessionToken: opened.session.token,
        input: {
          type: 'APPROVE',
          // Lowercased, extra spacing, an honorific and a trailing full stop.
          signerName: `  mrs ${tenant.approverName.toLowerCase()} . `,
          declarationAccepted: true,
        },
        idempotencyKey: randomUUID(),
        ifMatch: opened.dto.etag,
      },
      opened.ctx,
    );
    expect(receipt.receiptId).toBeTruthy();
  });
});
