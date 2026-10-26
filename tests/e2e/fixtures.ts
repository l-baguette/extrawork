import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = path.resolve(__dirname, '..', '..');
const HELPER = path.join(ROOT, 'packages', 'testkit', 'src', 'seed', 'e2e-helper.ts');

/**
 * E2E fixtures.
 *
 * The browser drives the real UI. Setup and assertions about committed state go
 * through a subprocess helper rather than importing the application directly:
 * Playwright compiles specs to CommonJS and cannot load the ESM workspace
 * packages, and driving the system from outside keeps these tests black-box.
 */

export interface ApprovalLink {
  changeNumber: string;
  url: string;
  changeOrderId: string;
}

export interface SeededProject {
  id: string;
  number: string;
  title: string;
}

export interface Session {
  sessionToken: string;
  csrfToken: string;
}

export interface Scenario {
  organizationId: string;
  ownerUserId: string;
  organizationName: string;
  pendingLinks: ApprovalLink[];
  projects: SeededProject[];
  /** Decisions recorded against one change order. */
  countDecisions(changeOrderId: string): Promise<number>;
  supersede(changeOrderId: string): Promise<void>;
  /** Mints a real session for the given user, active in the given org. */
  signIn(userId: string, organizationId: string): Promise<Session>;
}

async function helper<T>(...args: string[]): Promise<T> {
  const { stdout } = await run(
    process.execPath,
    ['--conditions=development', '--import', 'tsx', HELPER, ...args],
    {
      cwd: ROOT,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  // The helper prints exactly one JSON line; tsx may emit warnings before it.
  const line = stdout
    .trim()
    .split('\n')
    .reverse()
    .find((candidate) => candidate.trim().startsWith('{'));
  if (!line) throw new Error(`Helper produced no JSON output:\n${stdout}`);
  return JSON.parse(line) as T;
}

/** Seeds a fresh demonstration organization and returns its live links. */
export async function seedScenario(): Promise<Scenario> {
  const result = await helper<{
    organizationId: string;
    ownerUserId: string;
    organizationName: string;
    pendingLinks: ApprovalLink[];
    projects: SeededProject[];
  }>('seed');

  return {
    ...result,
    async countDecisions(changeOrderId: string) {
      const { count } = await helper<{ count: number }>('count-decisions', changeOrderId);
      return count;
    },
    async supersede(changeOrderId: string) {
      await helper('supersede', changeOrderId, result.organizationId, result.ownerUserId);
    },
    async signIn(userId: string, organizationId: string) {
      return helper<Session>('sign-in', userId, organizationId);
    },
  };
}
