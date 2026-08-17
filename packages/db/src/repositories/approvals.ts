import { sql } from 'drizzle-orm';
import { AppError, type AssuranceLevel, type DecisionType } from '@extrawork/contracts';
import { hashToken, type TenantContext, type TokenRevocationReason } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { generateOpaqueToken, hashOpaqueToken } from './identity.js';
import { toDate, toDateOrNull } from '../row-types.js';

/**
 * Approval tokens, public sessions, OTP challenges and decisions.
 *
 * Report §3.4 (token security), §4.5 (lifecycle), §7.8 (locking), §8.4 (decision
 * engine). No method here accepts or returns a plaintext approval token except
 * `issueToken`, which returns it exactly once for the caller to put in the link.
 */

export interface ApprovalTokenRow {
  id: string;
  organizationId: string;
  versionId: string;
  approverContactId: string;
  assuranceRequired: AssuranceLevel;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: TokenRevocationReason | null;
  viewCount: number;
  firstViewedAt: Date | null;
}

export interface PublicSessionRow {
  id: string;
  organizationId: string;
  approvalTokenId: string;
  versionId: string;
  assuranceAchieved: AssuranceLevel;
  verifiedPhoneE164: string | null;
  verifiedAt: Date | null;
  expiresAt: Date;
  csrfTokenHash: Buffer;
}

export interface DecisionRow {
  id: string;
  organizationId: string;
  projectId: string;
  versionId: string;
  type: DecisionType;
  signerName: string;
  signerComment: string | null;
  assuranceAchieved: AssuranceLevel;
  verifiedPhoneE164: string | null;
  occurredAt: Date;
  receiptDisplayId: string;
}

export class ApprovalRepository {
  constructor(private readonly db: Database) {}

  // --- Tokens --------------------------------------------------------------

  /** Persists only the hash. The plaintext is the caller's to use once. */
  async issueToken(
    tx: TransactionContext,
    ctx: TenantContext,
    input: {
      versionId: string;
      approverContactId: string;
      assuranceRequired: AssuranceLevel;
      expiresAt: Date;
      tokenHash: Buffer;
    },
  ): Promise<string> {
    const id = newId();
    await tx.db.execute(sql`
      INSERT INTO approval_tokens
        (id, organization_id, version_id, token_hash, approver_contact_id,
         assurance_required, expires_at)
      VALUES (
        ${id}::uuid, ${ctx.organizationId}::uuid, ${input.versionId}::uuid,
        ${input.tokenHash}, ${input.approverContactId}::uuid,
        ${input.assuranceRequired}::assurance_level, ${input.expiresAt.toISOString()}::timestamptz
      )
    `);
    return id;
  }

  /**
   * Resolves a plaintext token to its record. The lookup is by hash, so a
   * timing difference cannot reveal whether a token exists beyond the single
   * indexed equality that any lookup requires.
   */
  async findByToken(plaintext: string): Promise<ApprovalTokenRow | null> {
    const result = await this.db.execute<TokenRecord>(sql`
      SELECT ${TOKEN_COLUMNS} FROM approval_tokens WHERE token_hash = ${hashToken(plaintext)}
    `);
    const row = result.rows[0];
    return row ? mapToken(row) : null;
  }

  /** Report §8.4: `approvalTokens.lockByHash(tx, sha256(context.plainToken))`. */
  async lockByHash(tx: TransactionContext, tokenHash: Buffer): Promise<ApprovalTokenRow | null> {
    const result = await tx.db.execute<TokenRecord>(sql`
      SELECT ${TOKEN_COLUMNS} FROM approval_tokens
      WHERE token_hash = ${tokenHash}
      FOR UPDATE
    `);
    const row = result.rows[0];
    return row ? mapToken(row) : null;
  }

  async recordView(tx: TransactionContext, tokenId: string): Promise<{ firstView: boolean }> {
    // Report §4.5: the first valid view appends an evidence event; repeat views
    // only move the aggregate counters.
    const result = await tx.db.execute<{ first_view: boolean }>(sql`
      UPDATE approval_tokens
         SET view_count = view_count + 1,
             first_viewed_at = COALESCE(first_viewed_at, now()),
             last_viewed_at = now()
       WHERE id = ${tokenId}::uuid
      RETURNING (view_count = 1) AS first_view
    `);
    return { firstView: result.rows[0]?.first_view ?? false };
  }

  async revoke(
    tx: TransactionContext,
    tokenId: string,
    reason: TokenRevocationReason,
  ): Promise<void> {
    await tx.db.execute(sql`
      UPDATE approval_tokens SET revoked_at = now(), revoked_reason = ${reason}
      WHERE id = ${tokenId}::uuid AND revoked_at IS NULL
    `);
  }

