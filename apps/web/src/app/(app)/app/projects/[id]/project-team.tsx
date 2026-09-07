'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { EmployeeDto } from '@extrawork/contracts';
import { ApiError, api } from '@/lib/api';

/**
 * The team on a single project.
 *
 * Assignment lives on the employee (their `projectIds`), so adding or removing
 * someone here is the same PATCH the Employees tab makes — no separate endpoint.
 * People set to "all projects" already cover this one; they are shown as covered
 * but managed from the Employees tab, because narrowing them to a single project
 * here would silently drop every other assignment they have.
 */
export function ProjectTeam({
  projectId,
  initialEmployees,
}: {
  projectId: string;
  initialEmployees: EmployeeDto[];
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
      // Send the whole employee so the PATCH validates the same way the roster
      // form does; only the project set changes.
      const updated = await api<EmployeeDto>(`/v1/employees/${employee.id}`, {
        method: 'PATCH',
        body: {
          name: employee.name,
          phone: employee.phoneE164,
          roleNote: employee.roleNote ?? null,
          allProjects: false,
          projectIds,
          maxRequestMinor: employee.maxRequestMinor,
        },
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
    <section className="card" aria-labelledby="team">
      <div className="row-between">
        <h2 id="team">Team on this project</h2>
        <Link className="small" href="/app/employees">
          Manage employees
        </Link>
      </div>

      {employees.length === 0 ? (
        <p className="muted">
          No employees yet. <Link href="/app/employees">Add your site team</Link> so they can raise
          requests for this project by WhatsApp.
        </p>
      ) : (
        <>
          {assigned.length === 0 ? (
            <p className="muted">
              No one is assigned to this project yet. Add someone below so they can raise requests
              for it.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {assigned.map((employee) => (
                <li key={employee.id} className="line-item">
                  <div className="row-between">
                    <div>
                      <strong>{employee.name}</strong>
                      {employee.roleNote ? (
                        <div className="small muted">{employee.roleNote}</div>
                      ) : null}
                    </div>
                    {employee.allProjects ? (
                      <span className="chip chip-neutral">All projects</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => remove(employee)}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {addable.length > 0 ? (
            <div className="row" style={{ marginTop: 'var(--space-4)' }}>
              <label htmlFor="add-employee" className="visually-hidden">
                Add an employee to this project
              </label>
              <select
                id="add-employee"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                disabled={busy}
                style={{ flex: 1 }}
              >
                <option value="">Add an employee…</option>
                {addable.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                    {employee.roleNote ? ` — ${employee.roleNote}` : ''}
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
          ) : assigned.length > 0 ? (
            <p className="small muted" style={{ marginTop: 'var(--space-3)' }}>
              Everyone available is already on this project. People set to “all projects” are
              managed from the <Link href="/app/employees">Employees</Link> tab.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="error-text">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
