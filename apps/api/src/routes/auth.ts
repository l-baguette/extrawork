import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AppError, CreateOrganizationSchema, EmailSchema } from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import { RATE_LIMITS } from '@extrawork/db';
import { CSRF_COOKIE, SESSION_COOKIE } from '../plugins/context.js';
import { ipSubject, rateLimit } from '../plugins/rate-limit.js';

/**
 * Authentication and organization onboarding.
 *
 * Report §6.5: "Sessions use secure, HTTP-only, SameSite=Lax cookies; do not
 * store bearer access tokens in local storage." The CSRF token is a separate,
 * readable cookie whose value must be echoed in `X-CSRF-Token` on mutations.
 */

const RequestSignInSchema = z.object({ email: EmailSchema });
const VerifySignInSchema = z.object({ token: z.string().min(16).max(512) });
const SwitchOrganizationSchema = z.object({ organizationId: z.string().uuid() });
const RegisterSchema = z.object({
  email: EmailSchema,
  // Length is checked properly in the domain, which owns the policy; this is
  // only the wire-shape bound.
  password: z.string().min(1).max(200),
  displayName: z.string().trim().max(120).default(''),
});
const PasswordSignInSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(200),
});
const GoogleCallbackSchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(200).optional(),
});

export function setSessionCookies(
  reply: FastifyReply,
  secure: boolean,
  session: { sessionToken: string; csrfToken: string; expiresAt: Date },
): void {
  const maxAge = Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));

  void reply.setCookie(SESSION_COOKIE, session.sessionToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  // Readable by the SPA so it can echo the value; the pair is what proves the
  // request came from our own page, not a cross-site form.
  void reply.setCookie(CSRF_COOKIE, session.csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  appContext: AppContext,
): Promise<void> {
  const secure = app.env.APP_ENV !== 'local';
  const limiter = app.repos.rateLimiter;

  app.post(
    '/v1/auth/sign-in',
    { preHandler: rateLimit(limiter, { name: 'AUTH_MAGIC_LINK', subject: ipSubject }) },
    async (request, reply) => {
      const { email } = RequestSignInSchema.parse(request.body);
      await app.services.auth.requestSignIn(email);
      // Always the same answer: revealing whether an address exists would be an
      // account-enumeration oracle (report §12.2).
      return reply.status(202).send({
        status: 'sent',
        message: 'If that address belongs to an ExtraWork user, a sign-in link is on its way.',
      });
    },
  );

  /**
   * Which sign-in methods this deployment actually offers, so the page never
   * renders a control that cannot work.
   */
  app.get('/v1/auth/methods', async (_request, reply) =>
    reply.send({
      password: true,
      magicLink: app.env.AUTH_DRIVER === 'local',
      google: app.services.google !== null,
    }),
  );

  app.post(
    '/v1/auth/register',
    { preHandler: rateLimit(limiter, { name: 'AUTH_MAGIC_LINK', subject: ipSubject }) },
    async (request, reply) => {
      const input = RegisterSchema.parse(request.body);
      await app.services.auth.register(input);

      // Deliberately identical whether the account was created or the address
      // was already taken (report §12.2). A signup form that says "already
      // registered" is a way to test which addresses exist.
      return reply.status(202).send({
        status: 'ok',
        message: 'Your account is ready. Sign in with your email and password.',
      });
    },
  );

  app.post(
    '/v1/auth/password',
    { preHandler: rateLimit(limiter, { name: 'AUTH_MAGIC_LINK', subject: ipSubject }) },
    async (request, reply) => {
      const { email, password } = PasswordSignInSchema.parse(request.body);
      const identity = await app.services.auth.verifyPassword(email, password);
      if (!identity) {
        // One message for a wrong address and a wrong password alike.
        throw new AppError('UNAUTHENTICATED', {
          message: 'That email and password do not match an account.',
        });
      }

      const session = await app.services.auth.startSessionFor(identity, {
        ipHash: request.publicCtx.ipHash,
        userAgent: request.publicCtx.userAgent,
      });
      setSessionCookies(reply, secure, session);
      return reply.status(200).send({
        userId: session.userId,
        activeOrganizationId: session.activeOrganizationId,
      });
    },
  );

  // --- Continue with Google -------------------------------------------------

  /** Short-lived cookies holding the CSRF state and the PKCE verifier. */
  const OAUTH_STATE = 'ew_oauth_state';
  const OAUTH_VERIFIER = 'ew_oauth_verifier';

  app.get(
    '/v1/auth/google/start',
    { preHandler: rateLimit(limiter, { name: 'AUTH_MAGIC_LINK', subject: ipSubject }) },
    async (_request, reply) => {
      const google = app.services.google;
      if (!google) {
        throw new AppError('NOT_IMPLEMENTED', {
          message: 'Google sign-in is not configured on this deployment.',
        });
      }

      const { authorizeUrl, state, codeVerifier } = google.start();
      // HTTP-only: the browser must carry these back but no script needs them,
      // and the verifier in particular is what makes PKCE worth having.
      const cookie = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge: 600 };
      void reply.setCookie(OAUTH_STATE, state, cookie);
      void reply.setCookie(OAUTH_VERIFIER, codeVerifier, cookie);
      return reply.redirect(authorizeUrl);
    },
  );

  app.get(
    '/v1/auth/google/callback',
    { preHandler: rateLimit(limiter, { name: 'AUTH_MAGIC_LINK', subject: ipSubject }) },
    async (request, reply) => {
      const google = app.services.google;
      if (!google) throw new AppError('NOT_IMPLEMENTED');

      const query = GoogleCallbackSchema.parse(request.query);
      const expectedState = request.cookies?.[OAUTH_STATE];
      const verifier = request.cookies?.[OAUTH_VERIFIER];

      void reply.clearCookie(OAUTH_STATE, { path: '/' });
      void reply.clearCookie(OAUTH_VERIFIER, { path: '/' });

      // A mismatched or missing state means this callback was not started by
      // this browser — the whole point of the parameter.
      if (!expectedState || !verifier || query.state !== expectedState) {
        throw new AppError('CSRF_FAILED', {
          message: 'That sign-in could not be verified. Please start again.',
        });
      }
      if (query.error || !query.code) {
        return reply.redirect(`${app.env.WEB_PUBLIC_URL}/sign-in?error=google_cancelled`);
      }

      const profile = await google.complete(query.code, verifier);
      const session = await app.services.auth.signInWithGoogle(profile, {
        ipHash: request.publicCtx.ipHash,
        userAgent: request.publicCtx.userAgent,
      });
      setSessionCookies(reply, secure, session);
      return reply.redirect(`${app.env.WEB_PUBLIC_URL}/app/dashboard`);
    },
  );

  app.post(
    '/v1/auth/verify',
    { preHandler: rateLimit(limiter, { name: 'AUTH_MAGIC_LINK', subject: ipSubject }) },
    async (request, reply) => {
      const { token } = VerifySignInSchema.parse(request.body);
      const session = await app.services.auth.completeSignIn(token, {
        ipHash: request.publicCtx.ipHash,
        userAgent: request.publicCtx.userAgent,
      });
      setSessionCookies(reply, secure, session);
      return reply.status(200).send({
        userId: session.userId,
        activeOrganizationId: session.activeOrganizationId,
        expiresAt: session.expiresAt.toISOString(),
      });
    },
  );

  app.post('/v1/auth/sign-out', async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    if (auth.sessionId) await app.services.auth.signOut(auth.sessionId);
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    void reply.clearCookie(CSRF_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/v1/auth/me', async (request, reply) => {
    const sessionToken = request.cookies?.[SESSION_COOKIE];
    if (!sessionToken) throw new AppError('UNAUTHENTICATED');
    const session = await app.repos.identity.resolveSession(sessionToken);
    if (!session) throw new AppError('SESSION_EXPIRED');

    const [user, memberships] = await Promise.all([
      app.repos.identity.findUserById(session.userId),
      app.repos.identity.listMemberships(session.userId),
    ]);
    if (!user) throw new AppError('UNAUTHENTICATED');

    return reply.send({
      user: { id: user.id, email: user.emailNormalized, displayName: user.displayName },
      memberships: memberships.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organizationName,
        role: m.role,
      })),
      activeOrganizationId: session.activeOrganizationId,
    });
  });

  app.post('/v1/auth/switch-organization', async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { organizationId } = SwitchOrganizationSchema.parse(request.body);

    // Every actor reaching this route came from a session, so `userId` is set.
    // Guarding rather than asserting keeps a userless actor (a WhatsApp intake)
    // from ever silently switching an organization if the surfaces are wired
    // together differently later.
    if (!auth.actor.userId) throw new AppError('UNAUTHENTICATED');

    const membership = await app.repos.identity.getMembership(organizationId, auth.actor.userId);
    if (!membership || membership.status !== 'ACTIVE') throw new AppError('NOT_A_MEMBER');

    await appContext.uow.transaction(async (tx) => {
      if (auth.sessionId) {
        await app.repos.identity.setActiveOrganization(tx, auth.sessionId, organizationId);
      }
    });
    return reply.send({ activeOrganizationId: organizationId });
  });

  /**
   * Onboarding. Authenticated but deliberately not organization-scoped: this is
   * how a user acquires their first organization.
   */
  app.post('/v1/organizations', async (request, reply) => {
    const sessionToken = request.cookies?.[SESSION_COOKIE];
    if (!sessionToken) throw new AppError('UNAUTHENTICATED');
    const session = await app.repos.identity.resolveSession(sessionToken);
    if (!session) throw new AppError('SESSION_EXPIRED');

    const csrfToken = request.headers['x-csrf-token'];
    if (typeof csrfToken !== 'string' || !app.repos.identity.verifyCsrf(session, csrfToken)) {
      throw new AppError('CSRF_FAILED');
    }

    const input = CreateOrganizationSchema.parse(request.body);
    const result = await app.services.auth.createOrganization(session.userId, request.requestId, {
      displayName: input.displayName,
      legalName: input.legalName ?? null,
      gstin: input.gstin ?? null,
      timezone: input.timezone,
      defaultCurrency: input.defaultCurrency,
    });

    await appContext.uow.transaction(async (tx) => {
      await app.repos.identity.setActiveOrganization(tx, session.id, result.organizationId);
    });

    return reply.status(201).send({ id: result.organizationId });
  });

  app.log.debug({ authLimit: RATE_LIMITS.AUTH_MAGIC_LINK.limit }, 'auth routes registered');
}