  async revokeForVersion(
    tx: TransactionContext,
    versionId: string,
    reason: TokenRevocationReason,
  ): Promise<number> {
    const result = await tx.db.execute(sql`
      UPDATE approval_tokens SET revoked_at = now(), revoked_reason = ${reason}
      WHERE version_id = ${versionId}::uuid AND revoked_at IS NULL
    `);
    return result.rowCount ?? 0;
  }

  /**
   * When a version is superseded the customer may still hold the old link.
   * Report §4.6 allows offering the current link "when allowed" — that means
   * the same approver on a live token for the successor version.
   */
  async findSuccessorToken(
    supersededVersionId: string,
    approverContactId: string,
  ): Promise<{ versionId: string } | null> {
    const result = await this.db.execute<{ version_id: string }>(sql`
      SELECT t.version_id
      FROM change_order_versions old
      JOIN change_order_versions next ON next.id = old.superseded_by_version_id
      JOIN approval_tokens t ON t.version_id = next.id
      WHERE old.id = ${supersededVersionId}::uuid
        AND t.revoked_at IS NULL
        AND t.expires_at > now()
        AND t.approver_contact_id = ${approverContactId}::uuid
      LIMIT 1
    `);
    const row = result.rows[0];
    return row ? { versionId: row.version_id } : null;
  }

  // --- Public sessions -----------------------------------------------------

  async createPublicSession(
    tx: TransactionContext,
    input: {
      organizationId: string;
      approvalTokenId: string;
      versionId: string;
      ttlMinutes: number;
      ipHash: Buffer | null;
      userAgent: string | null;
    },
  ): Promise<{ sessionToken: string; csrfToken: string; sessionId: string; expiresAt: Date }> {
    const session = generateOpaqueToken();
    const csrf = generateOpaqueToken(24);
    const id = newId();
    const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000);

    await tx.db.execute(sql`
      INSERT INTO public_sessions
        (id, organization_id, approval_token_id, version_id, session_token_hash,
         csrf_token_hash, ip_hash, user_agent, expires_at)
      VALUES (
        ${id}::uuid, ${input.organizationId}::uuid, ${input.approvalTokenId}::uuid,
        ${input.versionId}::uuid, ${session.hash}, ${csrf.hash},
        ${input.ipHash}, ${input.userAgent}, ${expiresAt.toISOString()}::timestamptz
      )
    `);

