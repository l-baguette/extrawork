import type { MembershipDto, OrganizationDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { formatDate } from '@/lib/format';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';

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
    <main className="page page-wide">
      <h1 style={{ marginBottom: 'var(--space-4)' }}>Settings</h1>

      {subscription.readOnly ? (
        <div className="banner banner-warn" role="status">
          <strong>Your subscription is inactive.</strong> Existing records stay readable and
          exportable — nothing is hidden or deleted. New requests cannot be sent until billing is
          brought up to date.
        </div>
      ) : null}

      <section className="card" aria-labelledby="business">
        <h2 id="business">Business</h2>
        <table className="totals">
          <tbody>
            <tr>
              <td>Display name</td>
              <td>{organization.displayName}</td>
            </tr>
            <tr>
              <td>Legal name</td>
              <td>{organization.legalName ?? '—'}</td>
            </tr>
            <tr>
              <td>GSTIN</td>
              <td className="tabular">{organization.gstin ?? '—'}</td>
            </tr>
            <tr>
              <td>Timezone</td>
              <td>{organization.timezone}</td>
            </tr>
            <tr>
              <td>Currency</td>
              <td>{organization.defaultCurrency}</td>
            </tr>
            <tr>
              <td>Evidence retention</td>
              <td>{organization.retentionMonths} months after a project closes</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card" aria-labelledby="plan">
        <h2 id="plan">Plan</h2>
        <table className="totals">
          <tbody>
            <tr>
              <td>Plan</td>
              <td>{subscription.planCode}</td>
            </tr>
            <tr>
              <td>Status</td>
              <td>{subscription.status}</td>
            </tr>
            <tr>
              <td>Current period ends</td>
              <td>{formatDate(subscription.currentPeriodEnd)}</td>
            </tr>
            <tr>
              <td>Active projects</td>
              <td className="tabular">
                {subscription.usage.activeProjects} of{' '}
                {limit(subscription.entitlements.activeProjects)}
              </td>
            </tr>
            <tr>
              <td>Decisions this period</td>
              <td className="tabular">
                {subscription.usage.completedDecisionsThisPeriod} of{' '}
                {limit(subscription.entitlements.completedDecisionsPerPeriod)}
              </td>
            </tr>
            <tr>
              <td>Team members</td>
              <td className="tabular">
                {subscription.usage.teamMembers} of {limit(subscription.entitlements.teamMembers)}
              </td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: 'var(--space-4)' }}>Included</h3>
        <ul className="small">
          <li>
            Phone-verified approval (A1):{' '}
            {subscription.entitlements.otpApprovals ? 'included' : 'not included'}
          </li>
          <li>
            Automated WhatsApp sending:{' '}
            {subscription.entitlements.automatedWhatsApp ? 'included' : 'not included'}
          </li>
          <li>
            Custom branding:{' '}
            {subscription.entitlements.customBranding ? 'included' : 'not included'}
          </li>
        </ul>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Licensed electronic signature (A2) is not available in this release. ExtraWork records a
          secure-link record of assent, which is described accurately on every approval page and in
          every evidence pack.
        </p>
      </section>

      <section className="card" aria-labelledby="team">
        <h2 id="team">Team</h2>
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
              {members.map((member) => (
                <tr key={member.userId}>
                  <td>{member.displayName}</td>
                  <td className="small">{member.email}</td>
                  <td>{member.role}</td>
                  <td className="small muted">{member.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function limit(value: number): string {
  return value < 0 ? 'unlimited' : String(value);
}
