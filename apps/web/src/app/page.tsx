import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PartyDiagram } from '@/components/landing/party-diagram';
import { ProjectIndex } from '@/components/landing/project-index';
import { TitleBlock } from '@/components/landing/title-block';
import { WhatsAppThread } from '@/components/landing/whatsapp-thread';
import { archivo, splineMono } from '@/lib/fonts';
import { serverGet } from '@/lib/server-fetch';

/**
 * The public front door, written for the person spec 2026-10-12 makes the
 * primary user: an interior designer or architect running several residential
 * projects, most likely reading on a phone between site visits.
 *
 * Signed-in visitors go straight to their dashboard; someone who already has a
 * session has no use for a marketing page.
 *
 * The page is drawn in the console's own language (a drawing sheet: ruled,
 * square, graphite, colour only where it is a status) so that the product a
 * designer signs up for looks like the page that described it. It loads the
 * console's self-hosted typefaces and nothing from a third party.
 *
 * Copy rules held throughout: no testimonials, logos, statistics or customer
 * names, because there are none yet and inventing them would be the first lie
 * a customer catches; and no legal promise beyond what the approval record
 * actually is (see the "record" section and `packages/contracts` assurance).
 */
export const dynamic = 'force-dynamic';

// The root layout's description still names the old contractor ledger and is
// shared by every route; the front page states the current positioning
// (spec 2026-10-12) for itself rather than editing a file other slices own.
export const metadata: Metadata = {
  description:
    'Project organisation for interior designers and architects: one shared folder per project, requests from site and client over WhatsApp, and every change approved before it is billed.',
};

export default async function HomePage() {
  // `/v1/auth/me` succeeds only with a valid session cookie, which is a
  // cheaper and more honest signal than reading the cookie ourselves; the
  // cookie could be present and expired.
  const session = await serverGet<{ userId: string }>('/v1/auth/me');
  if (session.ok) redirect('/app/dashboard');

  return (
    <div className={`lp ${archivo.variable} ${splineMono.variable}`}>
      <header className="lp-masthead">
        <span className="wordmark">
          Extra<span className="wordmark-mark">Work</span>
        </span>
        <Link href="/sign-in" className="btn btn-sm btn-quiet">
          Sign in
        </Link>
      </header>

      <main id="main" className="lp-main">
        <TitleBlock />

        <section className="lp-section" aria-labelledby="lp-parties">
          <div className="lp-section-head">
            <h2 id="lp-parties">Everything goes through you</h2>
            <p>
              Every project has three parties. The construction company and your client send you
              what they need, usually as a WhatsApp message. You check it, complete it, and decide
              what reaches your client.
            </p>
          </div>
          <PartyDiagram />
        </section>

        <section className="lp-section" aria-labelledby="lp-inside">
          <div className="lp-section-head">
            <h2 id="lp-inside">One folder per project</h2>
            <p>
              Start a project with the client, the address, the dates and the contract value. Drop
              in the drawings. Everything after that collects in the same place, in order, with the
              name of whoever added it.
            </p>
          </div>
          <ProjectIndex />
        </section>

        <section className="lp-section" aria-labelledby="lp-whatsapp">
          <div className="lp-section-head">
            <h2 id="lp-whatsapp">WhatsApp, without the scattered threads</h2>
            <p>
              Your site team and your client keep using WhatsApp. They message one ExtraWork number,
              and ExtraWork files what they send under the right project and tells you.
            </p>
          </div>
          <div className="lp-split">
            <WhatsAppThread />
            <ul className="lp-points">
              <li>
                <strong>One message.</strong> Text, photos or a PDF. No form, no app to install,
                nothing to sign in to.
              </li>
              <li>
                <strong>&ldquo;Which project?&rdquo; only when it has to ask.</strong> A sender on
                one project is never asked. A sender on two is asked once.
              </li>
              <li>
                <strong>Files are saved to the project.</strong> Photos and documents go into its
                From WhatsApp folder. A change request waits for your review.
              </li>
              <li>
                <strong>One word fixes a mistake.</strong> Every reply says what was done and how to
                correct it.
              </li>
              <li>
                <strong>Your client can ask too.</strong> They can send a change request, or reply
                &ldquo;contracts&rdquo; to get a link to their project page.
              </li>
            </ul>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="lp-record">
          <div className="lp-section-head">
            <h2 id="lp-record">A record of every approval</h2>
            <p>
              You do not have to set this up. It is what happens to every request you send, and it
              is there when someone remembers the price differently.
            </p>
          </div>
          <dl className="lp-record">
            <div>
              <dt>Fixed once sent</dt>
              <dd>
                The wording, price and time your client sees cannot be edited afterwards. A
                correction goes out as a new version, and the old link stops working.
              </dd>
            </div>
            <div>
              <dt>Timed and named</dt>
              <dd>
                When it was sent, when it was opened, when it was decided, and the name your client
                typed when they decided it.
              </dd>
            </div>
            <div>
              <dt>Yours to download</dt>
              <dd>
                A PDF of exactly what your client saw and what they chose. Your client can download
                it from their project page too.
              </dd>
            </div>
          </dl>
          <p className="lp-honest">
            This is a record of your client&rsquo;s agreement, kept so that nobody has to rely on
            memory. It is not a licensed or government-recognised electronic signature.
          </p>
        </section>

        <section className="lp-beta" aria-labelledby="lp-beta">
          <h2 id="lp-beta">Free for founding firms during the beta</h2>
          <p>
            We are building ExtraWork with a small group of design and architecture practices. Use
            all of it on your live projects at no cost, and tell us plainly what works and what does
            not.
          </p>
          <div className="actions lp-ctas">
            <Link href="/register" className="btn btn-primary btn-lg">
              Create a free workspace
            </Link>
            <Link href="/sign-in" className="btn btn-lg">
              Sign in
            </Link>
          </div>
        </section>

        <p className="lp-client-note">
          Have an approval link from your designer or contractor? Open it directly. You do not need
          an account to review or approve a request.
        </p>
      </main>
    </div>
  );
}
