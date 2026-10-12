import type { AppContext } from '../context.js';

/**
 * Project folders, files, links and notes. Slice C.
 * Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md
 */
export class WorkspaceService {
  constructor(readonly app: AppContext) {}
}
