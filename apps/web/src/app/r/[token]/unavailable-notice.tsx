/**
 * The "this link cannot be used" screen — report §4.6 and §13.1.
 *
 * Each case gets an honest, specific explanation. Two rules matter:
 *  - a superseded link explains the replacement, and only offers a current link
 *    when the same approver holds one (the API decides that, not this page);
 *  - nothing here ever implies that a decision was or was not recorded beyond
 *    what the API actually reported.
 */
export function UnavailableNotice({
  code,
  message,
  details,
}: {
  code: string;
  message: string | null;
  details: Record<string, unknown> | null;
}) {
  const content = describe(code, details);

  return (
    <main id="main" className="page">
      <div className="card">
        <div className={`banner ${content.tone}`} role="alert">
          <h1 style={{ fontSize: '1.15rem', marginBottom: 'var(--space-2)' }}>{content.title}</h1>
          <p style={{ marginBottom: 0 }}>{content.body}</p>
        </div>

        {content.showRetry ? (
          <p className="small muted">
            If you were in the middle of approving something, nothing has been recorded. Reload this
            page to try again.
          </p>
        ) : null}

        {message && content.showApiMessage ? <p className="small muted">{message}</p> : null}

        <p className="small muted" style={{ marginBottom: 0 }}>
          Contact the business that sent you this link if you need a new one. For your security,
          ExtraWork cannot reissue it for you.
        </p>
      </div>
    </main>
  );
}

interface Described {
  title: string;
  body: string;
  tone: string;
  showRetry: boolean;
  showApiMessage: boolean;
}

function describe(code: string, details: Record<string, unknown> | null): Described {
  switch (code) {
    case 'VERSION_SUPERSEDED':
      return {
        title: 'This request has been replaced',
        body:
          details?.currentVersionAvailable === true
            ? 'The business has sent a newer version of this change request. Please use the most recent link they sent you — the amounts or the scope may have changed.'
            : 'The business has sent a newer version of this change request. Ask them for the current link before approving anything.',
        tone: 'banner-warn',
        showRetry: false,
        showApiMessage: false,
      };
    case 'REQUEST_EXPIRED':
      return {
        title: 'This link has expired',
        body: 'Approval links are time-limited. Ask the business to send a new one; nothing has been decided.',
        tone: 'banner-warn',
        showRetry: false,
        showApiMessage: false,
      };
    case 'TOKEN_REVOKED':
      return {
        title: 'This link is no longer active',
        body: 'The business cancelled or replaced this request. Nothing has been decided using this link.',
        tone: 'banner-warn',
        showRetry: false,
        showApiMessage: false,
      };
    case 'ALREADY_DECIDED':
      return {
        title: 'A decision has already been recorded',
        body: 'This request has been decided. If that was not you, contact the business straight away.',
        tone: 'banner-info',
        showRetry: false,
        showApiMessage: false,
      };
    case 'SERVICE_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return {
        title: 'ExtraWork is temporarily unavailable',
        body: 'We could not load this request. No decision has been recorded. Please try again in a moment.',
        tone: 'banner-error',
        showRetry: true,
        showApiMessage: false,
      };
    case 'RATE_LIMITED':
      return {
        title: 'Too many attempts',
        body: 'This link has been opened many times in a short period. Please wait a few minutes and try again.',
        tone: 'banner-warn',
        showRetry: true,
        showApiMessage: false,
      };
    default:
      // Deliberately identical for a malformed, unknown or wrong token: an
      // attacker must not be able to tell them apart (report §12.2).
      return {
        title: 'This link is not valid',
        body: 'Check that you opened the most recent link the business sent you, and that it was copied in full.',
        tone: 'banner-error',
        showRetry: false,
        showApiMessage: false,
      };
  }
}
