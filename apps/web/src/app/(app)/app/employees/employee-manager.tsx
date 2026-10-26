'use client';

import { useState } from 'react';
import {
  TEAM_ROLE_LABELS,
  type EmployeeDto,
  type TeamParty,
  type TeamRole,
} from '@extrawork/contracts';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { formatMoney, minorToInput, parseMoneyToMinor } from '@/lib/format';
import { TEAM_PARTY_LABELS } from '@/components/team-labels';

const TEAM_PARTIES = Object.entries(TEAM_PARTY_LABELS) as Array<[TeamParty, string]>;
const TEAM_ROLES = Object.entries(TEAM_ROLE_LABELS) as Array<[TeamRole, string]>;

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
  party: TeamParty;
  companyName: string;
  teamRole: TeamRole;
}

const EMPTY: FormState = {
  name: '',
  phone: '',
  roleNote: '',
  allProjects: true,
  projectIds: [],
  ceiling: '',
  party: 'INTERNAL',
  companyName: '',
  teamRole: 'SITE_SUPERVISOR',
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
      party: employee.party,
      companyName: employee.companyName ?? '',
      teamRole: employee.teamRole,
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
        party: form.party,
        // Only another firm's people carry a company name; ours is the workspace.
        companyName:
          form.party === 'INTERNAL' || form.companyName.trim() === ''
            ? null
            : form.companyName.trim(),
        teamRole: form.teamRole,
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
        <h2>{editingId ? 'Edit site team member' : 'Add someone to the site team'}</h2>

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
              This is how they are recognised. A number can be on your team once; the same person
              may also be on another firm&rsquo;s team. Indian numbers can be typed without +91.
            </p>
          </div>

          <div className="field">
            <label htmlFor="employee-party">Works for</label>
            <select
              id="employee-party"
              value={form.party}
              onChange={(e) => setForm({ ...form, party: e.target.value as TeamParty })}
            >
              {TEAM_PARTIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {form.party !== 'INTERNAL' ? (
            <div className="field">
              <label htmlFor="employee-company">Company</label>
              <input
                id="employee-company"
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                maxLength={200}
                placeholder="Kumar Constructions"
                autoComplete="off"
              />
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="employee-team-role">Role on site</label>
            <select
              id="employee-team-role"
              value={form.teamRole}
              onChange={(e) => setForm({ ...form, teamRole: e.target.value as TeamRole })}
            >
              {TEAM_ROLES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="employee-role">Site note (optional)</label>
            <input
              id="employee-role"
              value={form.roleNote}
              onChange={(e) => setForm({ ...form, roleNote: e.target.value })}
              maxLength={200}
              placeholder="Tower 4, evenings"
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
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add to site team'}
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
          <h2>No one on the site team yet</h2>
          <p className="muted">
            Add the supervisors, foremen and contractors who should be able to send requests and
            photos for your projects. Once added, they just send a WhatsApp message — nothing to
            install, no account to create.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Works for</th>
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
                      <div className="small muted">
                        {[TEAM_ROLE_LABELS[employee.teamRole], employee.roleNote]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td className="small">
                      {employee.party === 'INTERNAL'
                        ? TEAM_PARTY_LABELS.INTERNAL
                        : (employee.companyName ?? TEAM_PARTY_LABELS[employee.party])}
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
 * Since spec 2026-10-12 (D7) EMPLOYEE_PHONE_TAKEN means the number is already
 * on *this* team — including someone removed earlier, whose row is kept so the
 * message log still names them. Another firm having the same number is fine.
 */
function messageFor(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'EMPLOYEE_PHONE_TAKEN') {
      return 'That number is already on your site team. Edit that person instead of adding them again.';
    }
    return cause.message;
  }
  return 'Something went wrong. Please try again.';
}
