import type { AppContext } from '../context.js';

/**
 * The homeowner portal: links, the public projection, change requests from the portal. Slice D.
 * Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md
 */
export class PortalService {
  constructor(readonly app: AppContext) {}
}
