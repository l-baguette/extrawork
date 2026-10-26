import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError, JOB_KINDS } from '@extrawork/contracts';
import { claimJobs, completeJob } from '@extrawork/db';
import { redact, redactString } from '@extrawork/observability';
import { validateBytes } from '@extrawork/files';
import {
  verifyMetaSignature,
  verifyRazorpaySignature,
  type MessageGateway,
} from '@extrawork/integrations';
import type { Container } from '@extrawork/runtime';
import {
  createSentChangeOrder,
  createDraftChangeOrder,
  createTenant,
  createTestContainer,
  publicContext,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';
import { workerContext } from '../../apps/worker/src/context.js';
import { sendRequestMessage } from '../../apps/worker/src/jobs/messaging.js';
import type { PdfRenderer } from '../../apps/worker/src/pdf/renderer.js';

/** The suite asserts against the same day the server will see. */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Security tests — report §14.5 "Security tests" and §16.3 launch blockers:
 * token enumeration and leakage, malicious files and polyglots, webhook
 * signature forgery and replay.
 */

let container: Container;
let tenant: TenantFixture;

const pdfStub: PdfRenderer = {
  render: () => Promise.reject(new Error('message delivery must not render a PDF')),
  rendererVersion: () => Promise.resolve('test-renderer'),
  close: () => Promise.resolve(),
};

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

describe('approval token handling', () => {
  it('stores only a hash — the plaintext is nowhere in the database', async () => {
    const draft = await createDraftChangeOrder(container, tenant);
    const sent = await container.services.send.send(tenant.owner, draft.changeOrderId, {
      channel: 'EMAIL',
    });
    const token = sent.approvalUrl.split('/r/')[1]!;

    // Sweep every text and jsonb column in the schema for the token.
    const { rows: columns } = await container.uow.pool.query<{
      table_name: string;
      column_name: string;
    }>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type IN ('text', 'character varying', 'jsonb', 'json')
    `);

    for (const column of columns) {
      const { rows } = await container.uow.pool.query<{ hits: string }>(
        `SELECT count(*)::text AS hits FROM "${column.table_name}"
          WHERE "${column.column_name}"::text LIKE $1`,
        [`%${token}%`],
      );
      expect(
        Number(rows[0]?.hits ?? 0),
        `${column.table_name}.${column.column_name} contains the plaintext approval token`,
      ).toBe(0);
    }

    const queued = await container.uow.pool.query<{
      id: string;
      payload: Record<string, unknown>;
    }>(`SELECT id, payload FROM job_queue WHERE kind = 'send_request_message'`);
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0]?.payload).not.toHaveProperty('approvalUrl');
    expect(queued.rows[0]?.payload.approvalUrlCiphertext).toEqual(expect.any(String));
    expect(JSON.stringify(queued.rows[0]?.payload)).not.toContain(token);

    const [claimed] = await claimJobs(container.uow.db, {
      limit: 1,
      leaseSeconds: 60,
      workerId: 'security-scrub-test',
      kinds: [JOB_KINDS.SEND_REQUEST_MESSAGE],
    });
    expect(claimed?.id).toBe(queued.rows[0]!.id);
    await expect(
      completeJob(container.uow.db, queued.rows[0]!.id, 'security-scrub-test'),
    ).resolves.toBe(true);
    const completed = await container.uow.pool.query<{ payload: Record<string, unknown> }>(
      'SELECT payload FROM job_queue WHERE id = $1',
      [queued.rows[0]!.id],
    );
    expect(completed.rows[0]?.payload).not.toHaveProperty('approvalUrlCiphertext');
  });

  it('decrypts the queued link only inside the worker delivery boundary', async () => {
    const draft = await createDraftChangeOrder(container, tenant);
    const sent = await container.services.send.send(tenant.owner, draft.changeOrderId, {
      channel: 'EMAIL',
    });
    const jobs = await claimJobs(container.uow.db, {
      limit: 1,
      leaseSeconds: 60,
      workerId: 'security-test',
      kinds: [JOB_KINDS.SEND_REQUEST_MESSAGE],
    });
    const job = jobs[0];
    if (!job) throw new Error('send did not enqueue a request-message job');

    let deliveredBody = '';
    const gateway: MessageGateway = {
      channel: 'EMAIL',
      canDeliver: true,
      send: (command) => {
        deliveredBody = command.body;
        return Promise.resolve({
          provider: 'security-test',
          providerMessageId: 'provider-message-1',
          status: 'SENT',
        });
      },
      verifyAndParse: () => [],
    };
    const originalGateway = container.appContext.integrations.email;
    container.appContext.integrations.email = gateway;
    try {
      await sendRequestMessage(job, workerContext(container, pdfStub));
    } finally {
      container.appContext.integrations.email = originalGateway;
    }

    expect(deliveredBody).toContain(sent.approvalUrl);
    expect(deliveredBody).not.toContain(String(job.payload.approvalUrlCiphertext));
  });

  it('rejects a malformed token without touching the database', async () => {
    for (const candidate of [
      'short',
      "' OR 1=1--",
      '../../etc/passwd',
      `${'a'.repeat(43)}!`,
      'a'.repeat(500),
    ]) {
      await expect(
        container.services.publicApproval.resolve(candidate, publicContext(), undefined),
      ).rejects.toThrowError(expect.objectContaining({ code: 'TOKEN_INVALID' }));
    }
  });

  it('gives an identical error for a well-formed but unknown token', async () => {
    // Report §12.2: enumeration must not distinguish "wrong" from "missing".
    const unknown = Buffer.from(
      randomUUID().replace(/-/g, '') + '00000000000000000000000000000000',
      'hex',
    )
      .subarray(0, 32)
      .toString('base64url');
    await expect(
      container.services.publicApproval.resolve(unknown, publicContext(), undefined),
    ).rejects.toThrowError(expect.objectContaining({ code: 'TOKEN_INVALID' }));
  });

  it('revokes the token the moment a decision is recorded', async () => {
    const { token } = await createSentChangeOrder(container, tenant);
    const ctx = publicContext();
    const resolved = await container.services.publicApproval.resolve(token, ctx, undefined);

    await container.services.decisions.decide(
      {
        plainToken: token,
        publicSessionToken: resolved.session!.token,
        input: {
          type: 'APPROVE',
          signerName: tenant.approverName,
          signedDate: today(),
          declarationAccepted: true,
        },
        idempotencyKey: randomUUID(),
        ifMatch: resolved.dto.etag,
      },
      ctx,
    );

    const record = await container.repos.approvals.findByToken(token);
    expect(record?.revokedAt).not.toBeNull();
    expect(record?.revokedReason).toBe('DECIDED');
  });

  it('never exposes another version’s data through a valid token', async () => {
    const first = await createSentChangeOrder(container, tenant, { title: 'First change' });
    const second = await createSentChangeOrder(container, tenant, { title: 'Second change' });

    const resolved = await container.services.publicApproval.resolve(
      first.token,
      publicContext(),
      undefined,
    );
    expect(resolved.dto.change.title).toBe('First change');
    expect(resolved.dto.change.number).not.toBe(second.changeOrder.number);
  });

  it('exposes a minimal projection across the public boundary', async () => {
    // Report §5.3: minimal response fields, no tenant dashboard access.
    const { token } = await createSentChangeOrder(container, tenant);
    const { dto } = await container.services.publicApproval.resolve(
      token,
      publicContext(),
      undefined,
    );

    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain(tenant.organizationId);
    expect(serialized).not.toContain(tenant.customerId);
    expect(serialized).not.toContain(tenant.ownerUserId);
    expect(serialized).not.toContain(token);
    // The approver's contact is masked, never given in full.
    expect(dto.approver.maskedContact).toMatch(/\*/);
    expect(serialized).not.toContain('+919845000000');
  });
});

describe('log redaction', () => {
  it('removes an approval link from free text', () => {
    const token = 'A'.repeat(43);
    const line = `sending https://app.extrawork.in/r/${token} to customer`;
    expect(redactString(line)).not.toContain(token);
    expect(redactString(line)).toContain('[redacted]');
  });

  it('removes a bare token from free text', () => {
    const token = 'B'.repeat(43);
    expect(redactString(`token=${token}`)).not.toContain(token);
  });

  it('redacts sensitive keys at any depth', () => {
    const payload = {
      safe: 'keep me',
      approvalUrl: 'https://app.extrawork.in/r/secret',
      nested: { phoneE164: '+919845012345', deeper: { signerName: 'Priya Mehta' } },
    };
    const output = JSON.stringify(redact(payload));
    expect(output).toContain('keep me');
    expect(output).not.toContain('919845012345');
    expect(output).not.toContain('Priya Mehta');
    expect(output).not.toContain('/r/secret');
  });

  it('keeps the machine error code readable for operators', () => {
    // Redacting `code` would make production failures undebuggable while
    // protecting nothing: OTP material uses its own key names.
    const output = JSON.stringify(redact({ code: 'VERSION_SUPERSEDED', otpCode: '123456' }));
    expect(output).toContain('VERSION_SUPERSEDED');
    expect(output).not.toContain('123456');
  });
});

describe('file upload validation', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 1),
  ]);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 1)]);

  it('accepts allowlisted types whose magic bytes match', () => {
    expect(validateBytes(jpeg, 'image/jpeg', jpeg.length).ok).toBe(true);
    expect(validateBytes(png, 'image/png', png.length).ok).toBe(true);
    expect(validateBytes(pdf, 'application/pdf', pdf.length).ok).toBe(true);
  });

  it('rejects a declared type that contradicts the magic bytes', () => {
    // Report §12.1: magic-byte validation, not trust in the declared type.
    const verdict = validateBytes(pdf, 'image/jpeg', pdf.length);
    expect(verdict.ok).toBe(false);
  });

  it('rejects an executable disguised as an image', () => {
    const macho = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(64, 0)]);
    expect(validateBytes(macho, 'image/jpeg', macho.length).ok).toBe(false);
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64, 0)]);
    expect(validateBytes(elf, 'image/png', elf.length).ok).toBe(false);
  });

  it('rejects an HTML polyglot that a browser could execute', () => {
    const polyglot = Buffer.from('<html><script>alert(1)</script></html>');
    expect(validateBytes(polyglot, 'image/jpeg', polyglot.length).ok).toBe(false);
  });

  it('rejects a type that is not on the allowlist at all', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(validateBytes(svg, 'image/svg+xml', svg.length).ok).toBe(false);
  });

  it('rejects a byte size that disagrees with the declared size', () => {
    expect(validateBytes(jpeg, 'image/jpeg', jpeg.length + 5_000).ok).toBe(false);
  });

  it('rejects an empty file', () => {
    expect(validateBytes(Buffer.alloc(0), 'image/jpeg', 0).ok).toBe(false);
  });
});

