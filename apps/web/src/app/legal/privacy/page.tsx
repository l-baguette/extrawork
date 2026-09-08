import type { Metadata } from 'next';
import Link from 'next/link';
import { ACCOUNT_DELETION_GRACE_DAYS } from '@extrawork/contracts';
import { legalIdentity } from '@/lib/legal';
import { DocHeader } from '../doc-header';

export const metadata: Metadata = {
  title: 'Privacy Policy — ExtraWork',
  description:
    'How ExtraWork collects, uses, retains and erases personal data, and how to exercise your rights under the Digital Personal Data Protection Act, 2023.',
};

export default function PrivacyPolicyPage() {
  const identity = legalIdentity();

  return (
    <>
      <DocHeader
        code="PRIVACY"
        title="Privacy Policy"
        standfirst={
          <>
            This policy explains what personal data ExtraWork handles, why, for how long, and what
            you can ask us to do about it. It is written to the Digital Personal Data Protection
            Act, 2023 (&ldquo;DPDP Act&rdquo;) and the Information Technology Act, 2000.
          </>
        }
      />

      <section>
        <h2>1. Who is responsible for your data</h2>
        <p>
          ExtraWork is operated by <strong>{identity.entityName}</strong>, registered at{' '}
          {identity.address.split('\n').map((line, index) => (
            <span key={index}>
              {line}
              {index < identity.address.split('\n').length - 1 ? ', ' : ''}
            </span>
          ))}
          .
        </p>
        <p>
          <strong>Two different roles, and the difference matters.</strong>
        </p>
        <ul className="stack">
          <li>
            For the <strong>contractor</strong> who holds an ExtraWork account — the business owner
            and their team — we are the <strong>Data Fiduciary</strong>. We decide how that account
            data is handled, and this policy governs it.
          </li>
          <li>
            For a <strong>customer or approver</strong> whose name, phone number or approval
            decision appears inside a contractor&rsquo;s account, the contractor is normally the
            Data Fiduciary and we are their <strong>Data Processor</strong>. We hold that data on
            the contractor&rsquo;s instruction. If you are a customer and want your data changed or
            removed, contact the contractor who sent you the approval link. You can also contact us
            (section 8) and we will pass the request on and tell you we have done so.
          </li>
        </ul>
      </section>

      <section>
        <h2>2. What we collect</h2>
        <p>We collect only what the service cannot work without.</p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Why we hold it</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Your name and email address</td>
                <td>To create your account, sign you in, and send service email.</td>
              </tr>
              <tr>
                <td>A cryptographic hash of your password</td>
                <td>
                  To verify sign-in. We never store the password itself and cannot recover or read
                  it.
                </td>
              </tr>
              <tr>
                <td>
                  Your business details — trading name, registered name, GSTIN, address, phone
                </td>
                <td>To identify your business on the change requests and evidence you issue.</td>
              </tr>
              <tr>
                <td>Your customers and their contacts — name, phone number, email</td>
                <td>
                  To address a change request to the right person and prove who approved it. Entered
                  by you, on your instruction.
                </td>
              </tr>
              <tr>
                <td>Your site staff — name and WhatsApp number</td>
                <td>
                  To recognise an inbound WhatsApp message as coming from someone you authorised to
                  raise a request.
                </td>
              </tr>
              <tr>
                <td>Change requests, prices, schedule impacts and attachments</td>
                <td>To produce the record you send and the evidence you rely on.</td>
              </tr>
              <tr>
                <td>
                  Approval decisions — the signer&rsquo;s typed name, the date, any comment, and the
                  exact version shown
                </td>
                <td>
                  This <em>is</em> the contractual record. It is what makes a decision provable
                  later.
                </td>
              </tr>
              <tr>
                <td>
                  Technical records — timestamps, browser user-agent, and a keyed{' '}
                  <strong>hash</strong> of the IP address
                </td>
                <td>
                  To show an approval was a genuine, distinct act, and to detect abuse. We
                  deliberately store a hash rather than the IP address itself, so the record proves
                  consistency without retaining a location trail.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted">
          We do not run advertising or analytics trackers, we do not build profiles, we do not sell
          or rent personal data to anyone, and we do not use your data to train machine-learning
          models.
        </p>
      </section>

      <section>
        <h2>3. Why we are allowed to hold it</h2>
        <ul className="stack">
          <li>
            <strong>Your consent</strong>, given when you create an account and when you submit data
            into it. You can withdraw consent at any time by closing your account (section 6).
          </li>
          <li>
            <strong>Performance of our contract with you</strong> — we cannot deliver an approval
            ledger without holding the approvals.
          </li>
          <li>
            <strong>Legitimate uses under section 7 of the DPDP Act</strong>, including complying
            with a legal obligation and responding to a lawful order.
          </li>
        </ul>
        <p>
          Withdrawing consent does not undo processing that already, lawfully, happened — and it
          does not erase a completed approval, for the reason set out in section 6.
        </p>
      </section>

      <section>
        <h2>4. Who else sees it</h2>
        <p>
          We share personal data only with processors who are needed to run the service, under
          contract, and only to the extent required:
        </p>
        <ul className="stack">
          <li>
            <strong>Cloud hosting and database</strong> — to store your account. Hosted in India.
          </li>
          <li>
            <strong>Object storage</strong> — for the photographs and files you attach.
          </li>
          <li>
            <strong>Email delivery</strong> — to send sign-in links, verification and notifications.
          </li>
          <li>
            <strong>WhatsApp (Meta)</strong> — where you use WhatsApp intake, messages your team
            sends pass through Meta&rsquo;s platform under Meta&rsquo;s own terms.
          </li>
          <li>
            <strong>Payment processing</strong> — where you pay for a plan, card and payment details
            go directly to our payment gateway. We never see or store card numbers.
          </li>
        </ul>
        <p>
          We will disclose data to a court, regulator or law-enforcement agency where we are legally
          compelled to. We will tell you when that happens unless we are prohibited from doing so.
        </p>
        <p>
          Your data is stored in India. If we ever transfer it outside India we will do so only to
          jurisdictions permitted under section 16 of the DPDP Act.
        </p>
      </section>

      <section>
        <h2>5. How long we keep it</h2>
        <ul className="stack">
          <li>
            <strong>While your account is open</strong>, we keep your data so the service works.
          </li>
          <li>
            <strong>Evidence records</strong> — sent versions and the decisions on them — are
            retained for the retention period of your plan (36 months on Trial, Starter and Project
            pass; 60 months on Pro), because they are the record you may need to enforce or defend a
            payment claim.
          </li>
          <li>
            <strong>When you close your account</strong>, we mark it closed and keep it recoverable
            for {ACCOUNT_DELETION_GRACE_DAYS} days so an accidental or malicious closure can be
            undone. After that we purge, except where a legal hold or a live contractual dispute
            requires us to retain specific records.
          </li>
          <li>
            <strong>Security and audit logs</strong> are kept for as long as needed to investigate
            abuse, then discarded.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Your rights, and the one honest limit on them</h2>
        <p>Under the DPDP Act you may ask us to:</p>
        <ul className="stack">
          <li>
            <strong>Access</strong> — get a copy of the personal data we hold about you, and a
            summary of how it is processed. We provide this as a machine-readable export.
          </li>
          <li>
            <strong>Correct</strong> — fix data that is wrong, incomplete or out of date. Most of it
            you can edit yourself in the app.
          </li>
          <li>
            <strong>Erase</strong> — delete data that is no longer needed for the purpose it was
            collected for.
          </li>
          <li>
            <strong>Nominate</strong> — name someone to exercise these rights on your behalf if you
            die or become incapacitated.
          </li>
          <li>
            <strong>Complain</strong> — raise a grievance with us (section 8), and escalate to the
            Data Protection Board of India if our answer does not satisfy you.
          </li>
        </ul>

        <h3>What we can and cannot erase</h3>
        <p>
          We will not pretend erasure is unlimited. A recorded approval is a contract record that a
          second party — the contractor — relies on, and deleting it on one party&rsquo;s request
          would destroy the other party&rsquo;s evidence. Section 12(3) of the DPDP Act allows
          retention where it is necessary for compliance with law. So:
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">On an erasure request</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Contact name, phone number, email address</td>
                <td>
                  <span className="code code-approved">Erased</span> — replaced with a tombstone.
                </td>
              </tr>
              <tr>
                <td>Draft change requests never sent</td>
                <td>
                  <span className="code code-approved">Erased</span>
                </td>
              </tr>
              <tr>
                <td>Your account profile, once the grace period ends</td>
                <td>
                  <span className="code code-approved">Erased</span>
                </td>
              </tr>
              <tr>
                <td>A recorded approval, decline or revision request</td>
                <td>
                  <span className="code code-declined">Retained</span> — it is the contractual
                  record, and it is append-only by design.
                </td>
              </tr>
              <tr>
                <td>The frozen version of a request that was sent</td>
                <td>
                  <span className="code code-declined">Retained</span> — for the same reason.
                </td>
              </tr>
              <tr>
                <td>The signer&rsquo;s name on a decision</td>
                <td>
                  <span className="code code-declined">Retained</span> — it is the assent itself; it
                  cannot be removed without destroying the record.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          When we act on an erasure request we tell you plainly what was removed, what was kept, and
          why. A vague answer here would be worse than a clear refusal.
        </p>
        <p>
          You can start an account deletion yourself from <Link href="/app/settings">Settings</Link>
          , or write to us at{' '}
          <a href={`mailto:${identity.contactEmail}`}>{identity.contactEmail}</a>.
        </p>
      </section>

      <section>
        <h2>7. How we protect it</h2>
        <ul className="stack">
          <li>All traffic is encrypted in transit with TLS, and HTTPS is enforced.</li>
          <li>
            Passwords are hashed with scrypt using per-password salts. A breach of our database does
            not yield your password.
          </li>
          <li>
            Approval links are authenticated ciphertext (AES-256-GCM); only a hash of each token is
            stored, so the database cannot be used to forge or replay a link.
          </li>
          <li>
            Evidence tables are append-only, enforced by database triggers <em>and</em> by revoking
            update and delete rights from the application&rsquo;s database role. They are chained
            with SHA-256 so tampering is detectable.
          </li>
          <li>
            Every record is scoped to a single organisation on every database query, and the
            application&rsquo;s database role is restricted to the minimum rights it needs.
            Isolation between customers is covered by an automated test suite that runs against a
            real database on every change.
          </li>
          <li>Sign-in, approval and other sensitive endpoints are rate-limited.</li>
          <li>We keep encrypted, tested backups and rehearse restoring from them.</li>
        </ul>
        <p>
          <strong>If a breach happens</strong>, we will notify the Data Protection Board of India
          and every affected person without delay, as required by the DPDP Rules — describing what
          happened, what data was involved, what we have done, and what you should do.
        </p>
      </section>

      <section>
        <h2>8. Contact and grievances</h2>
        <p>
          Our <strong>Grievance Officer</strong> under section 13 of the DPDP Act and the IT Rules
          is:
        </p>
        <p className="stack">
          <strong>{identity.grievanceOfficerName}</strong>
          <br />
          <a href={`mailto:${identity.grievanceOfficerEmail}`}>{identity.grievanceOfficerEmail}</a>
          <br />
          {identity.entityName}
          <br />
          {identity.address.split('\n').map((line, index) => (
            <span key={index}>
              {line}
              <br />
            </span>
          ))}
        </p>
        <p>
          We acknowledge every request within <strong>72 hours</strong> and answer it within{' '}
          <strong>30 days</strong>. To protect your data we may first need to verify that you are
          who you say you are.
        </p>
        <p>
          If you are not satisfied with our response you may complain to the{' '}
          <strong>Data Protection Board of India</strong>.
        </p>
      </section>

      <section>
        <h2>9. Children</h2>
        <p>
          ExtraWork is a business tool and is not directed at children. We do not knowingly create
          accounts for anyone under 18. If you believe a child&rsquo;s data has reached us, tell the
          Grievance Officer and we will delete it.
        </p>
      </section>

      <section>
        <h2>10. Changes to this policy</h2>
        <p>
          If we change this policy in a way that affects your rights we will notify account holders
          by email before it takes effect, and the version marker at the top of this page will
          change. Continuing to use ExtraWork after that date means the new version applies.
        </p>
      </section>
    </>
  );
}
