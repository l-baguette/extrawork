import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, type ErrorCode } from '@extrawork/contracts';
import { translateDatabaseError } from '@extrawork/db';

/**
 * Single error boundary. Report §7.2: every error is an envelope with a stable
 * machine code, a human-safe message and the request id. Nothing leaks a stack
 * trace, a SQL string or a token.
 */

function zodDetails(error: ZodError): Record<string, unknown> {
  return {
    fields: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    })),
  };
}

export function toAppError(error: unknown): AppError {
  if (AppError.is(error)) return error;

  if (error instanceof ZodError) {
    return new AppError('VALIDATION_FAILED', { details: zodDetails(error) });
  }

  const translated = translateDatabaseError(error);
  if (translated) return translated;

  const fastifyError = error as { statusCode?: number; code?: string; message?: string };
  if (fastifyError?.statusCode === 413 || fastifyError?.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return new AppError('PAYLOAD_TOO_LARGE');
  }
  if (fastifyError?.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return new AppError('UNSUPPORTED_MEDIA_TYPE');
  }
  if (
    fastifyError?.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
    fastifyError?.code === 'FST_ERR_CTP_INVALID_JSON_BODY'
  ) {
    return new AppError('MALFORMED_JSON');
  }
  if (fastifyError?.statusCode === 404) return new AppError('NOT_FOUND');

  return new AppError('INTERNAL_ERROR', { cause: error });
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    const appError = toAppError(error);
    const requestId = request.requestId;

    // Expected (4xx) errors are normal traffic; only 5xx is an incident signal.
    if (appError.expected) {
      request.log.warn(
        { code: appError.code, status: appError.status, route: request.routeOptions?.url },
        appError.message,
      );
    } else {
      request.log.error(
        {
          code: appError.code,
          status: appError.status,
          route: request.routeOptions?.url,
          err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        },
        'Unhandled request failure',
      );
    }

    if (appError.code === 'RATE_LIMITED') {
      const retryAfter = (appError.details?.retryAfterSeconds as number | undefined) ?? 60;
      void reply.header('Retry-After', String(retryAfter));
    }

    void reply.status(appError.status).send(appError.toEnvelope(requestId));
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send(new AppError('NOT_FOUND').toEnvelope(request.requestId));
  });
}

/** Convenience for routes that need to fail with a specific code. */
export function fail(code: ErrorCode, details?: Record<string, unknown>): never {
  throw new AppError(code, details ? { details } : {});
}
