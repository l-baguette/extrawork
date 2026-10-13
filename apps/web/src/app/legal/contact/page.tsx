import type { Metadata } from 'next';
import { legalIdentity } from '@/lib/legal';
import { DocHeader } from '../doc-header';

export const metadata: Metadata = {
  title: 'Contact — ExtraWork',
  description: 'How to reach ExtraWork: support, billing, privacy grievances and security reports.',
};

export default function ContactPage() {
  const identity = legalIdentity();

  return (
    <>
      <DocHeader
        code="CONTACT"
        title="Contact us"
        standfirst={
          <>
            Who to write to, and how long we take to answer. Every address below is monitored by a
            person.
          </>
        }
      />

      <section>
        <h2>Registered office</h2>
        <p className="stack">
          <strong>{identity.entityName}</strong>
          <br />
          {identity.address.split('\n').map((line, index) => (
            <span key={index}>
              {line}
              <br />
            </span>
          ))}
          {identity.gstin && (
            <>
              GSTIN <span className="mono">{identity.gstin}</span>
              <br />
            </>
          )}
        </p>
        <p className="stack">
          <a href={`mailto:${identity.contactEmail}`}>{identity.contactEmail}</a>
          <br />
          <a href={`tel:${identity.contactPhone.replace(/\s+/g, '')}`}>{identity.contactPhone}</a>
        </p>
      </section>

      <section>
        <h2>Who to write to</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">About</th>
                <th scope="col">Where</th>
                <th scope="col">We reply within</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Support, billing, refunds</td>
                <td>
                  <a href={`mailto:${identity.contactEmail}`}>{identity.contactEmail}</a>
                </td>
                <td>2 business days</td>
              </tr>
              <tr>
                <td>
                  Privacy requests and grievances — <strong>{identity.grievanceOfficerName}</strong>
                  , Grievance Officer
                </td>
                <td>
                  <a href={`mailto:${identity.grievanceOfficerEmail}`}>
                    {identity.grievanceOfficerEmail}
                  </a>
                </td>
                <td>Acknowledged in 72 hours, answered in 30 days</td>
              </tr>
              <tr>
                <td>Security vulnerability reports</td>
                <td>
                  <a href={`mailto:${identity.contactEmail}`}>{identity.contactEmail}</a> with{' '}
                  <em>SECURITY</em> in the subject
                </td>
                <td>3 business days</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Reporting a security problem</h2>
        <p>
          If you have found a vulnerability, please tell us before telling anyone else, and give us
          a reasonable chance to fix it. Do not access, modify or retain data belonging to anyone
          else while investigating, and do not run tests that degrade the service for other users.
          We will not pursue legal action against a researcher who follows those limits and reports
          in good faith.
        </p>
      </section>
    </>
  );
}
