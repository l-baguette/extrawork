/**
 * What is inside a project, set as a drawing register.
 *
 * A designer already keeps one of these: a list of every sheet in the set and
 * who it has been issued to. The default folders of spec 2026-10-12 (migration
 * 0022) map onto it exactly, and the "issued to" columns are the folder
 * visibility levels: INTERNAL is your firm only, PROJECT adds the people you
 * invite, CLIENT adds the homeowner's project page. Showing the marks rather
 * than describing them answers the first question a designer asks ("will my
 * client see my bills?") before they have to ask it.
 *
 * "Approvals and change records" is not a stored folder; it is the request
 * register and its PDFs. The homeowner sees the requests that were sent to
 * them, not the ones still being reviewed, hence the qualified mark.
 */

type Mark = 'yes' | 'no' | 'sent';

interface FolderRow {
  name: string;
  holds: string;
  firm: Mark;
  collaborators: Mark;
  homeowner: Mark;
}

const FOLDERS: FolderRow[] = [
  {
    name: 'Plans and drawings',
    holds: 'Layouts, elevations, DWG and PDF sets',
    firm: 'yes',
    collaborators: 'yes',
    homeowner: 'yes',
  },
  {
    name: 'Contracts and quotes',
    holds: 'The signed contract, BOQ, vendor quotes',
    firm: 'yes',
    collaborators: 'yes',
    homeowner: 'yes',
  },
  {
    name: 'Site photos',
    holds: 'Progress photos from the site',
    firm: 'yes',
    collaborators: 'yes',
    homeowner: 'no',
  },
  {
    name: 'From WhatsApp',
    holds: 'Anything sent to the project on WhatsApp',
    firm: 'yes',
    collaborators: 'yes',
    homeowner: 'no',
  },
  {
    name: 'Bills and invoices',
    holds: 'Your own bills, kept to your firm',
    firm: 'yes',
    collaborators: 'no',
    homeowner: 'no',
  },
  {
    name: 'Approvals and change records',
    holds: 'Every request, its decision and its PDF record',
    firm: 'yes',
    collaborators: 'yes',
    homeowner: 'sent',
  },
];

function MarkCell({ mark, who }: { mark: Mark; who: string }) {
  if (mark === 'no') {
    return (
      <td className="lp-mark lp-mark-no">
        <span aria-hidden="true">–</span>
        <span className="sr-only">Not visible to {who}</span>
      </td>
    );
  }
  return (
    <td className="lp-mark">
      <span className="lp-dot" aria-hidden="true" />
      <span className="sr-only">Visible to {who}</span>
      {mark === 'sent' ? <span className="lp-mark-note">once sent</span> : null}
    </td>
  );
}

export function ProjectIndex() {
  return (
    <div className="lp-index">
      <div className="lp-register-wrap">
        <table className="lp-register">
          <caption>
            The folders every new project starts with, and who can see each one. Add your own
            folders, choose who sees them, and add Google Drive or Dropbox links to any folder.
          </caption>
          <thead>
            <tr>
              <th scope="col">Folder</th>
              <th scope="col" className="lp-mark-head">
                Your firm
              </th>
              <th scope="col" className="lp-mark-head">
                Invited
              </th>
              <th scope="col" className="lp-mark-head">
                Client
              </th>
            </tr>
          </thead>
          <tbody>
            {FOLDERS.map((f) => (
              <tr key={f.name}>
                <th scope="row">
                  <span className="lp-register-name">{f.name}</span>
                  <span className="lp-register-holds">{f.holds}</span>
                </th>
                <MarkCell mark={f.firm} who="your firm" />
                <MarkCell mark={f.collaborators} who="the people you invite" />
                <MarkCell mark={f.homeowner} who="your client" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="lp-also">
        <div>
          <dt>Requests, numbered by project</dt>
          <dd>
            P-0004-R03 is the third request on project P-0004. Each one records the room, the type
            of work, the price, the extra days and the reason. The contract value updates as your
            client approves them, and you mark each one when it has been invoiced.
          </dd>
        </div>
        <div>
          <dt>Timeline</dt>
          <dd>
            Milestones and completion dates for every project on one calendar. Reminders come by
            email, or add the private calendar link to Google or Apple Calendar and get them on your
            phone.
          </dd>
        </div>
        <div>
          <dt>Team</dt>
          <dd>
            People you invite from other firms sign in and see only the projects you share. The site
            team needs nothing but a WhatsApp number. Each project shows who raises, checks, decides
            and carries out the work.
          </dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>
            Photos, PDF, Excel, Word, PowerPoint, CSV, and DWG or DXF drawings. Files are stored
            privately, and only the people a folder is shared with can download them.
          </dd>
        </div>
      </dl>
    </div>
  );
}
