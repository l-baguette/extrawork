import type { Database } from '../client.js';

/**
 * WhatsApp conversation state (migration 0023), system scope only. Slice D.
 * Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md
 */
export class ConversationRepository {
  constructor(readonly db: Database) {}
}
