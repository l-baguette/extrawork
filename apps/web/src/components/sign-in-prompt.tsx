import Link from 'next/link';

/**
 * Shown when the API reports an unauthenticated session.
 *
 * Report §6.5: business users authenticate through the managed provider and the
 * session lives in a secure, HTTP-only cookie. Nothing here reads or writes a
 * token, so there is no client-side auth state to get out of sync.
 */
export function SignInPrompt() {
  return (
    <main className="page">
      <div className="card">
        <h1>Sign in to ExtraWork</h1>
        <p className="muted">
          Your session has ended or you are not signed in. Sign in again to see your projects and
          change requests.
        </p>
        <Link className="btn btn-primary btn-block btn-lg" href="/sign-in">
          Sign in
        </Link>
      </div>
    </main>
  );
}
