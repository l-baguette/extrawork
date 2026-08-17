import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Loads a repository-root `.env` for local development and tests.
 *
 * Deployed environments inject variables through the platform's secret manager
 * (report §11.3), so this is a no-op there: real environment variables always
 * win, and a missing file is not an error.
 */
export function loadEnvFile(startDir: string = process.cwd()): string | null {
  const explicit = process.env.ENV_FILE;
  const candidates = explicit ? [path.resolve(explicit)] : [];

  let dir = path.resolve(startDir);
  for (let i = 0; i < 6; i += 1) {
    candidates.push(path.join(dir, '.env'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    // Node's own parser; it does not overwrite variables already set.
    process.loadEnvFile(candidate);
    return candidate;
  }
  return null;
}
