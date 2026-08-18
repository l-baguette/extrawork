import { formatMoney } from '../money/money.js';

/**
 * Native-share message composition — report §10.3 Phase 0.
 *
 * The backend builds the URL and the message text; the contractor sends it from
 * their own WhatsApp account. The system records SHARE_INTENT_OPENED, never
 * MESSAGE_SENT, because it genuinely cannot observe delivery. Overstating this
 * would be the exact kind of dishonest claim the report warns against.
 */

export interface ShareMessageInput {
  organizationName: string;
  customerFirstName: string;
  projectTitle: string;
  changeNumber: string;
  totalDeltaMinor: bigint;
  currency: string;
  scheduleDeltaDays: number;
  approvalUrl: string;
  expiresAt: Date;
  timezone: string;
  note?: string | null;
  /**
   * The contractor's own number, so a customer who is unsure can verify through
   * a channel this message does not control.
   */
  organizationPhone?: string | null;
}

function formatLocalDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * The message a customer receives asking them to approve extra work.
 *
 * Short on purpose. It arrives unprompted, asks about money, and carries a
 * link — the shape of a scam — so the job here is not to explain the whole
 * change but to be recognisable enough that opening the link feels safe. The
 * full scope, line items and schedule effect all live on the page itself.
 *
 * Three things do the work:
 *
 *   - the **customer's name, the contractor's name and the project**, which
 *     together are specific enough that a stranger could not have written it;
 *   - an explicit negative — the link never asks for payment, card details, an
 *     OTP or a login — which gives the reader a rule that still protects them
 *     if someone later imitates this format;
 *   - the **contractor's own phone number**, so anyone unsure can verify
 *     through a channel this message does not control.
 */
export function buildRequestMessage(input: ShareMessageInput): string {
  const amount = formatMoney(input.totalDeltaMinor, input.currency);
  // A deduction is still "additional work"; only the figure changes sign, and
  // a minus sign buried in a sentence reads badly on a phone.
  const amountLine =
    input.totalDeltaMinor < 0n
      ? `Reduced amount: ${amount.replace('-', '')}`
      : `Additional amount: ${amount}`;

  const lines = [
    `Hi ${input.customerFirstName}, ${input.organizationName} has requested your approval ` +
      `for additional work on ${input.projectTitle}.`,
    '',
    amountLine,
  ];

  if (input.note?.trim()) {
    lines.push('', input.note.trim());
  }

  lines.push(
    '',
    'Review the full details and approve, decline, or ask for a change:',
    input.approvalUrl,
    '',
    // The real expiry date, never a hardcoded "one week" — the two must not be
    // able to drift apart.
    `This link is only for you and works until ${formatLocalDate(input.expiresAt, input.timezone)}. ` +
      'It never asks for payment, card details, an OTP, or any account login.',
  );

  lines.push(
    '',
    input.organizationPhone?.trim()
      ? `Call us on ${input.organizationPhone.trim()} if you have any questions.`
      : 'Contact us directly if you have any questions.',
  );

  return lines.join('\n');
}

/**
 * Sanitises one value for a WhatsApp template parameter.
 *
 * Meta rejects the whole send — not the parameter — if a substitution contains
 * a newline, a tab, or more than four consecutive spaces, and rejects an empty
 * one outright. Every value here is user- or customer-supplied (a project title
 * pasted from a spreadsheet is the likely culprit), so the cleaning happens
 * once, centrally, rather than being a rule each caller has to remember.
 */
function templateParameter(value: string, fallback: string): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Ordered `{{1}}..{{7}}` substitutions for the `extra_work_request_v1` utility
 * template — report §10.3, handoff §14.
 *
 * **This is the one place the approved template's parameter order is encoded.**
 * Meta can reword or reorder a template during review, and code that disagrees
 * with the approved copy sends the customer a sentence with the amount where
 * the project name should be. When the template comes back approved, reconcile
 * it here and nowhere else.
 *
 *   1 customer name   2 company name   3 project name   4 formatted amount
 *   5 approval link   6 expiry date    7 company phone
 *
 * If Meta approves the URL-button variant instead, the link stops being a body
 * parameter: drop position 5 from this array and pass `approvalUrl`'s token
 * suffix as `urlButtonParameter` on the outbound message. Nothing else changes.
 *
 * It takes the same `ShareMessageInput` as `buildRequestMessage` on purpose. The
 * plain-text message and the template are two renderings of one message, and
 * deriving them from different inputs is how they quietly stop agreeing about
 * the amount.
 */
