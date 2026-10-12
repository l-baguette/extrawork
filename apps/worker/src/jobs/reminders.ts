import type { JobRow } from '@extrawork/db';
import type { WorkerContext } from '../context.js';

/**
 * Daily milestone and completion-date reminders — spec 2026-10-12, D14. Slice C.
 */
export async function sendDueReminders(_job: JobRow, _ctx: WorkerContext): Promise<void> {}