    return { sessionToken: session.token, csrfToken: csrf.token, sessionId: id, expiresAt };
  }

  async findPublicSession(sessionToken: string): Promise<PublicSessionRow | null> {
    const result = await this.db.execute<PublicSessionRecord>(sql`
      SELECT ${PUBLIC_SESSION_COLUMNS} FROM public_sessions
      WHERE session_token_hash = ${hashOpaqueToken(sessionToken)} AND expires_at > now()
    `);
    const row = result.rows[0];
    return row ? mapPublicSession(row) : null;
  }

  async raiseSessionAssurance(
    tx: TransactionContext,
    sessionId: string,
    level: AssuranceLevel,
    verifiedPhone: string,
  ): Promise<void> {
    await tx.db.execute(sql`
      UPDATE public_sessions
         SET assurance_achieved = ${level}::assurance_level,
             verified_phone_e164 = ${verifiedPhone},
             verified_at = now()
       WHERE id = ${sessionId}::uuid
    `);
  }

  // --- OTP -----------------------------------------------------------------

  /** Public sessions are short-lived by design (report §6.5); clear the tail. */
  async purgeExpiredPublicSessions(db: Database, now: Date): Promise<number> {
    const result = await db.execute(sql`
      DELETE FROM public_sessions
      WHERE expires_at < ${now.toISOString()}::timestamptz - interval '1 day'
    `);
    return result.rowCount ?? 0;
  }

  async createOtpChallenge(
    tx: TransactionContext,
    input: {
      organizationId: string;
      publicSessionId: string;
      contactId: string;
      destinationE164: string;
      codeHash: Buffer;
      salt: string;
      ttlSeconds: number;
      maxAttempts: number;
    },
  ): Promise<{ id: string; expiresAt: Date }> {
    const id = newId();
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    await tx.db.execute(sql`
      INSERT INTO otp_challenges
        (id, organization_id, public_session_id, contact_id, destination_e164,
         code_hash, salt, max_attempts, expires_at)
      VALUES (
        ${id}::uuid, ${input.organizationId}::uuid, ${input.publicSessionId}::uuid,
        ${input.contactId}::uuid, ${input.destinationE164}, ${input.codeHash},
        ${input.salt}, ${input.maxAttempts}, ${expiresAt.toISOString()}::timestamptz
      )
    `);
    return { id, expiresAt };
  }

  async lockOtpChallenge(
    tx: TransactionContext,
    challengeId: string,
    publicSessionId: string,
  ): Promise<{
    id: string;
    codeHash: Buffer;
    salt: string;
    expiresAt: Date;
    attemptCount: number;
    maxAttempts: number;
    consumedAt: Date | null;
    destinationE164: string;
  } | null> {
    const result = await tx.db.execute<{
      id: string;
      code_hash: Buffer;
      salt: string;
      expires_at: Date;
      attempt_count: number;
      max_attempts: number;
      consumed_at: Date | null;
      destination_e164: string;
    }>(sql`
      SELECT id, code_hash, salt, expires_at, attempt_count, max_attempts,
             consumed_at, destination_e164
      FROM otp_challenges
      WHERE id = ${challengeId}::uuid AND public_session_id = ${publicSessionId}::uuid
      FOR UPDATE
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      codeHash: row.code_hash,
      salt: row.salt,
      expiresAt: toDate(row.expires_at),
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      consumedAt: toDateOrNull(row.consumed_at),
      destinationE164: row.destination_e164,
    };
  }

  async recordOtpAttempt(
    tx: TransactionContext,
    challengeId: string,
    succeeded: boolean,
  ): Promise<void> {
    await tx.db.execute(sql`
      UPDATE otp_challenges
         SET attempt_count = attempt_count + 1,
             consumed_at = ${succeeded ? sql`now()` : sql`consumed_at`}
       WHERE id = ${challengeId}::uuid
    `);
  }

  async otpSendCounts(
    contactId: string,
  ): Promise<{ sentInWindow: number; sentToday: number; lastSentAt: Date | null }> {
    const result = await this.db.execute<{
      in_window: string;
      today: string;
      last_sent: Date | null;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE created_at > now() - interval '15 minutes')::text AS in_window,
        count(*) FILTER (WHERE created_at > now() - interval '1 day')::text AS today,
        max(created_at) AS last_sent
      FROM otp_challenges
      WHERE contact_id = ${contactId}::uuid
    `);
    const row = result.rows[0];
    return {
      sentInWindow: Number.parseInt(row?.in_window ?? '0', 10),
      sentToday: Number.parseInt(row?.today ?? '0', 10),
      lastSentAt: row?.last_sent ?? null,
    };
  }

  // --- Decisions -----------------------------------------------------------

  /**
   * Inserts the decision. The `UNIQUE (version_id)` constraint is the last line
   * of defence for the simultaneous-decision race (report §4.6): the second
   * writer gets a unique violation, which `translateDatabaseError` maps to
   * ALREADY_DECIDED.
   */
  async insertDecision(
    tx: TransactionContext,
    ctx: TenantContext,
    input: {
      projectId: string;
      versionId: string;
      type: DecisionType;
      signerName: string;
      comment: string | null;
      assuranceAchieved: AssuranceLevel;
      verifiedPhoneE164: string | null;
      publicSessionId: string;
      ipHash: Buffer | null;
      userAgent: string | null;
      declarationText: string;
      termsVersion: string;
      occurredAt: Date;
      receiptTokenHash: Buffer;
      receiptDisplayId: string;
    },
  ): Promise<DecisionRow> {
    const id = newId();
    await tx.db.execute(sql`
      INSERT INTO decisions (
        id, organization_id, project_id, version_id, type, signer_name, signer_comment,
        assurance_achieved, verified_phone_e164, public_session_id, ip_hash, user_agent,
        declaration_text, terms_version, occurred_at, receipt_token_hash, receipt_display_id
      ) VALUES (
        ${id}::uuid, ${ctx.organizationId}::uuid, ${input.projectId}::uuid,
        ${input.versionId}::uuid, ${input.type}::decision_type, ${input.signerName},
        ${input.comment}, ${input.assuranceAchieved}::assurance_level,
        ${input.verifiedPhoneE164}, ${input.publicSessionId}::uuid, ${input.ipHash},
        ${input.userAgent}, ${input.declarationText}, ${input.termsVersion},
        ${input.occurredAt.toISOString()}::timestamptz, ${input.receiptTokenHash},
        ${input.receiptDisplayId}
      )
    `);

    const row = await this.findDecisionByVersion(tx.db, ctx, input.versionId);
    if (!row) throw new AppError('INTERNAL_ERROR', { message: 'Decision insert returned no row' });
    return row;
  }

  async findDecisionByVersion(
    db: Database,
    ctx: TenantContext,
    versionId: string,
  ): Promise<DecisionRow | null> {
    const result = await db.execute<DecisionRecord>(sql`
      SELECT ${DECISION_COLUMNS} FROM decisions
      WHERE version_id = ${versionId}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    return row ? mapDecision(row) : null;
  }

  /** Public receipt lookup; the receipt token outlives the approval token. */
  async findDecisionByReceiptToken(
    receiptToken: string,
  ): Promise<(DecisionRow & { changeOrderId: string }) | null> {
    const result = await this.db.execute<DecisionRecord & { change_order_id: string }>(sql`
      SELECT ${DECISION_COLUMNS_D}, v.change_order_id
      FROM decisions d
      JOIN change_order_versions v ON v.id = d.version_id
      WHERE d.receipt_token_hash = ${hashToken(receiptToken)}
    `);
    const row = result.rows[0];
    if (!row) return null;
    return { ...mapDecision(row), changeOrderId: row.change_order_id };
  }
}

const TOKEN_COLUMNS = sql`
  id, organization_id, version_id, approver_contact_id, assurance_required,
  expires_at, revoked_at, revoked_reason, view_count, first_viewed_at
`;

type TokenRecord = {
  id: string;
  organization_id: string;
  version_id: string;
  approver_contact_id: string;
  assurance_required: AssuranceLevel;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: TokenRevocationReason | null;
  view_count: number;
  first_viewed_at: Date | null;
};

function mapToken(row: TokenRecord): ApprovalTokenRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    versionId: row.version_id,
    approverContactId: row.approver_contact_id,
    assuranceRequired: row.assurance_required,
    expiresAt: toDate(row.expires_at),
    revokedAt: toDateOrNull(row.revoked_at),
    revokedReason: row.revoked_reason,
    viewCount: row.view_count,
    firstViewedAt: toDateOrNull(row.first_viewed_at),
  };
}

const PUBLIC_SESSION_COLUMNS = sql`
  id, organization_id, approval_token_id, version_id, assurance_achieved,
  verified_phone_e164, verified_at, expires_at, csrf_token_hash
`;

type PublicSessionRecord = {
  id: string;
  organization_id: string;
  approval_token_id: string;
  version_id: string;
  assurance_achieved: AssuranceLevel;
  verified_phone_e164: string | null;
  verified_at: Date | null;
  expires_at: Date;
  csrf_token_hash: Buffer;
};

function mapPublicSession(row: PublicSessionRecord): PublicSessionRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    approvalTokenId: row.approval_token_id,
    versionId: row.version_id,
    assuranceAchieved: row.assurance_achieved,
    verifiedPhoneE164: row.verified_phone_e164,
    verifiedAt: toDateOrNull(row.verified_at),
    expiresAt: toDate(row.expires_at),
    csrfTokenHash: Buffer.isBuffer(row.csrf_token_hash)
      ? row.csrf_token_hash
      : Buffer.from(row.csrf_token_hash),
  };
}

/**
 * Two spellings for the same projection: `RETURNING` and un-joined selects
 * address `decisions` directly, joined reads alias it as `d`. A SQL template
 * cannot be type-checked, so keeping both avoids a runtime "missing FROM-clause
 * entry" that only shows up on the joined path.
 */
const DECISION_COLUMNS = sql`
  id, organization_id, project_id, version_id, type, signer_name,
  signer_comment, assurance_achieved, verified_phone_e164, occurred_at,
  receipt_display_id
`;

const DECISION_COLUMNS_D = sql`
  d.id, d.organization_id, d.project_id, d.version_id, d.type, d.signer_name,
  d.signer_comment, d.assurance_achieved, d.verified_phone_e164, d.occurred_at,
  d.receipt_display_id
`;

type DecisionRecord = {
  id: string;
  organization_id: string;
  project_id: string;
  version_id: string;
  type: DecisionType;
  signer_name: string;
  signer_comment: string | null;
  assurance_achieved: AssuranceLevel;
  verified_phone_e164: string | null;
  occurred_at: Date;
  receipt_display_id: string;
};

function mapDecision(row: DecisionRecord): DecisionRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    versionId: row.version_id,
    type: row.type,
    signerName: row.signer_name,
    signerComment: row.signer_comment,
    assuranceAchieved: row.assurance_achieved,
    verifiedPhoneE164: row.verified_phone_e164,
    occurredAt: toDate(row.occurred_at),
    receiptDisplayId: row.receipt_display_id,
  };
}
