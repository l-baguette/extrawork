import { randomBytes } from 'node:crypto';
import { AppError, DOMAIN_EVENTS } from '@extrawork/contracts';
import {
  assertAssuranceAvailable,
  assertOtpSendAllowed,
  assertTokenUsable,
  generateOtp,
  hashToken,
  isWellFormedToken,
  maskPhone,
  systemTenantContext,
  verifyOtp,
} from '@extrawork/domain';
import type { AppContext, PublicRequestContext } from '../context.js';

/**
 * A1 phone verification — report §3.3, §4.5 and §12.2.
 *
 * The plaintext code goes straight from `generateOtp` to the delivery gateway
 * and is never logged, returned, or persisted; only a salted hash is stored
 * (report §11.5).
 */

export interface OtpChallengeResult {
  challengeId: string;
  maskedDestination: string;
  expiresAt: Date;
  resendAvailableAt: Date;
  attemptsRemaining: number;
}

export class OtpService {
  constructor(private readonly app: AppContext) {}

  async requestCode(
    plainToken: string,
    publicSessionToken: string,
    ctx: PublicRequestContext,
  ): Promise<OtpChallengeResult> {
    if (!isWellFormedToken(plainToken)) throw new AppError('TOKEN_INVALID');

    const session = await this.app.repos.approvals.findPublicSession(publicSessionToken);
    if (!session) throw new AppError('SESSION_EXPIRED');

    const token = await this.app.repos.approvals.findByToken(plainToken);
    if (!token || token.id !== session.approvalTokenId) throw new AppError('TOKEN_INVALID');

    // Never silently downgrade: if OTP is unavailable, say so (report §13.1).
    assertAssuranceAvailable(token.assuranceRequired, {
      otpAvailable: this.app.integrations.otp.available,
      esignAvailable: this.app.integrations.esign.available,
    });

    const tenant = systemTenantContext(token.organizationId, ctx.requestId);
    const salt = randomBytes(16).toString('base64url');
    const otp = generateOtp(salt);

    const { challenge, contact, resendAvailableAt } = await this.app.uow.transaction(async (tx) => {
      // Serialize against decision/revocation and against every OTP send for
      // this contact. The previous read-then-insert sequence allowed parallel
      // requests to all observe zero sends and exceed both limits.
      const lockedToken = await this.app.repos.approvals.lockByHash(tx, hashToken(plainToken));
      if (!lockedToken || lockedToken.id !== session.approvalTokenId) {
        throw new AppError('TOKEN_INVALID');
      }
      assertTokenUsable(lockedToken, this.app.clock.now());

      const lockedContact = await this.app.repos.customers.lockContact(
        tx,
        tenant,
        lockedToken.approverContactId,
      );
      if (!lockedContact.phoneE164) {
        throw new AppError('ASSURANCE_UNAVAILABLE', {
          message: 'This approver has no phone number on record, so a code cannot be sent.',
        });
      }
      const version = await this.app.repos.changeOrders.requireVersion(
        tx.db,
        tenant,
        lockedToken.versionId,
      );

      const counts = await this.app.repos.approvals.otpSendCounts(lockedContact.id, tx.db);
      const nextSendAt = assertOtpSendAllowed(counts, this.app.clock.now());
      const created = await this.app.repos.approvals.createOtpChallenge(tx, {
        organizationId: lockedToken.organizationId,
        publicSessionId: session.id,
        contactId: lockedContact.id,
        destinationE164: lockedContact.phoneE164,
        codeHash: otp.codeHash,
        salt: otp.salt,
        ttlSeconds: this.app.env.OTP_TTL_SECONDS,
        maxAttempts: this.app.env.OTP_MAX_ATTEMPTS,
      });

      await this.app.repos.audit.append(tx, tenant, [
        {
          aggregateType: 'change_order',
          aggregateId: version.changeOrderId,
          projectId: version.projectId,
          eventType: DOMAIN_EVENTS.APPROVAL_OTP_SENT,
          actorType: 'CUSTOMER',
          actorId: lockedContact.id,
          occurredAt: this.app.clock.now(),
          // The masked destination is evidence; the code never is.
          payload: { challengeId: created.id, destination: maskPhone(lockedContact.phoneE164) },
        },
      ]);

      return { challenge: created, contact: lockedContact, resendAvailableAt: nextSendAt };
    });

    // Provider call happens AFTER the commit (report §7.6, §14.4).
    const organization = await this.app.repos.organizations.findById(tenant);
    await this.app.integrations.otp.deliver({
      phoneE164: contact.phoneE164!,
      code: otp.code,
      organizationName: organization?.displayName ?? 'ExtraWork',
      ttlSeconds: this.app.env.OTP_TTL_SECONDS,
    });

    return {
      challengeId: challenge.id,
      maskedDestination: maskPhone(contact.phoneE164) ?? '',
      expiresAt: challenge.expiresAt,
      resendAvailableAt,
      attemptsRemaining: this.app.env.OTP_MAX_ATTEMPTS,
    };
  }

