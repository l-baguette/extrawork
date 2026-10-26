import { COLLABORATOR_PARTY_LABELS, type TeamParty } from '@extrawork/contracts';

/**
 * Which firm a site-team member belongs to, as the roster shows it. INTERNAL
 * is the workspace's own firm; the rest read the same as a collaborator's
 * party so one person reads the same wherever they appear.
 */
export const TEAM_PARTY_LABELS: Record<TeamParty, string> = {
  INTERNAL: 'Our firm',
  CONSTRUCTION: COLLABORATOR_PARTY_LABELS.CONSTRUCTION,
  ARCHITECT: COLLABORATOR_PARTY_LABELS.ARCHITECT,
  CONSULTANT: COLLABORATOR_PARTY_LABELS.CONSULTANT,
  OTHER: COLLABORATOR_PARTY_LABELS.OTHER,
};
