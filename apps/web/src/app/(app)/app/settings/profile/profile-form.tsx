'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';

/**
 * Editing your own details.
 *
 * Only the name. The email address is shown, and shown as fixed, because it is
 * the identity this account is reached and recovered by — changing it in place
 * would move an account to an address nobody has proved they control. That
 * needs a verification round trip, and until one exists the honest thing is to
 * say so rather than hide the field or fail silently on submit.
 */
export function ProfileForm({ displayName, email }: { displayName: string; email: string }) {
  const router = useRouter();
  const [name, setName] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = name.trim() !== displayName.trim();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !dirty) return;
    if (!name.trim()) {
      setError('Your name cannot be empty.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/v1/auth/me', { method: 'PATCH', body: { displayName: name.trim() } });
      setSaved(true);
      // The account block in the rail was server-rendered with the old name.
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not save. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel panel-pad" onSubmit={submit} noValidate>
      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}
      {saved && !dirty ? (
        <div className="banner banner-success" role="status">
          Your name has been updated.
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="displayName">Your name</label>
        <input
          id="displayName"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          autoComplete="name"
          required
        />
        <p className="hint">
          Shown on your team list and recorded against actions you take in the audit history.
        </p>
      </div>

      <div className="field">
        <label htmlFor="email">Email address</label>
        <input id="email" className="input-mono" value={email} readOnly disabled />
        <p className="hint">
          This is how you sign in and how your account is recovered, so it cannot be changed here.
          Ask an administrator if it needs to move.
        </p>
      </div>

      <div className="row" style={{ marginTop: 'var(--s5)' }}>
        <button className="btn btn-primary" type="submit" disabled={busy || !dirty}>
          {busy ? <span className="spinner" /> : null}
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && !busy ? <span className="small muted">Unsaved changes</span> : null}
      </div>
    </form>
  );
}
