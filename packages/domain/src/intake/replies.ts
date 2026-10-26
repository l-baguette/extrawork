import { formatMoney } from '../money/money.js';
import type { IntakeField, ParsedIntake } from './parse-message.js';

/**
 * The messages the employee gets back on WhatsApp.
 *
 * These are the entire user interface for the person raising the request, so
 * they are written the way a colleague would text, not the way an API returns
 * an error. Three rules:
 *
 *   1. Say what was wrong AND show the fix. "Missing cost" is useless on a
 *      site; "Add a line: Cost: 15800" is actionable.
 *   2. Never make them retype what was already understood. If four fields
 *      parsed and one did not, echo the four back and ask only for the fifth.
 *   3. Never claim something was recorded when it was not.
 *
 * Kept short on purpose: long messages get skimmed, and a skimmed error is an
 * unresolved one.
 */

const FIELD_EXAMPLES: Record<IntakeField, string> = {
  company: 'Company: Shree Interiors',
  project: 'Project: Tower 4 Flat 1204',
  description: 'What: Two extra power points in the kitchen',
  reason: 'Why: Client changed the appliance layout',
  amount: 'Cost: 15800',
  days: 'Days: 2',
};

const FIELD_LABEL: Record<IntakeField, string> = {
  company: 'company',
  project: 'project',
  description: 'what the work is',
  reason: 'the reason',
  amount: 'the cost',
  days: 'the time impact',
};

/** The format hint appended to first-time and error replies. */
export const FORMAT_HINT = [
  'Send it like this:',
  '',
  'Project: Tower 4 Flat 1204',
  'What: Two extra power points in the kitchen',
  'Why: Client changed the appliance layout',
  'Cost: 15800',
  'Days: 2',
  '',
  'You can attach photos to the same message.',
].join('\n');

export function unknownSenderReply(): string {
  return [
    'This number is not registered with ExtraWork.',
    '',
    'Ask your site manager to add your WhatsApp number in their ExtraWork dashboard, then send your request again.',
  ].join('\n');
}

export function notAuthorizedForProjectReply(
  projectHint: string | null,
  available: string[],
): string {
  const lines = [
    projectHint
      ? `You are not assigned to "${projectHint}".`
      : 'I could not tell which project this is for.',
  ];
  if (available.length > 0) {
    lines.push('', 'You can raise requests on:');
    for (const name of available.slice(0, 8)) lines.push(`  • ${name}`);
    lines.push('', 'Reply with a line like:  Project: ' + (available[0] ?? 'Tower 4'));
  } else {
    lines.push('', 'You are not assigned to any project yet. Ask your site manager to assign you.');
  }
  return lines.join('\n');
}

export function overCeilingReply(
  amountMinor: bigint,
  ceilingMinor: bigint,
  currency: string,
): string {
  return [
    `That request is ${formatMoney(amountMinor, currency)}, which is above your approval limit of ${formatMoney(ceilingMinor, currency)}.`,
    '',
    'I have not sent it to the client. Ask your site manager to raise it, or to increase your limit.',
  ].join('\n');
}

export function projectClosedReply(projectName: string): string {
  return [
    `"${projectName}" is closed, so no new work can be added to it.`,
    '',
    'Ask your site manager to reopen the project if this is still needed.',
  ].join('\n');
}

/**
 * The most common reply: something is missing. Echo back what was understood so
 * the employee only supplies the gap.
 */
export function incompleteReply(
  parsed: ParsedIntake,
  missing: IntakeField[],
  problems: string[],
  currency: string,
): string {
  const lines: string[] = [];

  if (problems.length > 0) {
    lines.push(...problems);
  } else if (missing.length === 1) {
    lines.push(`Almost there — I just need ${FIELD_LABEL[missing[0] as IntakeField]}.`);
  } else {
    lines.push(`I need a bit more: ${missing.map((f) => FIELD_LABEL[f]).join(', ')}.`);
  }

  const understood = describeUnderstood(parsed, currency);
  if (understood.length > 0) {
    lines.push('', 'I already have:', ...understood.map((line) => `  ${line}`));
  }

  if (missing.length > 0) {
    lines.push('', 'Just send the missing line, for example:');
    for (const field of missing) lines.push(`  ${FIELD_EXAMPLES[field]}`);
  }

  return lines.join('\n');
}

