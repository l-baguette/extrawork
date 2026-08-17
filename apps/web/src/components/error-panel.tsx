/**
 * A read failure never implies data loss. Report §13.1 ranks the decision write
 * path above dashboards and exports, so a failed read says plainly that records
 * are unaffected rather than presenting an empty state that looks like one.
 */
export function ErrorPanel({ message, title }: { message: string; title?: string }) {
  return (
    <main className="page">
      <div className="card">
        <div className="banner banner-error" role="alert">
          <h1 style={{ fontSize: '1.1rem', marginBottom: 'var(--space-2)' }}>
            {title ?? 'This could not be loaded'}
          </h1>
          <p style={{ marginBottom: 0 }}>{message}</p>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Your records are unaffected. Refresh to try again.
        </p>
      </div>
    </main>
  );
}
