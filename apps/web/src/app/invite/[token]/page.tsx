import Link from 'next/link';
import {
  COLLABORATOR_PARTY_LABELS,
  type CurrentUserDto,
  type InvitationPreviewDto,
} from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { formatDate } from '@/lib/format';
import { withNext } from '@/lib/safe-next';
import { AcceptInvitation } from './accept-invitation';

/**
 * An invitation link — spec 2026-10-12, D1. `/invite/{token}`.
 *
 * Outside the `(app)` group on purpose, like `/onboarding`: the person opening
 * it may have no account, or an account with no workspace, and the app shell
 * would redirect either of them away before they could read who invited them.
 *
 * The preview is public and says only who invited which (masked) address to
 * which project. Accepting needs a session for that exact address; the API
 * checks it, this page only explains it.
 */
export const dynamic = 'force-dynamic';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_SHAPE.test(token)) return <InvalidLink />;

  const [previewResult, meResult] = await Promise.all([
    serverGet<InvitationPreviewDto>(`/public/v1/invitations/${token}`),
    serverGet<CurrentUserDto>('/v1/auth/me'),
  ]);

  if (!previewResult.ok) {
    if (previewResult.status === 404) return <InvalidLink />;
    return (
      <Shell>
        <h1>Invitation</h1>
        <div className="banner banner-error" role="alert">
          {previewResult.message} Try opening the link again in a minute.
        </div>
      </Shell>
    );
  }

  const invitation = previewResult.data;
  const me = meResult.ok ? meResult.data : null;
  const here = `/invite/${token}`;
  const inviter = invitation.invitedByName ?? invitation.organizationName;
  const party = COLLABORATOR_PARTY_LABELS[invitation.party];

  return (
    <Shell>
      <p className="overline" style={{ marginBottom: 'var(--s2)' }}>
        Invitation to collaborate
      </p>
      <h1 style={{ marginBottom: 'var(--s3)' }}>{invitation.projectTitle}</h1>
      <dl className="kv" style={{ marginBottom: 'var(--s5)' }}>
        <dt>Invited by</dt>
        <dd>
          {inviter}
          {invitation.invitedByName ? ` · ${invitation.organizationName}` : ''}
        </dd>
        <dt>Project</dt>
        <dd>
          {invitation.projectTitle} <span className="muted mono">{invitation.projectNumber}</span>
        </dd>
        <dt>As</dt>
        <dd>{party}</dd>
        <dt>Sent to</dt>
        <dd className="mono">{invitation.emailMasked}</dd>
      </dl>

      {invitation.status === 'PENDING' ? (
        me ? (
          <>
            <p className="small muted">
              Signed in as <strong>{me.user.email}</strong>. Accepting adds{' '}
              {invitation.organizationName}&rsquo;s workspace to your account, with access to this
              project only.
            </p>
            <AcceptInvitation token={token} />
          </>
        ) : (
          <>
            <p className="muted">
              Sign in, or create a free account, with the address this invitation was sent to. You
              will come straight back here to accept.
            </p>
            <div className="stack">
              <Link className="btn btn-primary btn-block btn-lg" href={withNext('/sign-in', here)}>
                Sign in
              </Link>
              <Link className="btn btn-block btn-lg" href={withNext('/register', here)}>
                Create an account
              </Link>
            </div>
          </>
        )
      ) : (
        <ClosedInvitation status={invitation.status} expiresAt={invitation.expiresAt} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="page">
      <div className="card">{children}</div>
    </main>
  );
}

function InvalidLink() {
  return (
    <Shell>
      <h1>This invitation link is not valid</h1>
      <p className="muted">
        It may have been copied incompletely, or replaced by a newer invitation. Ask the person who
        invited you to send it again.
      </p>
    </Shell>
  );
}

function ClosedInvitation({
  status,
  expiresAt,
}: {
  status: InvitationPreviewDto['status'];
  expiresAt: string;
}) {
  if (status === 'ACCEPTED') {
    return (
      <div className="banner banner-info" role="status">
        This invitation has already been accepted. If that was you,{' '}
        <Link href="/app/projects">open your projects</Link>.
      </div>
    );
  }
  if (status === 'REVOKED') {
    return (
      <div className="banner banner-warn" role="status">
        This invitation was withdrawn. If you still need access, ask the person who invited you for
        a new one.
      </div>
    );
  }
  return (
    <div className="banner banner-warn" role="status">
      This invitation expired on {formatDate(expiresAt)}. Ask the person who invited you to send a
      new one.
    </div>
  );
}