function describeUnderstood(parsed: ParsedIntake, currency: string): string[] {
  const lines: string[] = [];
  if (parsed.project) lines.push(`Project: ${parsed.project}`);
  if (parsed.description) lines.push(`What: ${truncate(parsed.description, 60)}`);
  if (parsed.reason) lines.push(`Why: ${truncate(parsed.reason, 60)}`);
  if (parsed.amountMinor !== null) lines.push(`Cost: ${formatMoney(parsed.amountMinor, currency)}`);
  if (parsed.days !== null) lines.push(`Days: ${parsed.days}`);
  return lines;
}

/**
 * Sent once the request is on its way to the client. States plainly that
 * nothing is approved yet — the employee must not start work on the strength of
 * having sent a message.
 */
export function sentToCustomerReply(input: {
  changeNumber: string;
  projectTitle: string;
  customerName: string;
  amountMinor: bigint;
  days: number;
  currency: string;
}): string {
  return [
    `Sent to ${input.customerName} for approval. ✅`,
    '',
    `${input.changeNumber} · ${input.projectTitle}`,
    `Cost: ${formatMoney(input.amountMinor, input.currency)}`,
    input.days === 0 ? 'No change to the completion date' : `Adds ${input.days} day(s)`,
    '',
    'Nothing is approved yet. I will message you the moment they respond.',
    'Do not start this work until you get that message.',
  ].join('\n');
}

export function decisionReply(input: {
  changeNumber: string;
  projectTitle: string;
  decision: 'APPROVE' | 'DECLINE' | 'REQUEST_REVISION';
  signerName: string;
  comment: string | null;
  amountMinor: bigint;
  currency: string;
  receiptId: string;
}): string {
  const head =
    input.decision === 'APPROVE'
      ? `Approved ✅ — ${input.changeNumber}`
      : input.decision === 'DECLINE'
        ? `Declined ❌ — ${input.changeNumber}`
        : `Changes requested ✏️ — ${input.changeNumber}`;

  const lines = [
    head,
    `${input.projectTitle} · ${formatMoney(input.amountMinor, input.currency)}`,
    `By ${input.signerName}`,
  ];

  if (input.comment) lines.push('', `"${truncate(input.comment, 200)}"`);

  lines.push(
    '',
    input.decision === 'APPROVE'
      ? `You can start this work. Receipt ${input.receiptId}.`
      : input.decision === 'DECLINE'
        ? 'Do not carry out this work.'
        : 'Update the request and send it again.',
  );

  return lines.join('\n');
}

/** Reply to an unrecognised command or a greeting. */
export function helpReply(employeeName: string, projects: string[]): string {
  const lines = [
    `Hi ${employeeName.split(' ')[0]}. Send me extra-work requests here.`,
    '',
    FORMAT_HINT,
  ];
  if (projects.length > 0) {
    lines.push('', 'Your projects:');
    for (const name of projects.slice(0, 8)) lines.push(`  • ${name}`);
  }
  return lines.join('\n');
}

// --- WhatsApp as a project channel (spec 2026-10-12, D6) --------------------
//
// Every reply that files something says where it went and offers the one-word
// correction, because the channel classifies instead of asking "request or
// file?" each time. A wrong guess must cost the sender one word, not a call.

/** A project as the sender sees it in a list: "P-0004 Sharma flat (Alpha Design)". */
export function projectLabel(
  project: { projectNumber: string; title: string; organizationName: string },
  showOrganization: boolean,
): string {
  const base = `${project.projectNumber} ${project.title}`;
  return showOrganization ? `${base} (${project.organizationName})` : base;
}

