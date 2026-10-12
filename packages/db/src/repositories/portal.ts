import type { Database } from '../client.js';

/**
 * Homeowner portal links (migration 0023). Slice D.
 * Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md
 */
export class PortalRepository {
  constructor(readonly db: Database) {}
}
