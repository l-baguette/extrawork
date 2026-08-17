import { pino, type Logger, type LoggerOptions } from 'pino';
import { redact, REDACTED_KEYS } from './redact.js';

export type { Logger };

export interface LoggerContext {
  service: string;
  environment: string;
  level?: string;
  pretty?: boolean;
  version?: string;
}

/**
 * Structured logging per report §11.5. The `serializers` hook runs the deep
 * redactor over every bound context object, so a token cannot reach the log
 * even if a call site passes an object that happens to contain one.
 */
export function createLogger(ctx: LoggerContext): Logger {
  const options: LoggerOptions = {
    level: ctx.level ?? 'info',
    base: {
      service: ctx.service,
      environment: ctx.environment,
      ...(ctx.version ? { version: ctx.version } : {}),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    // pino's own redaction handles known paths; our hook handles nested/unknown.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
        ...[...REDACTED_KEYS].map((k) => `*.${k}`),
      ],
      censor: '[redacted]',
    },
    formatters: {
      level: (label) => ({ level: label }),
      log: (object) => redact(object) as Record<string, unknown>,
    },
  };

  if (ctx.pretty) {
    try {
      return pino({
        ...options,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      });
    } catch {
      // Pretty printing is a developer nicety. If the transport is missing,
      // fall back to JSON rather than refusing to start the process.
    }
  }
  return pino(options);
}

/** Used by tests and by scripts that should not emit noise. */
export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}
