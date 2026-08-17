/**
 * Guards for commands that destroy or rewrite data.
 *
 * `APP_ENV` describes the *deployment*, not the *database*. Those were the same
 * thing while every developer ran Postgres on their own machine, and stopped
 * being the same thing the moment `DATABASE_URL` could point at a managed host
 * while `APP_ENV` still said `local`. That combination — a developer's laptop
 * wired to a real database — is precisely the shape of the accident these
 * commands must survive, and an environment label cannot see it.
 *
 * So the question asked here is not "which environment is this?" but "is this
 * database disposable?", answered from the connection string itself.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'postgres', 'db']);

export interface DatabaseTarget {
  host: string;
  database: string;
  isLocal: boolean;
}

export function describeTarget(connectionString: string): DatabaseTarget {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    // An unparseable string is not something to make destructive assumptions
    // about, so it is treated as remote.
    return { host: 'unknown', database: 'unknown', isLocal: false };
  }
  const host = parsed.hostname;
  return {
    host,
    database: parsed.pathname.replace(/^\//, '') || 'unknown',
    isLocal: LOCAL_HOSTS.has(host),
  };
}

/**
 * Refuses a destructive command against a database that is not on this machine,
 * unless the caller sets the named override.
 *
 * The override exists because resetting a genuinely disposable hosted database
 * is a real thing to want. Requiring it to be typed out means the reset of a
 * hosted database is always a decision, never a leftover `.env` value.
 */
export function assertLocalDatabase(
  connectionString: string,
  options: { command: string; overrideEnvVar: string },
): void {
  const target = describeTarget(connectionString);
  if (target.isLocal) return;
  if (process.env[options.overrideEnvVar] === '1') return;

  throw new Error(
    `Refusing to ${options.command} "${target.database}" on "${target.host}".\n` +
      'That database is not on this machine. DATABASE_URL points at a hosted ' +
      'database, and this command destroys data.\n' +
      `If that is genuinely what you want, set ${options.overrideEnvVar}=1.`,
  );
}
