import Link from 'next/link';
import { serverGet } from '@/lib/server-fetch';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { Block, SheetTop } from '@/components/sheet';
import { ProfileForm } from './profile-form';

/** Your own account details, separate from the business record. */
export const dynamic = 'force-dynamic';

interface MeResponse {
  user: { id: string; email: string; displayName: string };
  memberships: Array<{ organizationId: string; organizationName: string; role: string }>;
  activeOrganizationId: string | null;
}

export default async function ProfilePage() {
  const me = await serverGet<MeResponse>('/v1/auth/me');
  if (!me.ok && me.status === 401) return <SignInPrompt />;
  if (!me.ok) return <ErrorPanel message={me.message} />;

  const active =
    me.data.memberships.find((m) => m.organizationId === me.data.activeOrganizationId) ??
    me.data.memberships[0];

  return (
    <>
      <SheetTop
        title="Your details"
        meta="Your own account, not the business record"
        actions={
          <Link className="btn btn-sm" href="/app/settings">
            Business settings
          </Link>
        }
      />

      <main className="sheet sheet-narrow rule-in">
        <Block title="Profile">
          <ProfileForm displayName={me.data.user.displayName} email={me.data.user.email} />
        </Block>

        {me.data.memberships.length > 0 ? (
          <Block title="Your access">
            <div className="panel">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Business</th>
                    <th scope="col">Your role</th>
                  </tr>
                </thead>
                <tbody>
                  {me.data.memberships.map((m) => (
                    <tr key={m.organizationId}>
                      <td>
                        {m.organizationName}
                        {m.organizationId === active?.organizationId ? (
                          <span className="small muted"> · currently open</span>
                        ) : null}
                      </td>
                      <td>{m.role.replace(/_/g, ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              Your role decides what you can change. Only an owner or administrator can alter it.
            </p>
          </Block>
        ) : null}
      </main>
    </>
  );
}
