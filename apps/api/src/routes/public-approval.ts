import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AppError,
  DecisionInputSchema,
  OtpRequestSchema,
  OtpVerifySchema,
} from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import { TOKEN_LENGTH } from '@extrawork/domain';
import { PUBLIC_CSRF_COOKIE, PUBLIC_SESSION_COOKIE } from '../plugins/context.js';
import { publicTokenSubject, rateLimit } from '../plugins/rate-limit.js';

/**
 * `/public/v1` — the approval trust boundary (report §5.3).
 *
 * Rules enforced here and nowhere else:
 *  - the token appears only in the path and is never logged (the log context
 *    holds the route template, and the redactor scrubs the rest);
 *  - responses are `no-store`, `noindex`, `no-referrer`;
 *  - the decision POST needs a public session cookie plus its CSRF pair, so a
 *    bearer link alone cannot be replayed cross-site;
 *  - rate limits are keyed on hashed-token + IP (report §7.7).
 */

const TokenParams = z.object({
  token: z
    .string()
    .length(TOKEN_LENGTH)
    .regex(/^[A-Za-z0-9_-]+$/),
});

export async function registerPublicRoutes(
  app: FastifyInstance,
  appContext: AppContext,
): Promise<void> {
  const limiter = app.repos.rateLimiter;
  const secure = app.env.APP_ENV !== 'local';

  const readLimit = rateLimit(limiter, {
    name: 'PUBLIC_REQUEST_GET',
    subject: publicTokenSubject,
  });
  const decisionLimit = rateLimit(limiter, {
    name: 'PUBLIC_DECISION_POST',
    subject: publicTokenSubject,
  });
  const otpLimit = rateLimit(limiter, { name: 'OTP_SEND_WINDOW', subject: publicTokenSubject });

  function setPublicSession(
    reply: FastifyReply,
    session: { token: string; csrfToken: string; expiresAt: Date },
  ): void {
    const maxAge = Math.max(60, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
    void reply.setCookie(PUBLIC_SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/public',
      maxAge,
    });
    void reply.setCookie(PUBLIC_CSRF_COOKIE, session.csrfToken, {
      httpOnly: false,
      secure,
      sameSite: 'lax',
      path: '/public',
      maxAge,
    });
  }

  function requirePublicSession(request: FastifyRequest): string {
    const token = request.cookies?.[PUBLIC_SESSION_COOKIE];
    if (!token) {
      throw new AppError('SESSION_EXPIRED', {
        message: 'Reload the page before submitting your decision.',
      });
    }
    return token;
  }

  app.get('/public/v1/requests/:token', { preHandler: readLimit }, async (request, reply) => {
    const { token } = TokenParams.parse(request.params);
    const existingSession = request.cookies?.[PUBLIC_SESSION_COOKIE];

    const resolved = await app.services.publicApproval.resolve(
      token,
      request.publicCtx,
      existingSession,
    );
    if (resolved.session) setPublicSession(reply, resolved.session);

    return reply
      .header('etag', resolved.dto.etag)
      .header('cache-control', 'no-store, max-age=0, must-revalidate')
      .send(resolved.dto);
  });

  app.post('/public/v1/requests/:token/otp', { preHandler: otpLimit }, async (request, reply) => {
    const { token } = TokenParams.parse(request.params);
    OtpRequestSchema.parse(request.body ?? {});
    const sessionToken = requirePublicSession(request);

    const challenge = await app.services.otp.requestCode(token, sessionToken, request.publicCtx);
    return reply.status(201).send({
      challengeId: challenge.challengeId,
      maskedDestination: challenge.maskedDestination,
      expiresAt: challenge.expiresAt.toISOString(),
      resendAvailableAt: challenge.resendAvailableAt.toISOString(),
      attemptsRemaining: challenge.attemptsRemaining,
    });
  });

  app.post(
    '/public/v1/requests/:token/otp/verify',
    { preHandler: decisionLimit },
    async (request, reply) => {
      const { token } = TokenParams.parse(request.params);
      const input = OtpVerifySchema.parse(request.body);
      const sessionToken = requirePublicSession(request);

      const result = await app.services.otp.verifyCode(
        token,
        sessionToken,
        input.challengeId,
        input.code,
        request.publicCtx,
      );
      return reply.status(result.verified ? 200 : 400).send(result);
    },
  );

  app.post(
    '/public/v1/requests/:token/decisions',
    { preHandler: decisionLimit },
    async (request, reply) => {
      const { token } = TokenParams.parse(request.params);
      const input = DecisionInputSchema.parse(request.body);
      const sessionToken = requirePublicSession(request);

      // CSRF: the readable cookie value must be echoed in the header, so a
      // cross-site POST that merely carries the cookie cannot decide.
      const csrfHeader = request.headers['x-csrf-token'];
      const csrfCookie = request.cookies?.[PUBLIC_CSRF_COOKIE];
      if (
        typeof csrfHeader !== 'string' ||
        !csrfCookie ||
        csrfHeader.length !== csrfCookie.length ||
        csrfHeader !== csrfCookie
      ) {
        throw new AppError('CSRF_FAILED');
      }

      const idempotencyKey =
        (typeof request.headers['idempotency-key'] === 'string'
          ? request.headers['idempotency-key']
          : undefined) ?? input.idempotencyKey;
      if (!idempotencyKey) throw new AppError('MISSING_IDEMPOTENCY_KEY');

      const ifMatch =
        typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined;

      const receipt = await app.services.decisions.decide(
        { plainToken: token, publicSessionToken: sessionToken, input, idempotencyKey, ifMatch },
        request.publicCtx,
      );

      return reply.status(201).send(receipt);
    },
  );

  /**
   * Receipt lookup. Uses a separate receipt token because the approval token is
   * revoked the moment a decision commits (report §6.2 `/r/{token}/complete`).
   */
  app.get('/public/v1/receipts/:token', { preHandler: readLimit }, async (request, reply) => {
    const { token } = TokenParams.parse(request.params);
    const decision = await app.repos.approvals.findDecisionByReceiptToken(token);
    if (!decision) throw new AppError('NOT_FOUND');

    const tenant = {
      organizationId: decision.organizationId,
      userId: null,
      role: 'SYSTEM' as const,
      requestId: request.requestId,
    };
    const [version, changeOrder, project, organization, document] = await Promise.all([
      app.repos.changeOrders.requireVersion(appContext.uow.db, tenant, decision.versionId),
      app.repos.changeOrders.requireChangeOrder(
        appContext.uow.db,
        tenant,
        (await app.repos.changeOrders.requireVersion(appContext.uow.db, tenant, decision.versionId))
          .changeOrderId,
      ),
      app.repos.projects.requireById(tenant, decision.projectId),
      app.repos.organizations.findById(tenant),
      app.repos.documents.findLatestForVersion(tenant, decision.versionId),
    ]);

    const evidenceUrl =
      document?.status === 'READY' && document.storageKey
        ? await appContext.objectStore.createDownload(
            document.storageKey,
            app.env.SIGNED_URL_TTL_SECONDS,
            `${changeOrder.number}-evidence.pdf`,
          )
        : null;

    return reply.send({
      receiptId: decision.receiptDisplayId,
      decisionId: decision.id,
      type: decision.type,
      signerName: decision.signerName,
      occurredAt: decision.occurredAt.toISOString(),
      assuranceAchieved: decision.assuranceAchieved,
      changeNumber: changeOrder.number,
      versionNumber: version.versionNumber,
      organizationName: organization?.displayName ?? '',
      projectTitle: project.title,
      currency: version.currency,
      totalDeltaMinor: Number(version.totalDeltaMinor),
      revisedContractTotalMinor: Number(
        version.revisedContractTotalMinor ?? project.revisedTotalMinor,
      ),
      evidenceStatus: document?.status ?? 'PENDING',
      evidenceUrl,
    });
  });
}
