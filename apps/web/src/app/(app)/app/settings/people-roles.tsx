'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  COLLABORATOR_PARTY_LABELS,
  MEMBERSHIP_ROLE_LABELS,
  type MembershipDto,
  type MembershipRole,
} from '@extrawork/contracts';
import { ApiError, api } from '@/lib/api';

/**
 * People & roles — spec 2026-10-12, "Roles and RACI".
 *
 * The firm's staff, whose role decides what they can do and whether they see
 * every project; then collaborators from other firms, who see only the
 * projects they were invited to. Collaborators are managed from each project's
 * Team tab, not promoted here: a role change would hand someone from another
 * firm the run of this workspace.
 */

/** Roles an owner or admin may assign; ownership moves by its own command. */
const ASSIGNABLE: MembershipRole[] = ['ADMIN', 'PROJECT_MANAGER', 'FINANCE', 'VIEWER'];

const ROLE_HELP: Partial<Record<MembershipRole, string>> = {
  OWNER: 'Everything, including closing the account',
  ADMIN: 'Everything except ownership and closing the account',
  PROJECT_MANAGER: 'Runs the projects they are on: requests, files, people',
  FINANCE: 'Sees every project; marks approved work as billed',
  VIEWER: 'Reads the projects they are on',
};

export function PeopleRoles({
  members,
  canChangeRoles,
  currentUserId,
}: {
  members: MembershipDto[];
  canChangeRoles: boolean;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const staff = members.filter((m) => m.role !== 'COLLABORATOR' && m.status !== 'REVOKED');
  const collaborators = members.filter((m) => m.role === 'COLLABORATOR' && m.status === 'ACTIVE');

  async function changeRole(member: MembershipDto, role: MembershipRole): Promise<void> {
    if (busy || role === member.role) return;
    setBusy(member.userId);
    setError(null);
    try {
      await api(`/v1/memberships/${member.userId}`, { method: 'PATCH', body: { role } });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not change the role.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Your firm</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No team members yet.
                  </td>
                </tr>
              ) : (
                staff.map((member) => (
                  <tr key={member.userId}>
                    <td>
                      <strong>{member.displayName}</strong>
                      {member.userId === currentUserId ? (
                        <span className="muted"> (you)</span>
                      ) : null}
                      <div className="small mono muted">{member.email}</div>
                    </td>
                    <td>
                      {canChangeRoles &&
                      member.role !== 'OWNER' &&
                      member.userId !== currentUserId ? (
                        <>
                          <label className="visually-hidden" htmlFor={`role-${member.userId}`}>
                            Role for {member.displayName}
                          </label>
                          <select
                            id={`role-${member.userId}`}
                            value={member.role}
                            disabled={busy !== null}
                            onChange={(event) =>
                              void changeRole(member, event.target.value as MembershipRole)
                            }
                          >
                            {ASSIGNABLE.map((role) => (
                              <option key={role} value={role}>
                                {MEMBERSHIP_ROLE_LABELS[role]}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : (
                        MEMBERSHIP_ROLE_LABELS[member.role]
                      )}
                      <div className="small muted">{ROLE_HELP[member.role]}</div>
                    </td>
                    <td className="small muted">
                      {member.status === 'INVITED' ? 'Invited' : 'Active'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Collaborators</th>
                <th scope="col">From</th>
                <th scope="col">Can see</th>
              </tr>
            </thead>
            <tbody>
              {collaborators.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No one from another firm yet. Invite people from a project&rsquo;s Team tab.
                  </td>
                </tr>
              ) : (
                collaborators.map((member) => (
                  <tr key={member.userId}>
                    <td>
                      <strong>{member.displayName}</strong>
                      <div className="small mono muted">{member.email}</div>
                    </td>
                    <td className="small">
                      {[
                        member.collaboratorParty
                          ? COLLABORATOR_PARTY_LABELS[member.collaboratorParty]
                          : null,
                        member.companyName,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </td>
                    <td className="small">
                      {member.projects && member.projects.length > 0
                        ? member.projects.map((project, index) => (
                            <span key={project.id}>
                              {index > 0 ? ', ' : ''}
                              <Link href={`/app/projects/${project.id}/team`}>{project.title}</Link>
                            </span>
                          ))
                        : 'No projects'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
