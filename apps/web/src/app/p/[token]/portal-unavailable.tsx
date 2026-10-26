/**
 * The "this project link cannot be used" screen. Plain and specific, like the
 * approval page's: an expired link says it expired, a revoked one says the
 * designer turned it off, and anything else — malformed, unknown, a closed
 * workspace — reads the same, so a guessed URL learns nothing.
 */
export function PortalUnavailable({ code, reason }: { code: string; reason: string | null }) {
  const content = describe(code, reason);
  return (
    <main id="main" className="page">
      <div className="card">
        <div className={`banner ${content.tone}`} role="alert">
          <h1 style={{ fontSize: '1.15rem', marginBottom: 'var(--s2)' }}>{content.title}</h1>
          <p style={{ marginBottom: 0 }}>{content.body}</p>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Ask your designer to send you a new link. If they use ExtraWork on WhatsApp, you can also
          message the word <strong>contracts</strong> to get a fresh one.
        </p>
      </div>
    </main>
  );
}

function describe(
  code: string,
  reason: string | null,
): { title: string; body: string; tone: string } {
  if (code === 'SERVICE_UNAVAILABLE' || code === 'INTERNAL_ERROR') {
    return {
      title: 'ExtraWork is temporarily unavailable',
      body: 'We could not load your project just now. Please try again in a moment.',
      tone: 'banner-error',
    };
  }
  if (code === 'RATE_LIMITED') {
    return {
      title: 'Too many visits in a short time',
      body: 'This link has been opened many times recently. Please wait a few minutes and try again.',
      tone: 'banner-warn',
    };
  }
  if (reason === 'EXPIRED') {
    return {
      title: 'This link has expired',
      body: 'Project links work for a limited time. Your project record is safe; you just need a new link to see it.',
      tone: 'banner-warn',
    };
  }
  if (reason === 'REVOKED') {
    return {
      title: 'This link has been turned off',
      body: 'Your designer switched this link off, usually because they sent you a newer one.',
      tone: 'banner-warn',
    };
  }
  return {
    title: 'This link is not valid',
    body: 'Check that you opened the most recent link your designer sent you, and that it was copied in full.',
    tone: 'banner-error',
  };
}
