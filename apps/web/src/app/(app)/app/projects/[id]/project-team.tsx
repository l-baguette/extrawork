'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TEAM_ROLE_LABELS, type EmployeeDto } from '@extrawork/contracts';
import { ApiError, api } from '@/lib/api';
import { TEAM_PARTY_LABELS } from '@/components/team-labels';

/**
 * The site team on a single project — spec 2026-10-12, D2: people identified
 * only by their WhatsApp number, from the firm or from the construction
 * company, who send requests and photos by message.
 *
 * Assignment lives on the team member (their `projectIds`), so adding or
 * removing someone here is the same PATCH the Site team page makes — no
 * separate endpoint. People set to "all projects" already cover this one; they
 * are shown as covered but managed from the Site team page, because narrowing
 * them to a single project here would silently drop every other assignment.
 */
export function ProjectTeam({
  projectId,
  initialEmployees,
  canEdit,
}: {
  projectId: string;
  initialEmployees: EmployeeDto[];
  /** Roster writes are owner/admin only; everyone else sees the list. */
  canEdit: boolean;
}) {
  const [employees, setEmployees] = useState(initialEmployees);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assigned = employees.filter(
    (e) => e.status === 'ACTIVE' && (e.allProjects || e.projectIds.includes(projectId)),
  );
  const addable = employees.filter(
    (e) => e.status === 'ACTIVE' && !e.allProjects && !e.projectIds.includes(projectId),
  );

  async function patchProjects(employee: EmployeeDto, projectIds: string[]): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Only the project set changes. The update is partial, so the person's
      // name, number, party and limit are left exactly as they are.
      const updated = await api<EmployeeDto>(`/v1/employees/${employee.id}`, {
        method: 'PATCH',
        body: { allProjects: false, projectIds },
      });
      setEmployees((current) => current.map((e) => (e.id === updated.id ? updated : e)));
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function add(): Promise<void> {
    const employee = employees.find((e) => e.id === selectedId);
    if (!employee) return;
    await patchProjects(employee, [...new Set([...employee.projectIds, projectId])]);
    setSelectedId('');
  }

  function remove(employee: EmployeeDto): void {
    void patchProjects(
      employee,
      employee.projectIds.filter((id) => id !== projectId),
    );
  }

  return (
    <section className="block" aria-labelledby="site-team">
      <div className="block-head">
        <h2 className="section-title" id="site-team">
          Site team on WhatsApp
        </h2>
        <div className="block-head-action">
          <Link className="btn btn-sm" href="/app/employees">
            Manage site team
          </Link>
        </div>
      </div>

      <div className="panel panel-pad">
        {employees.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            No one on your site team yet.{' '}
            <Link href="/app/employees">Add people by WhatsApp number</Link> so they can send
            requests and photos for this project by message.
          </p>
        ) : (
          <>
            {assigned.length === 0 ? (
              <p className="muted">
                No one on the site team is on this project yet.
                {canEdit ? ' Add someone below so they can message in about it.' : ''}
              </p>
            ) : (
              <ul className="people-list">
                {assigned.map((employee) => (
                  <li key={employee.id} className="people-row">
                    <div className="people-main">
                      <strong>{employee.name}</strong>
                      <div className="small muted">
                        {[
                          TEAM_ROLE_LABELS[employee.teamRole],
                          employee.party === 'INTERNAL'
                            ? null
                            : (employee.companyName ?? TEAM_PARTY_LABELS[employee.party]),
                          employee.roleNote,
                          employee.phoneMasked,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <span className="code code-neutral">
                      {employee.party === 'INTERNAL'
                        ? 'Our firm'
                        : TEAM_PARTY_LABELS[employee.party]}
                    </span>
                    {employee.allProjects ? (
                      <span className="small muted">All projects</span>
                    ) : canEdit ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet"
                        onClick={() => remove(employee)}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {canEdit && addable.length > 0 ? (
              <div className="row" style={{ marginTop: 'var(--s4)' }}>
                <label htmlFor="add-employee" className="visually-hidden">
                  Add someone from the site team to this project
                </label>
                <select
                  id="add-employee"
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  disabled={busy}
                  style={{ flex: 1 }}
                >
                  <option value="">Add someone from the site team…</option>
                  {addable.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                      {employee.companyName ? ` — ${employee.companyName}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void add()}
                  disabled={busy || selectedId === ''}
                >
                  {busy ? 'Saving…' : 'Add'}
                </button>
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="field-error">
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
