'use client';

import { useState } from 'react';
import type { PortalDownloadDto } from '@extrawork/contracts';
import { ApiError, api } from '@/lib/api';

/**
 * Fetches a signed download URL at the moment of the tap and follows it. The
 * URL lives for minutes, so it is never rendered into the page; and it is
 * always an attachment, so nothing a homeowner downloads is opened by the
 * browser as a page (spec 2026-10-12, D10).
 */
export function DownloadButton({
  token,
  documentId,
  label,
}: {
  token: string;
  documentId: string;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<PortalDownloadDto>(
        `/public/v1/portal/${encodeURIComponent(token)}/documents/${documentId}`,
      );
      window.location.assign(result.downloadUrl);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not download. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="portal-download">
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => void download()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? 'Preparing…' : label}
      </button>
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
