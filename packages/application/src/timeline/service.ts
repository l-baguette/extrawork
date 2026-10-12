import type { AppContext } from '../context.js';

/**
 * Milestones, the collated calendar, the private ICS feed and due reminders. Slice C.
 * Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md
 */
export class TimelineService {
  constructor(readonly app: AppContext) {}
}
