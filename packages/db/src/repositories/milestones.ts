import type { Database } from '../client.js';

/**
 * Project milestones (migration 0022). Slice C.
 * Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md
 */
export class MilestoneRepository {
  constructor(readonly db: Database) {}
}
