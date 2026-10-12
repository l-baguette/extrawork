import type { Database } from '../client.js';

/**
 * Calendar aggregation and private feed tokens (migration 0023). Slice C.
 * Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md
 */
export class CalendarRepository {
  constructor(readonly db: Database) {}
}
