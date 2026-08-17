import { headers } from 'next/headers';
import type { PublicRequestDto } from '@extrawork/contracts';
import { API_URL } from '@/lib/api';
import { DecisionPanel } from './decision-panel';
import { RequestSummary } from './request-summary';
import { UnavailableNotice } from './unavailable-notice';

/**
 * Public customer review — report §6.7.
 *
 * Server-rendered so the page is useful on a slow connection before any
 * JavaScript arrives (report §6.1: "Public pages should remain functional on
 * low-memory devices and constrained networks"). Only the decision form is a
 * client component.
 *
 * This route group carries no analytics, no third-party scripts and no fonts
 * (report §3.4, §11.3), and the token never leaves the URL: it is not logged,
 * not sent to any other origin, and `Referrer-Policy: no-referrer` is set for
 * the whole app in `next.config.mjs`.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ token: string }>;
}

interface LoadResult {
  request: PublicRequestDto | null;
  errorCode: string | null;
  errorMessage: string | null;
  details: Record<string, unknown> | null;
  setCookie: string | null;
}

async function loadRequest(token: string): Promise<LoadResult> {
  const incoming = await headers();
  const cookie = incoming.get('cookie');

  let response: Response;
  try {
    response = await fetch(`${API_URL}/public/v1/requests/${encodeURIComponent(token)}`, {
      headers: cookie ? { cookie } : {},
      cache: 'no-store',
    });
  } catch {
    // Report §13.1: when the API is unavailable the page shows a branded retry
    // screen and never implies that a decision was recorded.
    return {
      request: null,
      errorCode: 'SERVICE_UNAVAILABLE',
      errorMessage: null,
      details: null,
      setCookie: null,
    };
  }

  const setCookie = response.headers.get('set-cookie');
  const body = (await response.json().catch(() => null)) as
    | PublicRequestDto
    | { error: { code: string; message: string; details?: Record<string, unknown> } }
    | null;

  if (!response.ok || !body || 'error' in body) {
    const error = body && 'error' in body ? body.error : null;
    return {
      request: null,
      errorCode: error?.code ?? 'TOKEN_INVALID',
      errorMessage: error?.message ?? null,
      details: error?.details ?? null,
      setCookie,
    };
  }

  return { request: body, errorCode: null, errorMessage: null, details: null, setCookie };
}

export default async function PublicApprovalPage({ params }: PageProps) {
  const { token } = await params;
  const result = await loadRequest(token);

  if (!result.request) {
    return (
      <UnavailableNotice
        code={result.errorCode ?? 'TOKEN_INVALID'}
        message={result.errorMessage}
        details={result.details}
      />
    );
  }

  const request = result.request;

  return (
    <main id="main" className="page">
      <RequestSummary request={request} />

      {request.decided && request.receipt ? (
        <section className="card" aria-labelledby="decision-recorded">
          <h2 id="decision-recorded">Your decision is recorded</h2>
          <p className="muted small">
            Recorded on {new Date(request.receipt.occurredAt).toLocaleString('en-IN')}
          </p>
          <table className="totals">
            <tbody>
              <tr>
                <td>Decision</td>
                <td>
                  <strong>{decisionLabel(request.receipt.type)}</strong>
                </td>
              </tr>
              <tr>
                <td>Name given</td>
                <td>{request.receipt.signerName}</td>
              </tr>
              <tr>
                <td>Receipt reference</td>
                <td className="tabular">{request.receipt.receiptId}</td>
              </tr>
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 'var(--space-4)' }}>
            {request.assurance.limitation}
          </p>
        </section>
      ) : (
        <DecisionPanel token={token} request={request} />
      )}

      <footer className="small muted" style={{ marginTop: 'var(--space-5)' }}>
        <p>{request.declarations.disclaimer}</p>
        <p>
          Sent by {request.organization.displayName}
          {request.organization.contactPhone ? ` · ${request.organization.contactPhone}` : ''}
        </p>
      </footer>
    </main>
  );
}

function decisionLabel(type: string): string {
  switch (type) {
    case 'APPROVE':
      return 'Approved';
    case 'DECLINE':
      return 'Declined';
    default:
      return 'Revision requested';
  }
}