describe('webhook signature verification', () => {
  const secret = 'webhook-secret-value';
  const body = Buffer.from(JSON.stringify({ entry: [{ id: '1' }] }));

  it('accepts a correct Meta signature over the raw body', () => {
    expect(verifyMetaSignature(body, signMeta(body, secret), secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    // The signature is computed over the RAW bytes, so re-serialising the JSON
    // (which a naive handler would do) breaks verification — as it must.
    const tampered = Buffer.from(JSON.stringify({ entry: [{ id: '2' }] }));
    expect(verifyMetaSignature(tampered, signMeta(body, secret), secret)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifyMetaSignature(body, signMeta(body, 'attacker-secret'), secret)).toBe(false);
  });

  it('rejects a missing or malformed signature', () => {
    for (const signature of [undefined, '', 'sha256=', 'not-a-signature', 'sha256=zz']) {
      expect(verifyMetaSignature(body, signature, secret)).toBe(false);
    }
  });

  it('rejects a signature that is correct but for a different scheme prefix', () => {
    const hex = signMeta(body, secret).slice('sha256='.length);
    expect(verifyMetaSignature(body, `sha1=${hex}`, secret)).toBe(false);
    expect(verifyMetaSignature(body, hex, secret)).toBe(false);
  });

  it('verifies Razorpay signatures over the raw body too', () => {
    const hex = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyRazorpaySignature(body, hex, secret)).toBe(true);
    expect(verifyRazorpaySignature(body, hex, 'other-secret')).toBe(false);
    expect(verifyRazorpaySignature(body, undefined, secret)).toBe(false);
  });
});

/** Meta's `X-Hub-Signature-256` construction, used as the test's oracle. */
function signMeta(raw: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
}

describe('entitlements and read-only mode', () => {
  it('keeps exports available after a subscription lapses', async () => {
    // Report §16.3: "A customer can export records even after subscription lapse."
    await container.uow.transaction(async (tx) => {
      await container.repos.organizations.setSubscription(tx, tenant.owner.tenant, {
        planCode: 'STARTER_MONTHLY',
        status: 'LAPSED',
        currentPeriodStart: new Date(Date.now() - 60 * 86_400_000),
        currentPeriodEnd: new Date(Date.now() - 30 * 86_400_000),
        graceEndsAt: null,
        provider: null,
        providerSubscriptionId: null,
      });
    });

    const state = await container.repos.organizations.resolveEntitlements(tenant.owner.tenant);
    expect(state.readOnly).toBe(true);

    // Reads keep working.
    await expect(
      container.repos.projects.requireById(tenant.owner.tenant, tenant.projectId),
    ).resolves.toBeDefined();
    await expect(
      container.repos.reporting.extraWorkReport(tenant.owner.tenant, { status: 'ALL' }),
    ).resolves.toBeDefined();
  });

  it('blocks a new send once the subscription has lapsed', async () => {
    const created = await container.services.changeOrders.create(tenant.owner, tenant.projectId, {
      type: 'ADDITION',
      title: 'Work after lapse',
      scope: 'A scope description long enough to satisfy the validation rules here.',
      lineItems: [],
      scheduleDeltaDays: 1,
      approverContactId: tenant.approverContactId,
      assuranceRequired: 'A0',
    });

    await container.uow.transaction(async (tx) => {
      await container.repos.organizations.setSubscription(tx, tenant.owner.tenant, {
        planCode: 'STARTER_MONTHLY',
        status: 'LAPSED',
        currentPeriodStart: new Date(Date.now() - 60 * 86_400_000),
        currentPeriodEnd: new Date(Date.now() - 30 * 86_400_000),
        graceEndsAt: null,
        provider: null,
        providerSubscriptionId: null,
      });
    });

    const readOnlyCtx = { ...tenant.owner, readOnly: true };
    await expect(
      container.services.send.send(readOnlyCtx, created.changeOrderId, {
        channel: 'WHATSAPP_NATIVE_SHARE',
      }),
    ).rejects.toThrow(AppError);
  });
});

describe('assurance is never silently downgraded', () => {
  it('refuses A2 outright rather than falling back', async () => {
    // Report §13.1: "never downgrade silently".
    await expect(
      container.services.changeOrders.create(tenant.owner, tenant.projectId, {
        type: 'ADDITION',
        title: 'Needs a licensed signature',
        scope: 'A scope description that is comfortably long enough to be valid.',
        lineItems: [],
        scheduleDeltaDays: 1,
        approverContactId: tenant.approverContactId,
        assuranceRequired: 'A2',
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'FEATURE_NOT_ENTITLED' }));
  });
});

describe('portal token IDOR', () => {
  // Spec 2026-10-12, D5: a portal link is one contact's window onto one
  // project. Whatever id is put beside a valid token, nothing outside that
  // project comes back, and an unknown document reads exactly like a missing one.
  async function portalToken(fixture: TenantFixture): Promise<string> {
    const created = await container.services.portal.createLink(
      fixture.owner,
      fixture.projectId,
      {},
    );
    return created.portalUrl.slice(created.portalUrl.lastIndexOf('/') + 1);
  }

  it('stores only a hash of the portal token — the plaintext is nowhere in the database', async () => {
    const token = await portalToken(tenant);
    const { rows: columns } = await container.uow.pool.query<{
      table_name: string;
      column_name: string;
    }>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type IN ('text', 'character varying', 'jsonb', 'json')
    `);
    for (const column of columns) {
      const { rows } = await container.uow.pool.query<{ hits: string }>(
        `SELECT count(*)::text AS hits FROM "${column.table_name}"
          WHERE "${column.column_name}"::text LIKE $1`,
        [`%${token}%`],
      );
      expect(
        Number(rows[0]?.hits ?? 0),
        `${column.table_name}.${column.column_name} contains the plaintext portal token`,
      ).toBe(0);
    }
  });

  it("never serves another workspace's or another project's records through a valid token", async () => {
    const other = await createTenant(container, { name: 'Other Studio' });
    const theirs = await createSentChangeOrder(container, other);
    const theirEvidence = randomUUID();
    await container.uow.pool.query(
      `INSERT INTO generated_documents
         (id, organization_id, project_id, version_id, kind, status, template_version,
          storage_key, generated_at)
       VALUES ($1, $2, $3, $4, 'EVIDENCE_PDF', 'READY', 'test-1', 'evidence/x.pdf', now())`,
      [theirEvidence, other.organizationId, other.projectId, theirs.sent.versionId],
    );
    const sameOrgProject = await container.services.projects.createProject(tenant.owner, {
      customerId: tenant.customerId,
      title: 'Neighbouring flat',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      baseline: { subtotalMinor: 100_00, taxMinor: 0, totalMinor: 100_00 },
      defaultApproverContactId: tenant.approverContactId,
    });
    const neighbour = await createSentChangeOrder(container, {
      ...tenant,
      projectId: sameOrgProject.id,
    });
    const token = await portalToken(tenant);

    for (const id of [
      theirEvidence,
      theirs.sent.versionId,
      neighbour.sent.versionId,
      randomUUID(),
    ]) {
      await expect(
        container.services.portal.download(token, id, publicContext()),
      ).rejects.toThrowError(expect.objectContaining({ code: 'DOCUMENT_NOT_FOUND' }));
    }

    const view = await container.services.portal.view(token, publicContext());
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(other.organizationId);
    expect(serialized).not.toContain(tenant.organizationId);
    expect(serialized).not.toContain(neighbour.changeOrder.number);
    expect(serialized).not.toContain(token);
  });

  it('refuses malformed portal tokens before any lookup', async () => {
    for (const candidate of ['short', "' OR 1=1--", '../../etc/passwd', `${'a'.repeat(42)}!`]) {
      await expect(container.services.portal.view(candidate, publicContext())).rejects.toThrowError(
        expect.objectContaining({ code: 'PORTAL_LINK_INVALID' }),
      );
    }
  });
});
