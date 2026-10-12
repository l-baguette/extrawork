import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@extrawork/application';

/**
 * Milestones, the calendar and the private ICS feed. Slice C.
 * Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md
 */
export async function registerTimelineRoutes(
  _app: FastifyInstance,
  _appContext: AppContext,
): Promise<void> {}
