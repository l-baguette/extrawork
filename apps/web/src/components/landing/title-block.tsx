import Link from 'next/link';
import type { VersionStatus } from '@extrawork/contracts';
import { RequestStatusChip } from '@/components/status-chip';

/**
 * The hero, set as the title block of a drawing sheet.
 *
 * Every drawing an architect or designer issues carries one: a ruled box of
 * labelled fields (project, title, drawn, checked, approved) and, above it, a
 * revision schedule listing each change to the sheet. That is already the
 * shape of this product. "Raised by / Checked by / Decided by" is the
 * three-party routing of spec 2026-10-12 (D3: everything goes through the
 * designer) written in the vocabulary the reader signs off every day, and the
 * revision schedule is the request register with its project-scoped numbers
 * (D8). Nothing here is decoration: each field is a statement about the
 * product.
 *
 * The register is an example and says so in its caption. It uses no customer
 * names, and its figures add up: ₹8,40,000 plus the one approved ₹15,000 is
 * ₹8,55,000.
 */

interface Revision {
  number: string;
  change: string;
  room: string;
  amount: string | null;
  time: string;
  status: VersionStatus;
  awaitingReview: boolean;
}

const REVISIONS: Revision[] = [
  {
    number: 'P-0004-R01',
    change: 'Four concealed electrical points',
    room: 'Master bedroom',
    amount: '₹15,000',
    time: '+2 days',
    status: 'APPROVED',
    awaitingReview: false,
  },
  {
    number: 'P-0004-R02',
    change: 'Imported marble instead of vitrified tiles',
    room: 'Master bathroom',
    amount: '₹1,12,000',
    time: '+6 days',
    status: 'DECLINED',
    awaitingReview: false,
  },
  {
    number: 'P-0004-R03',
    change: 'Quartz counter instead of granite',
    room: 'Kitchen',
    amount: '₹38,500',
    time: 'No delay',
    status: 'SENT',
    awaitingReview: false,
  },
  {
    // A proposal from site, not priced yet: spec D4 lets a contractor raise a
    // request without knowing the price, and the designer completes it.
    number: 'P-0004-R04',
    change: 'Cove lighting along the window wall',
    room: 'Living room',
    amount: null,
    time: 'Time not set',
    status: 'DRAFT',
    awaitingReview: true,
  },
];

export function TitleBlock() {
  return (
    <section className="lp-tb" aria-labelledby="lp-title">
      <p className="lp-tb-for">
        <span className="overline lp-field-label">For</span>
        Interior designers and architects running residential projects
      </p>

      <div className="lp-tb-title">
        <h1 id="lp-title" className="lp-display">
          <span>Every project in one place.</span>
          <span>Every change approved before it is billed.</span>
        </h1>
        <p className="lp-standfirst">
          ExtraWork gives each project one shared folder for its drawings, quotes, photos, dates and
          people. Your construction company and your client send requests and files on WhatsApp. You
          check each request before your client sees it.
        </p>
        <div className="actions lp-ctas">
          <Link href="/register" className="btn btn-primary btn-lg">
            Create a free workspace
          </Link>
          <Link href="/sign-in" className="btn btn-lg">
            Sign in
          </Link>
        </div>
      </div>

      <dl className="lp-tb-fields">
        <div>
          <dt className="overline lp-field-label">Raised by</dt>
          <dd>Your site team, the contractor or the homeowner, in one WhatsApp message.</dd>
        </div>
        <div>
          <dt className="overline lp-field-label">Checked by</dt>
          <dd>
            <strong className="lp-you">You.</strong> Requests wait for you before they reach the
            client.
          </dd>
        </div>
        <div>
          <dt className="overline lp-field-label">Decided by</dt>
          <dd>Your client, from a link on their phone. No account, no app.</dd>
        </div>
        <div>
          <dt className="overline lp-field-label">Cost</dt>
          <dd>Free for founding firms during the beta.</dd>
        </div>
      </dl>

      <div className="lp-tb-rev">
        <table className="lp-rev">
          <caption>Example: the requests on project P-0004, a 3BHK apartment</caption>
          <thead>
            <tr>
              <th scope="col">Request</th>
              <th scope="col">Change</th>
              <th scope="col" className="num">
                Cost and time
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {REVISIONS.map((r) => (
              <tr key={r.number}>
                <td className="lp-rev-no">{r.number}</td>
                <td className="lp-rev-change">
                  {r.change}
                  <span className="lp-rev-room">{r.room}</span>
                </td>
                <td className="num lp-rev-amount">
                  {r.amount ?? <span className="lp-rev-unpriced">Not priced yet</span>}
                  <span className="lp-rev-time">{r.time}</span>
                </td>
                <td className="lp-rev-status">
                  <RequestStatusChip status={r.status} awaitingReview={r.awaitingReview} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="lp-rev-total">
              <th scope="row" colSpan={2}>
                Contract value now
                <span className="lp-rev-room">₹8,40,000 original plus ₹15,000 approved</span>
              </th>
              <td className="num">₹8,55,000</td>
              <td aria-hidden="true" />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
