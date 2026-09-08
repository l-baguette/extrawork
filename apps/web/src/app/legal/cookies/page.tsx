import type { Metadata } from 'next';
import Link from 'next/link';
import { DocHeader } from '../doc-header';

export const metadata: Metadata = {
  title: 'Cookie Policy — ExtraWork',
  description:
    'The six strictly necessary cookies ExtraWork sets, what each one does, and why there is no cookie banner.',
};

export default function CookiePolicyPage() {
  return (
    <>
      <DocHeader
        code="COOKIES"
        title="Cookie Policy"
        standfirst={
          <>
            ExtraWork sets a small number of cookies, all of them strictly necessary to sign you in
            and to stop other websites acting on your behalf. There are no advertising, analytics or
            tracking cookies, and no third party sets a cookie through us.
          </>
        }
      />

      <section>
        <h2>Why there is no cookie banner</h2>
        <p>
          Consent is required for cookies that are <em>not</em> essential — the ones used to profile
          you or measure you for someone else&rsquo;s benefit. We do not set any. Asking you to
          consent to cookies that the service cannot function without would be a box to click, not a
          real choice, so we do not pretend otherwise. If we ever add an optional cookie, we will
          ask first.
        </p>
      </section>

      <section>
        <h2>The cookies we set</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Purpose</th>
                <th scope="col">Lifetime</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono">ew_session</td>
                <td>
                  Keeps you signed in. Readable only by the server, never by JavaScript, so a script
                  injected into the page cannot steal it.
                </td>
                <td>Until the session expires or you sign out</td>
              </tr>
              <tr>
                <td className="mono">ew_csrf</td>
                <td>
                  Proves a request came from our own page rather than another site acting as you.
                  The page reads this value and echoes it back; a cross-site form cannot.
                </td>
                <td>Same as the session</td>
              </tr>
              <tr>
                <td className="mono">ew_public</td>
                <td>
                  Set only when a customer opens an approval link, so that viewing and then deciding
                  are recognised as the same visit.
                </td>
                <td>Short-lived, tied to that approval link</td>
              </tr>
              <tr>
                <td className="mono">ew_public_csrf</td>
                <td>The cross-site protection for the approval page, matching ew_csrf above.</td>
                <td>Same as ew_public</td>
              </tr>
              <tr>
                <td className="mono">ew_oauth_state</td>
                <td>
                  Set only while you are signing in with Google. It ties the response from Google to
                  the request your browser started, which is what stops a forged sign-in.
                </td>
                <td>Minutes — deleted as soon as sign-in completes</td>
              </tr>
              <tr>
                <td className="mono">ew_oauth_verifier</td>
                <td>
                  The matching PKCE secret for that same Google sign-in, so an intercepted code
                  cannot be redeemed by anyone else.
                </td>
                <td>Minutes — deleted as soon as sign-in completes</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted">
          All of these are first-party cookies, marked <span className="mono">SameSite=Lax</span>,
          and marked <span className="mono">Secure</span> everywhere except local development.
        </p>
      </section>

      <section>
        <h2>Other storage</h2>
        <p>
          The dashboard may keep small preferences in your browser&rsquo;s local storage — for
          example whether the sidebar is collapsed. That never leaves your device and is not
          personal data to us. Clearing your browser data removes it.
        </p>
      </section>

      <section>
        <h2>Controlling cookies</h2>
        <p>
          You can clear or block cookies in your browser settings. Because every cookie we set is
          essential, blocking them means you will not be able to sign in, and a customer will not be
          able to approve a change request. What we do with the data behind them is covered by the{' '}
          <Link href="/legal/privacy">Privacy Policy</Link>.
        </p>
      </section>
    </>
  );
}
