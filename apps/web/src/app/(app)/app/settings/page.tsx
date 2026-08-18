import Link from 'next/link';
import type { MembershipDto, OrganizationDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { formatDate } from '@/lib/format';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { Block, Figure, SheetTop } from '@/components/sheet';
import { BusinessForm } from './business-form';

/** Organization policy, team and plan — report §6.2 `/app/settings/*`. */
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [orgResult, membersResult] = await Promise.all([
    serverGet<OrganizationDto>('/v1/organizations/current'),
    serverGet<{ items: MembershipDto[] }>('/v1/memberships'),
  ]);

  if (!orgResult.ok && orgResult.status === 401) return <SignInPrompt />;
  if (!orgResult.ok) return <ErrorPanel message={orgResult.message} />;

  const organization = orgResult.data;
  const subscription = organization.subscription;
  const members = membersResult.ok ? membersResult.data.items : [];

  return (
    <>
      <SheetTop
        title="Settings"
        meta={`${organization.displayName} · since ${formatDate(organization.createdAt)}`}
        actions={
          <Link className="btn btn-sm" href="/app/settings/profile">
            Your details
          </Link>
        }
      />

      <main className="sheet rule-in">
        {subscription.readOnly ? (
          <div className="banner banner-warn" role="status">
            <strong>Your subscription is inactive.</strong> Existing records stay readable and
            exportable — nothing is hidden or deleted. New requests cannot be sent until billing is
            brought up to date.
          </div>
        ) : null}

        <Block title="Business details">
          <BusinessForm organization={organization} />
        </Block>

        <Block
          title="Customer message"
          action={
            <Link className="btn btn-sm" href="/app/settings/request-template">
              Edit template
            </Link>
          }
        >
          <div className="panel panel-pad">
            <p className="small muted" style={{ marginBottom: 0 }}>
              The wording your customers see when a request arrives. The assurance language and the
              evidence disclaimer are deliberately not editable — they describe what the record
              actually is, and a seller cannot be the one who rewords them.
            </p>
          </div>
        </Block>

        <Block title="Plan and usage">
          <div className="figures figures-3" style={{ marginBottom: 'var(--s4)' }}>
            <Figure
              label="Active projects"
              small
              value={`${subscription.usage.activeProjects} / ${limit(subscription.entitlements.activeProjects)}`}
            />
            <Figure
              label="Decisions this period"
              small
              value={`${subscription.usage.completedDecisionsThisPeriod} / ${limit(subscription.entitlements.completedDecisionsPerPeriod)}`}
            />
            <Figure
              label="Team members"
              small
              value={`${subscription.usage.teamMembers} / ${limit(subscription.entitlements.teamMembers)}`}
            />
          </div>

          <div className="panel">
            <table className="data-table">
              <tbody>
                <tr>
                  <td>Plan</td>
                  <td className="num">{subscription.planCode.replace(/_/g, ' ')}</td>
                </tr>
                <tr>
                  <td>Status</td>
                  <td className="num">{subscription.status}</td>
                </tr>
                <tr>
                  <td>Current period ends</td>
                  <td className="num">{formatDate(subscription.currentPeriodEnd)}</td>
                </tr>
                <tr>
                  <td>Phone-verified approval (A1)</td>
                  <td className="num">
                    {subscription.entitlements.otpApprovals ? 'Included' : 'Not included'}
                  </td>
                </tr>
                <tr>
                  <td>Automated WhatsApp sending</td>
                  <td className="num">
                    {subscription.entitlements.automatedWhatsApp ? 'Included' : 'Not included'}
                  </td>
                </tr>
                <tr>
                  <td>Licensed e-signature (A2)</td>
                  <td className="num">Not in this release</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="hint">
            ExtraWork records a secure-link record of assent. That is described accurately on every
            approval page and in every evidence pack, and it is not a licensed electronic signature.
          </p>
        </Block>

        <Block title="Team">
          <div className="panel">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {members.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        No team members yet.
                      </td>
                    </tr>
                  ) : (
                    members.map((member) => (
                      <tr key={member.userId}>
                        <td>{member.displayName}</td>
                        <td className="small mono">{member.email}</td>
                        <td>{member.role.replace(/_/g, ' ')}</td>
                        <td className="small muted">{member.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Block>
      </main>
    </>
  );
}

function limit(value: number): string {
  return value < 0 ? '∞' : String(value);
}
