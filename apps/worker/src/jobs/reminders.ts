import type { JobRow } from '@extrawork/db';
import type { WorkerContext } from '../context.js';

/**
 * Daily milestone and completion-date reminders — spec 2026-10-12, D14.
 *
 * The rules live in `TimelineService.sendDueReminders` so the API and the
 * worker cannot disagree about them; this handler only runs the sweep. It is
 * safe to run more than once a day: every notification it writes carries a
 * dedupe key per person, item and due date.
 */
export async function sendDueReminders(job: JobRow, ctx: WorkerContext): Promise<void> {
  const written = await ctx.services.timeline.sendDueReminders(ctx.app.clock.now());
  ctx.logger.info({ jobId: job.id, written }, 'due reminders swept');
}
