import type { AppContext } from '../context.js';

/**
 * Invitations, collaborators and the people on a project. Slice A.
 * Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md
 */
export class CollaborationService {
  constructor(readonly app: AppContext) {}
}
