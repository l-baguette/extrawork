/**
 * Turns a failure from a CLI into something that tells an operator what to do.
 *
 * This exists because of a specific, easily-repeated waste of time: Node's
 * happy-eyeballs connector raises an `AggregateError` whose own `.message` is
 * an empty string, with the real causes hidden in `.errors[]`. Printing
 * `error.message` therefore produced literally `Migration failed: ` — a message
 * that says nothing at all.
 *
 * Report §7.2 requires human-safe messages with a stable machine code for the
 * API; the same courtesy belongs in the operational commands, which are the
 * first thing anyone runs on a new machine.
 */

export interface DescribedError {
  summary: string;
  /** Concrete next steps, most likely first. Empty when we cannot guess. */
  hints: string[];
}

interface NodeError extends Error {
  code?: string;
  errors?: unknown[];
  detail?: string;
  hint?: string;
  severity?: string;
  routine?: string;
}

function collectCodes(error: unknown, into: Set<string> = new Set()): Set<string> {
  const candidate = error as NodeError | undefined;
  if (!candidate) return into;
  if (candidate.code) into.add(candidate.code);
  if (Array.isArray(candidate.errors)) {
    for (const nested of candidate.errors) collectCodes(nested, into);
  }
  if (candidate.cause) collectCodes(candidate.cause, into);
  return into;
}

function collectMessages(error: unknown, into: string[] = []): string[] {
  const candidate = error as NodeError | undefined;
  if (!candidate) return into;
  if (candidate.message) into.push(candidate.message);
  if (Array.isArray(candidate.errors)) {
    for (const nested of candidate.errors) collectMessages(nested, into);
  }
  if (candidate.cause) collectMessages(candidate.cause, into);
  return into;
}

export function describeError(error: unknown, databaseUrl?: string): DescribedError {
  const codes = collectCodes(error);
  const messages = collectMessages(error).filter(Boolean);
  const where = databaseUrl ? ` DATABASE_URL points at ${redactUrl(databaseUrl)}.` : '';

  // `AggregateError` from the connector: message is empty, causes are nested.
  const summary =
    messages.length > 0
      ? [...new Set(messages)].join('; ')
      : `${(error as Error)?.name ?? 'Error'} (no message provided)`;

  const hints: string[] = [];

  if (codes.has('ECONNREFUSED')) {
    hints.push(
      `Nothing is listening on that address.${where}`,
      'Start PostgreSQL, then retry:',
      '  docker compose up -d db          # if you use Docker',
      '  brew services start postgresql@16   # if you installed it with Homebrew',
      'If your server runs on a non-default port, set DATABASE_URL to match it.',
    );
  }
  if (codes.has('ENOTFOUND') || codes.has('EAI_AGAIN')) {
    hints.push(`The database hostname could not be resolved.${where}`);
  }
  if (codes.has('28P01')) {
    hints.push(
      `The username or password in DATABASE_URL was rejected.${where}`,
      'With the bundled Docker Compose the credentials are postgres/postgres.',
    );
  }
  if (codes.has('3D000')) {
    hints.push(
      `That database does not exist.${where}`,
      'Create it, or run `docker compose up -d db` which creates it for you.',
    );
  }
  if (codes.has('42501')) {
    hints.push(
      'The role lacks permission for this operation.',
      'Migrations run as the owner; only the application runs as the restricted',
      'role created by `pnpm db:harden`.',
    );
  }
  if (codes.has('42883') && messages.some((m) => /extension|function/i.test(m))) {
    hints.push(
      'A required extension is missing. Connect as a superuser and run:',
      '  CREATE EXTENSION IF NOT EXISTS pgcrypto;',
      '  CREATE EXTENSION IF NOT EXISTS pg_trgm;',
      '  CREATE EXTENSION IF NOT EXISTS unaccent;',
    );
  }
  if (codes.has('ETIMEDOUT')) {
    hints.push(
      `The connection timed out.${where}`,
      'Check whether a firewall or the provider access rules allow this client.',
    );
  }

  return { summary, hints };
}

/** Never print a password, even in a local error message. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return url.replace(/\/\/[^@]*@/, '//***@');
  }
}

/** Formats for stderr, with a trailing newline. */
export function formatCliError(prefix: string, error: unknown, databaseUrl?: string): string {
  const { summary, hints } = describeError(error, databaseUrl);
  const lines = [`${prefix}: ${summary}`];
  if (hints.length > 0) lines.push('', ...hints);
  // The stack is genuinely useful when the cause is not a connection problem.
  if (hints.length === 0 && (error as Error)?.stack) {
    lines.push('', (error as Error).stack as string);
  }
  return `${lines.join('\n')}\n`;
}
