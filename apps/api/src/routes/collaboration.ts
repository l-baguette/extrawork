import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@extrawork/application';

/**
 * Collaborators, invitations and the people on a project. Slice A.
 * Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md
 */
export async function registerCollaborationRoutes(
  _app: FastifyInstance,
  _appContext: AppContext,
): Promise<void> {}
