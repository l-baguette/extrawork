import type { Metadata } from 'next';
import Link from 'next/link';
import { legalIdentity } from '@/lib/legal';
import { DocHeader } from '../doc-header';

export const metadata: Metadata = {
  title: 'Terms of Service — ExtraWork',
  description:
    'The agreement between you and ExtraWork: what the service does, what it does not do, fees, liability and termination.',
};

export default function TermsPage() {
  const identity = legalIdentity();

  return (
    <>
      <DocHeader
        code="TERMS"
        title="Terms of Service"
        standfirst={
          <>
            These terms are the agreement between you and <strong>{identity.entityName}</strong>{' '}
            (&ldquo;ExtraWork&rdquo;, &ldquo;we&rdquo;) for use of the ExtraWork service. By
            creating an account or using the service you accept them. If you are accepting on behalf
            of a business, you confirm you are authorised to bind that business.
          </>
        }
      />

      <section>
        <h2>1. What ExtraWork is — and what it is not</h2>
        <p>
          ExtraWork is a <strong>record-keeping tool</strong>. It lets a contractor describe work
          that falls outside an agreed scope, price it, send it to their customer for a decision,
          and keep a tamper-evident record of what was sent and what was decided.
        </p>
        <p className="banner banner-info">
          <strong>We are not a party to your contract.</strong> The agreement about the extra work
          is between you and your customer. ExtraWork records what happened; it does not create,
          interpret, guarantee, enforce or arbitrate that agreement.
        </p>
        <ul className="stack">
          <li>
            <strong>We do not provide legal advice.</strong> Nothing in the product or its documents
            is legal advice. Whether a particular record is sufficient for your contract, your
            jurisdiction or your dispute is a question for your own lawyer.
          </li>
          <li>
            <strong>We do not guarantee enforceability.</strong> We describe honestly what each
            record is and how it was captured, so that you and a court can judge its weight. We do
            not promise any particular outcome in a dispute, adjudication or arbitration.
          </li>
          <li>
            <strong>We do not verify the truth of what you enter.</strong> Scope, quantities,
            prices, tax rates and schedule impacts are yours. We compute totals from the figures you
            give us.
          </li>
          <li>
            <strong>We are not a payment service.</strong> ExtraWork does not collect your
            customer&rsquo;s money or handle your invoicing.
          </li>
        </ul>
      </section>

      <section>
        <h2>2. Assurance levels: what an approval actually proves</h2>
        <p>
          Every approval is labelled with the strength of the evidence behind it, and we use those
          labels literally.
        </p>
        <ul className="stack">
          <li>
            <strong>A0 — Secure link assent.</strong> The person who held a private link opened it,
            typed a name, and confirmed a statement of authority and assent. It records an act; it
            does not verify identity.
          </li>
          <li>
            <strong>A1 — Phone-verified assent.</strong> As A0, plus a one-time code delivered to a
            phone number recorded before the request was sent.
          </li>
          <li>
            <strong>A2 — Licensed electronic signature.</strong>{' '}
            <strong>ExtraWork does not currently offer A2.</strong> We will not describe an A0 or A1
            record as a licensed or certified signature, and a request for A2 is refused outright
            rather than quietly downgraded.
          </li>
        </ul>
        <p>
          You are responsible for deciding whether the assurance level you choose is appropriate for
          the value and risk of the change.
        </p>
      </section>

      <section>
        <h2>3. Your account</h2>
        <ul className="stack">
          <li>You must be at least 18 and using ExtraWork for a business purpose.</li>
          <li>
            You are responsible for everything done under your account, for keeping your password
            secret, and for removing team members who leave. Tell us immediately at{' '}
            <a href={`mailto:${identity.contactEmail}`}>{identity.contactEmail}</a> if you think an
            account has been compromised.
          </li>
          <li>
            Information you give us — your business name, GSTIN and contact details — must be
            accurate and kept up to date. It appears on records your customers rely on.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Your data and your customers&rsquo; data</h2>
        <ul className="stack">
          <li>
            <strong>You own your content.</strong> Projects, change requests, attachments and
            evidence belong to you. We claim no ownership of them.
          </li>
          <li>
            We hold your customers&rsquo; personal data as your processor, on your instruction. You
            confirm you have the right to enter that data and to contact those people about the
            work.
          </li>
          <li>
            You grant us the limited licence needed to host, process, transmit, back up and display
            your content in order to run the service for you — and nothing beyond that.
          </li>
          <li>
            You can export your data at any time, including after your account is closed and during
            the recovery window. Export is never withheld for non-payment.
          </li>
          <li>
            How we handle personal data is set out in the{' '}
            <Link href="/legal/privacy">Privacy Policy</Link>.
          </li>
        </ul>
      </section>

      <section>
        <h2>5. Acceptable use</h2>
        <p>You must not:</p>
        <ul className="stack">
          <li>
            use ExtraWork to create a false, forged or backdated record, or to misrepresent what a
            customer agreed to;
          </li>
          <li>
            send requests to people who have not agreed to hear from you, or use the service for
            bulk unsolicited messaging;
          </li>
          <li>upload malware, or content that is unlawful, obscene, defamatory or infringing;</li>
          <li>
            probe, scan, overload or attempt to bypass the security or tenancy boundaries of the
            service;
          </li>
          <li>scrape, resell or white-label the service without our written agreement;</li>
          <li>
            use the service in breach of Indian law, including the Information Technology Act, 2000
            and the rules under it.
          </li>
        </ul>
        <p>
          We may suspend an account immediately where we reasonably believe it is being used to
          break this section, and will tell you why.
        </p>
      </section>

      <section>
        <h2>6. Plans, fees and taxes</h2>
        <ul className="stack">
          <li>
            Current plans and prices are shown in the app. Subscription plans are billed in advance
            for each period; a project pass is a one-time charge.
          </li>
          <li>Prices are in Indian Rupees and exclusive of GST unless stated otherwise.</li>
          <li>
            Card and payment details are handled by our payment gateway. We never receive or store
            your card number.
          </li>
          <li>
            Refunds and cancellation are governed by the{' '}
            <Link href="/legal/refunds">Refunds &amp; Cancellation Policy</Link>.
          </li>
          <li>
            If payment fails or lapses, an account may move to a read-only state. Even then you keep
            the right to read and export your evidence — we will not hold your contractual records
            hostage to a billing dispute.
          </li>
        </ul>
      </section>

      <section>
        <h2>7. Availability</h2>
        <p>
          We work to keep ExtraWork available and will give notice of planned maintenance where we
          reasonably can. We do not promise uninterrupted or error-free service unless we have
          signed a separate service-level agreement with you. Third-party networks we depend on —
          including WhatsApp, email providers and hosting — can fail in ways outside our control.
        </p>
      </section>

      <section>
        <h2>8. Warranties and disclaimers</h2>
        <p>
          We provide ExtraWork with reasonable skill and care. Beyond that, and to the fullest
          extent permitted by law, the service is provided <strong>&ldquo;as is&rdquo;</strong> and
          we disclaim all other warranties, express or implied, including merchantability, fitness
          for a particular purpose, and non-infringement.
        </p>
        <p>
          Nothing in these terms excludes or limits liability that cannot lawfully be excluded —
          including for fraud, or for death or personal injury caused by negligence. If you are a
          consumer under the Consumer Protection Act, 2019, your statutory rights are unaffected.
        </p>
      </section>

      <section>
        <h2>9. Limitation of liability</h2>
        <p>To the fullest extent permitted by law:</p>
        <ul className="stack">
          <li>
            Neither party is liable for indirect, incidental, special or consequential loss, or for
            loss of profit, revenue, goodwill or anticipated savings.
          </li>
          <li>
            Our total aggregate liability arising out of or relating to these terms, in any twelve
            month period, is limited to the greater of (a) the fees you paid us for the service in
            the twelve months before the event giving rise to the claim, or (b) INR 10,000.
          </li>
          <li>
            <strong>
              We are not liable for the commercial outcome of any change request, dispute or claim
              between you and your customer
            </strong>{' '}
            — including a payment your customer refuses, a variation a court declines to enforce, or
            a decision a customer later disputes.
          </li>
        </ul>
      </section>

      <section>
        <h2>10. Indemnity</h2>
        <p>
          You will indemnify us against claims, losses and reasonable legal costs arising from your
          content, your use of the service in breach of these terms, or a claim by one of your
          customers that you had no right to hold or contact them about their data.
        </p>
      </section>

      <section>
        <h2>11. Suspension, termination and what survives</h2>
        <ul className="stack">
          <li>You may close your account at any time from Settings, or by writing to us.</li>
          <li>
            We may terminate for material breach that is not fixed within 14 days of us telling you
            about it, or immediately for the conduct in section 5.
          </li>
          <li>
            On closure we keep your account recoverable for 30 days, then purge it, subject to any
            legal hold. The retention and erasure rules in the{' '}
            <Link href="/legal/privacy">Privacy Policy</Link> apply — in particular, recorded
            decisions are not deleted on request.
          </li>
          <li>Sections 4 (data ownership), 8, 9, 10, 12 and this section survive termination.</li>
        </ul>
      </section>

      <section>
        <h2>12. Governing law and disputes</h2>
        <p>
          These terms are governed by the laws of India. Before starting formal proceedings, both of
          us agree to try to resolve the dispute in good faith by writing to the other — you to{' '}
          <a href={`mailto:${identity.contactEmail}`}>{identity.contactEmail}</a> — and allowing 30
          days for a response.
        </p>
        <p>
          A dispute that is not resolved that way will be referred to arbitration by a sole
          arbitrator under the Arbitration and Conciliation Act, 1996. The seat and venue is the
          city of our registered office and the language is English. Subject to that, the courts at
          the place of our registered office have exclusive jurisdiction.
        </p>
      </section>

      <section>
        <h2>13. Changes to these terms</h2>
        <p>
          We may update these terms. If a change materially affects your rights we will email
          account holders at least 14 days before it takes effect. If you do not accept the change,
          your remedy is to stop using the service and close your account before that date.
        </p>
      </section>
    </>
  );
}
