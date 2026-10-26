import type { EmployeeDto, ProjectPersonDto } from '@extrawork/contracts';

/**
 * Who does what on this project — the RACI matrix from spec 2026-10-12
 * ("Roles and RACI"), with the people actually on the project named under each
 * party so it reads as this project's arrangement rather than a policy.
 *
 * R responsible · A accountable · C consulted · I informed.
 */

type Letter = 'R' | 'A' | 'C' | 'I' | 'A/R';

const ACTIVITIES: ReadonlyArray<{
  activity: string;
  designer: Letter;
  construction: Letter;
  homeowner: Letter;
}> = [
  { activity: 'Raise a change request', designer: 'R', construction: 'R', homeowner: 'R' },
  { activity: 'Review, price and send it', designer: 'A/R', construction: 'C', homeowner: 'I' },
  { activity: 'Approve, decline or revise', designer: 'C', construction: 'I', homeowner: 'A/R' },
  { activity: 'Carry out the approved work', designer: 'A', construction: 'R', homeowner: 'I' },
  {
    activity: 'Keep drawings and files current',
    designer: 'A/R',
    construction: 'C',
    homeowner: 'I',
  },
  { activity: 'Maintain the project record', designer: 'A/R', construction: 'I', homeowner: 'I' },
];

const LETTER_TONE: Record<Letter, string> = {
  'A/R': 'code-approved',
  A: 'code-approved',
  R: 'code-waiting',
  C: 'code-neutral',
  I: 'code-neutral',
};

export function RaciMatrix({
  firmName,
  customerName,
  people,
  siteTeam,
}: {
  firmName: string | null;
  customerName: string;
  people: ProjectPersonDto[];
  siteTeam: EmployeeDto[];
}) {
  // The designer firm: the workspace's own staff who lead projects, and any
  // architecture firm brought in as a collaborator.
  const designer = unique([
    ...people
      .filter((p) =>
        p.party === null
          ? p.role === 'OWNER' || p.role === 'ADMIN' || p.role === 'PROJECT_MANAGER'
          : p.party === 'ARCHITECT',
      )
      .map((p) => p.displayName),
  ]);
  const construction = unique([
    ...people.filter((p) => p.party === 'CONSTRUCTION').map((p) => withCompany(p)),
    ...siteTeam
      .filter((e) => e.party === 'CONSTRUCTION')
      .map((e) => (e.companyName ? `${e.name} (${e.companyName})` : e.name)),
  ]);
  const homeowner = unique([
    customerName,
    ...people.filter((p) => p.party === 'HOMEOWNER').map((p) => p.displayName),
  ]);
  const others = people.filter((p) => p.party === 'CONSULTANT' || p.party === 'OTHER');

  const columns = [
    { key: 'designer' as const, title: firmName ?? 'Designer firm', names: designer },
    { key: 'construction' as const, title: 'Construction', names: construction },
    { key: 'homeowner' as const, title: 'Homeowner', names: homeowner },
  ];

  return (
    <div className="panel">
      <div className="table-scroll">
        <table className="data-table raci-table">
          <thead>
            <tr>
              <th scope="col">Activity</th>
              {columns.map((column) => (
                <th key={column.key} scope="col" className="raci-col">
                  <span>{column.title}</span>
                  <span className="raci-names">
                    {column.names.length > 0 ? column.names.join(', ') : 'No one yet'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ACTIVITIES.map((row) => (
              <tr key={row.activity}>
                <td>{row.activity}</td>
                {columns.map((column) => (
                  <td key={column.key} className="raci-cell">
                    <span className={`code ${LETTER_TONE[row[column.key]]}`}>
                      {row[column.key]}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint panel-pad" style={{ margin: 0 }}>
        R does the work · A answers for it · C is consulted · I is kept informed.
        {others.length > 0
          ? ` Also on the project, consulted as needed: ${others.map(withCompany).join(', ')}.`
          : ''}
      </p>
    </div>
  );
}

function withCompany(person: ProjectPersonDto): string {
  return person.companyName ? `${person.displayName} (${person.companyName})` : person.displayName;
}

function unique(names: string[]): string[] {
  return [...new Set(names.filter((n) => n.trim() !== ''))];
}
