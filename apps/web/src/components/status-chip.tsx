import type { VersionStatus } from '@extrawork/contracts';

/**
 * Status codes — report §6.9: "Avoid meaning conveyed only through green/red
 * status colours."
 *
 * Each status carries three independent cues, in this order of reliability:
 * a **letter** in a square tag, the **written label**, and only then a colour.
 * The letter is the first letter of the label, so the legend teaches itself and
 * a photocopy, a greyscale screen or a colour-blind reader loses nothing.
 *
 * This is the reinforcement-schedule convention: a bundle of steel is tagged
 * with its diameter, not merely painted, because paint fades and the tag is
 * what the fitter actually reads.
 */

interface Code {
  letter: string;
  label: string;
  tone: 'approved' | 'waiting' | 'declined' | 'neutral';
}

const CODES: Record<VersionStatus, Code> = {
  DRAFT: { letter: 'D', label: 'Draft', tone: 'neutral' },
  SENT: { letter: 'W', label: 'Waiting', tone: 'waiting' },
  VIEWED: { letter: 'O', label: 'Opened', tone: 'waiting' },
  REVISION_REQUESTED: { letter: 'R', label: 'Revision', tone: 'waiting' },
  APPROVED: { letter: 'A', label: 'Approved', tone: 'approved' },
  DECLINED: { letter: 'X', label: 'Declined', tone: 'declined' },
  EXPIRED: { letter: 'E', label: 'Expired', tone: 'declined' },
  CANCELLED: { letter: 'C', label: 'Cancelled', tone: 'neutral' },
  SUPERSEDED: { letter: 'S', label: 'Replaced', tone: 'neutral' },
};

/**
 * The legend. Every letter the product can render appears here.
 *
 * It previously taught four letters while nine existed, and mis-stated two of
 * them — it claimed X meant "declined or expired" when EXPIRED emits E, and
 * claimed D covered "replaced" when SUPERSEDED emits S. A legend that does not
 * match the sheet is worse than none: it teaches a reader a code they will then
 * misread. Grouped by tone so the rail stays scannable.
 */
export const LEGEND: Array<{ letter: string; label: string; tone: Code['tone'] }> = [
  { letter: 'N', label: 'Needs review', tone: 'waiting' },
  { letter: 'W', label: 'Waiting', tone: 'waiting' },
  { letter: 'O', label: 'Opened', tone: 'waiting' },
  { letter: 'R', label: 'Revision asked', tone: 'waiting' },
  { letter: 'A', label: 'Approved', tone: 'approved' },
  { letter: 'X', label: 'Declined', tone: 'declined' },
  { letter: 'E', label: 'Expired', tone: 'declined' },
  { letter: 'D', label: 'Draft', tone: 'neutral' },
  { letter: 'C', label: 'Cancelled', tone: 'neutral' },
  { letter: 'S', label: 'Replaced', tone: 'neutral' },
];

export function StatusChip({ status }: { status: VersionStatus }) {
  const code = CODES[status];
  return (
    <span className={`code code-${code.tone}`} data-code={code.letter}>
      {code.label}
    </span>
  );
}

/**
 * A request's status as the designer reads it. A draft raised by somebody else
 * and not yet reviewed is "Needs review" (spec 2026-10-12, D4), not "Draft":
 * it is waiting on the designer, which is the one thing on the sheet they can
 * act on.
 */
export function RequestStatusChip({
  status,
  awaitingReview,
}: {
  status: VersionStatus;
  awaitingReview: boolean;
}) {
  if (status === 'DRAFT' && awaitingReview) {
    return (
      <span className="code code-waiting" data-code="N">
        Needs review
      </span>
    );
  }
  return <StatusChip status={status} />;
}

/** A bare code tag, for the legend and for dense rows. */
export function CodeTag({
  letter,
  label,
  tone,
}: {
  letter: string;
  label: string;
  tone: Code['tone'];
}) {
  return (
    <span className={`code code-${tone}`} data-code={letter}>
      {label}
    </span>
  );
}

export function statusLabel(status: VersionStatus): string {
  return CODES[status].label;
}

export function statusLetter(status: VersionStatus): string {
  return CODES[status].letter;
}
