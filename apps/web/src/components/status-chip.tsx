import type { VersionStatus } from '@extrawork/contracts';

/**
 * Status display — report §6.9: "Avoid meaning conveyed only through green/red
 * status colours." Every chip renders its own text label, so the colour is
 * reinforcement rather than the signal.
 */
const LABELS: Record<VersionStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Awaiting decision',
  VIEWED: 'Opened by customer',
  REVISION_REQUESTED: 'Revision requested',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  SUPERSEDED: 'Replaced',
};

const TONES: Record<VersionStatus, string> = {
  DRAFT: 'chip-draft',
  SENT: 'chip-pending',
  VIEWED: 'chip-pending',
  REVISION_REQUESTED: 'chip-pending',
  APPROVED: 'chip-approved',
  DECLINED: 'chip-declined',
  EXPIRED: 'chip-draft',
  CANCELLED: 'chip-draft',
  SUPERSEDED: 'chip-draft',
};

export function StatusChip({ status }: { status: VersionStatus }) {
  return <span className={`chip ${TONES[status]}`}>{LABELS[status]}</span>;
}

export function statusLabel(status: VersionStatus): string {
  return LABELS[status];
}
