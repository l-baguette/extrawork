import type { Metadata } from 'next';
import Link from 'next/link';
import { POLICY_VERSION, REFUND_SETTLEMENT_BUSINESS_DAYS } from '@extrawork/contracts';
import { legalIdentity } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Refunds & Cancellation Policy — ExtraWork',
  description:
    'How to cancel an ExtraWork plan, when a refund is due, and how long a refund takes to reach you.',
};

export default function RefundsPage() {
  const identity = legalIdentity();

  return (
    <>
      <section className="card">
        <p className="overline">Effective {POLICY_VERSION}</p>
        <h1>Refunds &amp; Cancellation Policy</h1>
        <p className="muted">
          ExtraWork is a software subscription. There is nothing to ship and nothing to return, so
          this policy covers cancelling a plan and getting money back.
        </p>
      </section>

      <section className="card">
        <h2>1. Cancelling</h2>
        <ul className="stack">
          <li>
            You can cancel at any time from <strong>Settings → Billing</strong>, or by emailing{' '}
            <a href={`mailto:${identity.contactEmail}`}>{identity.contactEmail}</a>. No phone call
            and no retention conversation is required.
          </li>
          <li>
            Cancelling a <strong>monthly plan</strong> stops the next renewal. Your plan keeps
            working until the end of the period you have already paid for.
          </li>
          <li>
            A <strong>project pass</strong> is a one-time purchase for a single project. There is
            nothing recurring to cancel.
          </li>
          <li>
            Cancelling a plan is not the same as deleting your account. Your data stays until you
            close the account — see the <Link href="/legal/privacy">Privacy Policy</Link>.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>2. When we refund</h2>
        <p>We will refund you in full in each of these cases:</p>
        <ul className="stack">
          <li>
            <strong>Duplicate or incorrect charge.</strong> You were billed twice, billed after
            cancelling, or billed the wrong amount. Always refunded in full.
          </li>
          <li>
            <strong>Within 7 days of your first paid charge</strong>, if ExtraWork is not right for
            you. This applies to the first payment on an account, on any plan.
          </li>
          <li>
            <strong>An extended failure of the service</strong> that we could not fix and that
            stopped you using ExtraWork for a material part of the billing period.
          </li>
        </ul>
        <p>
          Outside those cases we do not refund part-used periods — a monthly plan that you cancel
          mid-month runs to the end of that month instead of being refunded pro rata.
        </p>
        <p>
          A <strong>project pass</strong> is refundable within 7 days of purchase provided no change
          request has been sent to a customer under it. Once a request has been sent, the record has
          been produced and the pass has been used.
        </p>
      </section>

      <section className="card">
        <h2>3. How to ask, and how long it takes</h2>
        <ol className="stack">
          <li>
            Email <a href={`mailto:${identity.contactEmail}`}>{identity.contactEmail}</a> from the
            address on the account, with the payment date and amount.
          </li>
          <li>
            We acknowledge within <strong>2 business days</strong> and decide within{' '}
            <strong>5 business days</strong>. If we say no, we tell you exactly why.
          </li>
          <li>
            Approved refunds are sent back to the <strong>original payment method</strong> — we
            cannot redirect a refund to a different card or account — and reach you within{' '}
            <strong>{REFUND_SETTLEMENT_BUSINESS_DAYS} business days</strong> of approval. Your bank
            or card issuer may take a little longer to show it.
          </li>
        </ol>
        <p>
          Refunds are made in Indian Rupees. Any GST charged is refunded with the amount refunded.
        </p>
      </section>

      <section className="card">
        <h2>4. Chargebacks</h2>
        <p>
          If something looks wrong, please write to us before raising a chargeback with your bank —
          it is almost always faster. Where a chargeback is raised on a charge we believe is valid
          we will provide our records to the payment gateway, and we may suspend the account until
          it is resolved.
        </p>
      </section>

      <section className="card">
        <h2>5. Contact</h2>
        <p className="stack">
          <strong>{identity.entityName}</strong>
          <br />
          {identity.address.split('\n').map((line, index) => (
            <span key={index}>
              {line}
              <br />
            </span>
          ))}
          <a href={`mailto:${identity.contactEmail}`}>{identity.contactEmail}</a>
          <br />
          <a href={`tel:${identity.contactPhone.replace(/\s+/g, '')}`}>{identity.contactPhone}</a>
        </p>
      </section>
    </>
  );
}
