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

export interface Scenario {
  organizationId: string;
  ownerUserId: string;
  organizationName: string;
  pendingLinks: ApprovalLink[];
  /** Decisions recorded against one change order. */
  countDecisions(changeOrderId: string): Promise<number>;
  supersede(changeOrderId: string): Promise<void>;
}

async function helper<T>(...args: string[]): Promise<T> {
  const { stdout } = await run('npx', ['tsx', HELPER, ...args], {
    cwd: ROOT,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
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
  };
}