export function numberedList(labels: string[]): string[] {
  return labels.map((label, index) => `${index + 1}. ${label}`);
}

export function chooseProjectReply(labels: string[]): string {
  return [
    'Which project is this for?',
    '',
    ...numberedList(labels),
    '',
    'Reply with the number. I will hold your message for 30 minutes.',
  ].join('\n');
}

export function choiceOutOfRangeReply(count: number): string {
  return `Reply with a number from 1 to ${count}, so I know which project this is for.`;
}

export function choiceExpiredReply(): string {
  return [
    'I did not hear which project your earlier message was for, so I have not filed it.',
    'Your designer has been told. Send it again with the project number, e.g. P-0004, if it still matters.',
  ].join('\n');
}

export function savedReply(input: {
  what: 'note' | 'file' | 'files';
  projectTitle: string;
}): string {
  const thing =
    input.what === 'note' ? 'your note' : input.what === 'file' ? 'your file' : 'your files';
  return [
    `Saved ${thing} to "${input.projectTitle}" (From WhatsApp). Your designer can see it.`,
    '',
    'Reply REQUEST if this was a change you need.',
  ].join('\n');
}

export function proposedReply(input: { changeNumber: string; projectTitle: string }): string {
  return [
    `Sent to your designer as request ${input.changeNumber} · ${input.projectTitle}.`,
    'They will check it, price it and send it to the homeowner. Nothing is approved yet.',
    '',
    'Reply FILE if this was just for the record.',
  ].join('\n');
}

export function nothingToConvertReply(): string {
  return 'There is nothing recent of yours to change. Send the message again and I will file it.';
}

export function alreadyConvertedReply(kind: 'REQUEST' | 'CONTENT'): string {
  return kind === 'REQUEST'
    ? 'Your last message is already a request with your designer.'
    : 'Your last message is already saved as a file or note.';
}

export function cannotConvertReply(changeNumber: string): string {
  return [
    `${changeNumber} has already gone past your designer's review, so I cannot turn it into a note.`,
    'Ask your designer to withdraw it if it was a mistake.',
  ].join('\n');
}

export function channelHelpReply(name: string, labels: string[]): string {
  const lines = [
    `Hi ${name.split(' ')[0]}. Send me anything about your project here:`,
    '  • a change you need: it goes to your designer to price',
    '  • photos, files or a note: saved to the project',
    '',
    'Words I understand: PROJECTS, STATUS, CONTRACTS, and REQUEST or FILE to correct your last message.',
  ];
  if (labels.length > 0) lines.push('', 'Your projects:', ...numberedList(labels.slice(0, 8)));
  return lines.join('\n');
}

export function projectsReply(labels: string[]): string {
  if (labels.length === 0) return 'You are not on any active project right now.';
  return ['Your projects:', '', ...numberedList(labels.slice(0, 12))].join('\n');
}

export function openRequestsReply(
  groups: Array<{
    label: string;
    requests: Array<{ number: string; title: string; status: string; awaitingReview: boolean }>;
  }>,
): string {
  if (groups.length === 0) return 'You are not on any active project right now.';
  const lines: string[] = [];
  for (const group of groups) {
    lines.push(group.label);
    if (group.requests.length === 0) lines.push('  Nothing open.');
    for (const request of group.requests) {
      const state = request.awaitingReview
        ? 'with the designer'
        : request.status === 'REVISION_REQUESTED'
          ? 'changes asked for'
          : 'waiting for the homeowner';
      lines.push(`  ${request.number} ${truncate(request.title, 50)}: ${state}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function portalLinksReply(links: Array<{ label: string; url: string }>): string {
  if (links.length === 0) return 'You have no active project with us right now.';
  return [
    links.length === 1
      ? 'Here is your project record: every change, the contract value and shared files.'
      : 'Here are your project records: every change, the contract value and shared files.',
    '',
    ...links.flatMap((link) => [link.label, link.url, '']),
    'These links are private to you. Please do not forward them.',
  ].join('\n');
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