  async verifyCode(
    plainToken: string,
    publicSessionToken: string,
    challengeId: string,
    code: string,
    ctx: PublicRequestContext,
  ): Promise<{ verified: boolean; assuranceAchieved: string; attemptsRemaining: number }> {
    if (!isWellFormedToken(plainToken)) throw new AppError('TOKEN_INVALID');

    const session = await this.app.repos.approvals.findPublicSession(publicSessionToken);
    if (!session) throw new AppError('SESSION_EXPIRED');

    const token = await this.app.repos.approvals.findByToken(plainToken);
    if (!token || token.id !== session.approvalTokenId) throw new AppError('TOKEN_INVALID');

    const tenant = systemTenantContext(token.organizationId, ctx.requestId);

    return this.app.uow.transaction(async (tx) => {
      const lockedToken = await this.app.repos.approvals.lockByHash(tx, hashToken(plainToken));
      if (!lockedToken || lockedToken.id !== session.approvalTokenId) {
        throw new AppError('TOKEN_INVALID');
      }
      assertTokenUsable(lockedToken, this.app.clock.now());

      // Locked so two parallel guesses cannot both consume the same attempt.
      const challenge = await this.app.repos.approvals.lockOtpChallenge(
        tx,
        tenant.organizationId,
        challengeId,
        session.id,
      );
      if (!challenge)
        throw new AppError('NOT_FOUND', { message: 'That verification has expired.' });

      const outcome = verifyOtp(
        {
          id: challenge.id,
          codeHash: challenge.codeHash,
          salt: challenge.salt,
          expiresAt: challenge.expiresAt,
          attemptCount: challenge.attemptCount,
          maxAttempts: challenge.maxAttempts,
          consumedAt: challenge.consumedAt,
        },
        code,
        this.app.clock.now(),
      );

      await this.app.repos.approvals.recordOtpAttempt(
        tx,
        tenant.organizationId,
        challenge.id,
        outcome.verified,
      );

      if (!outcome.verified) {
        return {
          verified: false,
          assuranceAchieved: session.assuranceAchieved,
          attemptsRemaining: Math.max(0, outcome.attemptsRemaining),
        };
      }

      await this.app.repos.approvals.raiseSessionAssurance(
        tx,
        tenant.organizationId,
        session.id,
        'A1',
        challenge.destinationE164,
      );
      const version = await this.app.repos.changeOrders.requireVersion(
        tx.db,
        tenant,
        lockedToken.versionId,
      );

      await this.app.repos.audit.append(tx, tenant, [
        {
          aggregateType: 'change_order',
          aggregateId: version.changeOrderId,
          projectId: version.projectId,
          eventType: DOMAIN_EVENTS.APPROVAL_PHONE_VERIFIED,
          actorType: 'CUSTOMER',
          actorId: lockedToken.approverContactId,
          occurredAt: this.app.clock.now(),
          payload: {
            challengeId: challenge.id,
            verifiedPhone: maskPhone(challenge.destinationE164),
          },
        },
      ]);

      return {
        verified: true,
        assuranceAchieved: 'A1',
        attemptsRemaining: outcome.attemptsRemaining,
      };
    });
  }
}