export function buildRequestTemplateParameters(input: ShareMessageInput): string[] {
  const amount = formatMoney(input.totalDeltaMinor, input.currency);
  return [
    templateParameter(input.customerFirstName, 'there'),
    templateParameter(input.organizationName, 'Your contractor'),
    templateParameter(input.projectTitle, 'your project'),
    // The sign is carried by the wording in the approved copy, not by a minus
    // buried mid-sentence — same rule as the plain-text message above.
    templateParameter(input.totalDeltaMinor < 0n ? amount.replace('-', '') : amount, '—'),
    templateParameter(input.approvalUrl, '—'),
    templateParameter(formatLocalDate(input.expiresAt, input.timezone), '—'),
    // Meta rejects an empty parameter, so a contractor with no number on record
    // still needs something here. It says to use the link rather than inventing
    // a phone number the customer could try to call.
    templateParameter(input.organizationPhone ?? '', 'the number on your invoice'),
  ];
}

export function buildReminderMessage(input: ShareMessageInput): string {
  const amount = formatMoney(input.totalDeltaMinor, input.currency);
  return [
    `Hi ${input.customerFirstName}, a quick reminder from ${input.organizationName}.`,
    '',
    `${input.changeNumber} on ${input.projectTitle} (${amount}) is still waiting for your decision.`,
    '',
    input.approvalUrl,
    '',
    `The link expires on ${formatLocalDate(input.expiresAt, input.timezone)}.`,
  ].join('\n');
}

export interface DecisionReceiptMessageInput {
  organizationName: string;
  customerFirstName: string;
  changeNumber: string;
  projectTitle: string;
  decisionType: 'APPROVE' | 'DECLINE' | 'REQUEST_REVISION';
  receiptId: string;
  occurredAt: Date;
  timezone: string;
}

export function buildDecisionReceiptMessage(input: DecisionReceiptMessageInput): string {
  const verb =
    input.decisionType === 'APPROVE'
      ? 'approved'
      : input.decisionType === 'DECLINE'
        ? 'declined'
        : 'sent back for revision';
  return [
    `Hi ${input.customerFirstName}, thank you.`,
    '',
    `You ${verb} ${input.changeNumber} on ${input.projectTitle} on ${formatLocalDate(input.occurredAt, input.timezone)}.`,
    `Your receipt reference is ${input.receiptId}.`,
    '',
    `— ${input.organizationName}`,
  ].join('\n');
}

/**
 * Ordered substitutions for `extra_work_decision_receipt_v1`.
 *
 *   1 customer name   2 company name   3 change number
 *   4 project name    5 what they did  6 receipt reference
 *
 * Same reconciliation rule as the request template: when Meta approves the
 * wording, this array is the only place the order lives.
 */
export function buildDecisionReceiptTemplateParameters(
  input: DecisionReceiptMessageInput,
): string[] {
  const verb =
    input.decisionType === 'APPROVE'
      ? 'approved'
      : input.decisionType === 'DECLINE'
        ? 'declined'
        : 'sent back for revision';
  return [
    templateParameter(input.customerFirstName, 'there'),
    templateParameter(input.organizationName, 'Your contractor'),
    templateParameter(input.changeNumber, '—'),
    templateParameter(input.projectTitle, 'your project'),
    templateParameter(verb, 'recorded'),
    templateParameter(input.receiptId, '—'),
  ];
}

/**
 * `https://wa.me/{phone}?text={urlEncodedMessage}` — report §10.3. The phone is
 * digits only, without the leading plus.
 */
export function buildWhatsAppShareUrl(phoneE164: string | null, message: string): string | null {
  const digits = phoneE164?.replace(/\D/g, '');
  const text = encodeURIComponent(message);
  if (!digits) return `https://wa.me/?text=${text}`;
  return `https://wa.me/${digits}?text=${text}`;
}

export function buildSmsUrl(phoneE164: string | null, message: string): string | null {
  if (!phoneE164) return null;
  return `sms:${phoneE164}?&body=${encodeURIComponent(message)}`;
}

export function buildMailtoUrl(
  email: string | null,
  subject: string,
  message: string,
): string | null {
  if (!email) return null;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
}

export function requestEmailSubject(changeNumber: string, projectTitle: string): string {
  return `Approval needed: ${changeNumber} on ${projectTitle}`;
}
