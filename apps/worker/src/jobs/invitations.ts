import type { JobRow } from '@extrawork/db';
import type { WorkerContext } from '../context.js';

/**
 * Emails a collaborator invitation — spec 2026-10-12, D1. Slice A.
 */
export async function sendInvitation(_job: JobRow, _ctx: WorkerContext): Promise<void> {}
