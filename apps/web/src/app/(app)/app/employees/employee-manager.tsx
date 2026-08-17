'use client';

import { useState } from 'react';
import type { EmployeeDto } from '@extrawork/contracts';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { formatMoney, minorToInput, parseMoneyToMinor } from '@/lib/format';

export interface ProjectOption {
  id: string;
  title: string;
  projectNumber: string;
}

interface FormState {
  name: string;
  phone: string;
  roleNote: string;
  allProjects: boolean;
  projectIds: string[];
  ceiling: string;
}

const EMPTY: FormState = {
  name: '',
  phone: '',
  roleNote: '',
  allProjects: true,
  projectIds: [],
  ceiling: '',
};

/**
 * Roster editing. Kept as one client component because adding a person and
 * assigning their projects is a single decision for the owner, and splitting it
 * across pages would mean saving a half-configured employee who can already
 * text in.
 */
export function EmployeeManager({
  initialEmployees,
  projects,
}: {
  initialEmployees: EmployeeDto[];
  projects: ProjectOption[];
}) {
  const [employees, setEmployees] = useState(initialEmployees);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setForm(EMPTY);
    setEditingId(null);
    setError(null);
  }

  function startEdit(employee: EmployeeDto): void {
    setEditingId(employee.id);
    setError(null);
    setForm({
      name: employee.name,
      phone: employee.phoneE164,
      roleNote: employee.roleNote ?? '',
      allProjects: employee.allProjects,
      projectIds: employee.projectIds,
      ceiling: employee.maxRequestMinor === null ? '' : minorToInput(employee.maxRequestMinor),
    });
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;

    const trimmedCeiling = form.ceiling.trim();
    let maxRequestMinor: number | null = null;
    if (trimmedCeiling.length > 0) {
      maxRequestMinor = parseMoneyToMinor(trimmedCeiling);
      if (maxRequestMinor === null) {
        setError('Enter the approval limit as a number, for example 20000.');
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        roleNote: form.roleNote.trim() === '' ? null : form.roleNote.trim(),
        allProjects: form.allProjects,
        projectIds: form.allProjects ? [] : form.projectIds,
        maxRequestMinor,
      };

      if (editingId) {
        const updated = await api<EmployeeDto>(`/v1/employees/${editingId}`, {
          method: 'PATCH',
          body,
        });
        setEmployees((current) => current.map((e) => (e.id === updated.id ? updated : e)));
      } else {
        const created = await api<EmployeeDto>('/v1/employees', {
          method: 'POST',
          idempotencyKey: newIdempotencyKey(),
          body,
        });
        setEmployees((current) => [...current, created]);
      }
      reset();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(employee: EmployeeDto): Promise<void> {
    if (busy) return;
    const confirmed = globalThis.confirm(
      `Remove ${employee.name}? They will no longer be able to raise requests, and their past requests stay in the log.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      await api(`/v1/employees/${employee.id}`, { method: 'DELETE' });
      setEmployees((current) => current.filter((e) => e.id !== employee.id));
      if (editingId === employee.id) reset();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }

  function toggleProject(projectId: string): void {
    setForm((current) => ({
      ...current,
      projectIds: current.projectIds.includes(projectId)
        ? current.projectIds.filter((id) => id !== projectId)
        : [...current.projectIds, projectId],
    }));
  }

  return (
    <>
      <section className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <h2>{editingId ? 'Edit employee' : 'Add an employee'}</h2>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="employee-name">Name</label>
            <input
              id="employee-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              maxLength={200}
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor="employee-phone">WhatsApp number</label>
            <input
              id="employee-phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              required
              inputMode="tel"
              placeholder="98765 43210"
              autoComplete="off"
              aria-describedby="employee-phone-help"
            />
            <p id="employee-phone-help" className="small muted">
              This is how they are recognised — messages from any other number are rejected. Indian
              numbers can be typed without +91.
            </p>
          </div>

          <div className="field">
            <label htmlFor="employee-role">Role or site note (optional)</label>
            <input
              id="employee-role"
              value={form.roleNote}
              onChange={(e) => setForm({ ...form, roleNote: e.target.value })}
              maxLength={200}
              placeholder="Site supervisor, Tower 4"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor="employee-ceiling">Approval limit per request (optional)</label>
            <input
              id="employee-ceiling"
              value={form.ceiling}
              onChange={(e) => setForm({ ...form, ceiling: e.target.value })}
              inputMode="decimal"
              placeholder="20000"
              autoComplete="off"
              aria-describedby="employee-ceiling-help"
            />
            <p id="employee-ceiling-help" className="small muted">
              A request above this amount is refused and the employee is told to check with you.
              Leave blank for no limit.
            </p>
          </div>

          <fieldset className="field">
            <legend>Which projects can they raise requests for?</legend>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.allProjects}
                onChange={(e) => setForm({ ...form, allProjects: e.target.checked })}
              />
              <span>All projects, including ones added later</span>
            </label>

            {!form.allProjects ? (
              projects.length === 0 ? (
                <p className="small muted">
                  You have no projects yet. Add one first, or leave this set to all projects.
                </p>
              ) : (
                <div style={{ marginTop: 'var(--space-2)' }}>
                  {projects.map((project) => (
                    <label key={project.id} className="checkbox">
                      <input
                        type="checkbox"
                        checked={form.projectIds.includes(project.id)}
                        onChange={() => toggleProject(project.id)}
                      />
                      <span>
                        {project.title} <span className="small muted">{project.projectNumber}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )
            ) : null}
          </fieldset>

          {error ? (
            <p role="alert" className="error-text">
              {error}
            </p>
          ) : null}

          <div className="actions">
            <button type="submit" className="button" disabled={busy}>
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add employee'}
            </button>
            {editingId ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={reset}
                disabled={busy}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>

      {employees.length === 0 ? (
        <div className="card">
          <h2>No employees yet</h2>
          <p className="muted">
            Add the people on site who should be able to request approval for extra work. Once
            added, they just send a WhatsApp message — nothing to install, no account to create.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Number</th>
                  <th scope="col">Projects</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Limit per request
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <td>
                      <strong>{employee.name}</strong>
                      {employee.roleNote ? (
                        <div className="small muted">{employee.roleNote}</div>
                      ) : null}
                    </td>
                    <td className="small tabular">{employee.phoneMasked}</td>
                    <td className="small">
                      {employee.allProjects
                        ? 'All projects'
                        : employee.projectIds.length === 0
                          ? 'None assigned'
                          : `${employee.projectIds.length} assigned`}
                    </td>
                    <td className="tabular" style={{ textAlign: 'right' }}>
                      {employee.maxRequestMinor === null ? (
                        <span className="muted">No limit</span>
                      ) : (
                        formatMoney(employee.maxRequestMinor)
                      )}
                    </td>
                    <td>
                      <span
                        className={`chip ${employee.status === 'ACTIVE' ? 'chip-approved' : 'chip-draft'}`}
                      >
                        {employee.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td>
                      <div className="actions">
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          onClick={() => startEdit(employee)}
                          disabled={busy}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          onClick={() => void remove(employee)}
                          disabled={busy}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * EMPLOYEE_PHONE_TAKEN can fire because the number belongs to *another*
 * organization, which the owner cannot see. The wording deliberately does not
 * say where it is registered — that would confirm another tenant exists.
 */
function messageFor(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'EMPLOYEE_PHONE_TAKEN') {
      return 'That number is already registered to an employee. Each number can belong to only one person.';
    }
    return cause.message;
  }
  return 'Something went wrong. Please try again.';
}
