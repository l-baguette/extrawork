import type { Database } from '../client.js';

/**
 * Collaborators and project invitations (migration 0020). Slice A.
 * Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md
 */
export class CollaborationRepository {
  constructor(readonly db: Database) {}
}
