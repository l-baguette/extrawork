import { sql } from 'drizzle-orm';
import { AppError } from '@extrawork/contracts';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toBigIntOrNull, toDate } from '../row-types.js';

/**
 * Employees: the people allowed to raise a change request by WhatsApp.
 *
 * Migration 0005. Two things about this table are unusual and deliberate:
 *
 *   1. **No login.** An employee is identified by the phone number the owner
 *      registered, nothing else. There is no user row, no password, no session.
 *   2. **One phone, one employee, system-wide.** `employees_phone_global_idx`
 *      enforces uniqueness across every organization for any non-REMOVED row.
 *      An inbound message from a number registered at two companies cannot be
 *      attributed to a tenant, and picking one is exactly the cross-tenant
 *      guess report §3.2 forbids.
 *
 * Every method here takes a `TenantContext` except `findByPhoneGlobal`, which
 * is the one place that cannot: it is what *resolves* the tenant from an
 * inbound message. See the comment on that method.
 */

export type EmployeeStatus = 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

export interface EmployeeRow {
  id: string;
  organizationId: string;
  name: string;
  phoneE164: string;
  roleNote: string | null;
  status: EmployeeStatus;
  allProjects: boolean;
  /** Per-request ceiling in minor units. Null means no ceiling. */
  maxRequestMinor: bigint | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lockVersion: number;
}

/** An employee plus the projects they may raise requests against. */
export interface EmployeeWithAssignments extends EmployeeRow {
  projectIds: string[];
}

export class EmployeeRepository {
  constructor(private readonly db: Database) {}

  async create(
    tx: TransactionContext,
    ctx: TenantContext,
    input: {
      name: string;
      phoneE164: string;
      roleNote: string | null;
      allProjects: boolean;
      maxRequestMinor: bigint | null;
      projectIds: string[];
    },
  ): Promise<EmployeeWithAssignments> {
    const id = newId();
    try {
      await tx.db.execute(sql`
        INSERT INTO employees (
          id, organization_id, name, phone_e164, role_note,
          all_projects, max_request_minor, created_by_user_id
        ) VALUES (
          ${id}::uuid, ${ctx.organizationId}::uuid, ${input.name}, ${input.phoneE164},
          ${input.roleNote}, ${input.allProjects},
          ${input.maxRequestMinor === null ? null : input.maxRequestMinor.toString()}::bigint,
          ${ctx.userId}::uuid
        )
      `);
    } catch (error) {
      throw translateUniqueViolation(error);
    }

    await this.replaceAssignmentsIn(tx, ctx, id, input.projectIds);

    const created = await this.findByIdIn(tx.db, ctx, id);
    if (!created)
      throw new AppError('INTERNAL_ERROR', { message: 'Employee insert returned no row' });
    return created;
  }

  async findById(ctx: TenantContext, id: string): Promise<EmployeeWithAssignments | null> {
    return this.findByIdIn(this.db, ctx, id);
  }

  async requireById(ctx: TenantContext, id: string): Promise<EmployeeWithAssignments> {
    const row = await this.findById(ctx, id);
    if (!row) throw new AppError('EMPLOYEE_NOT_FOUND');
    return row;
  }

  private async findByIdIn(
    db: Database,
    ctx: TenantContext,
    id: string,
  ): Promise<EmployeeWithAssignments | null> {
    const result = await db.execute<EmployeeRecord>(sql`
      SELECT ${EMPLOYEE_WITH_ASSIGNMENTS_COLUMNS}
      FROM employees e
      WHERE e.id = ${id}::uuid AND e.organization_id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    if (!row) return null;
    return mapEmployeeWithAssignments(row);
  }

  /**
   * Resolves an inbound sender to an employee **without** a TenantContext.
   *
   * This is the deliberate exception to "no tenant-owned repository method
   * without TenantContext" (report §3.2, §14.4). The rule exists so a caller
   * cannot widen its own scope by passing an organization id from a request
   * body. Here there is no scope to widen: an unauthenticated WhatsApp message
   * arrives with nothing but a phone number, and the number is what *derives*
   * the tenant. The global unique index guarantees at most one active match, so
   * this cannot silently pick between two organizations.
   *
   * Callers must build a `TenantContext` from the returned `organizationId` and
   * use the tenant-scoped methods for everything after this point. REMOVED
   * employees are excluded, matching the partial index.
   */
  async findByPhoneGlobal(phoneE164: string): Promise<EmployeeWithAssignments | null> {
    const result = await this.db.execute<EmployeeRecord>(sql`
      SELECT ${EMPLOYEE_WITH_ASSIGNMENTS_COLUMNS}
      FROM employees e
      WHERE e.phone_e164 = ${phoneE164} AND e.status <> 'REMOVED'
    `);
    const row = result.rows[0];
    if (!row) return null;
    return mapEmployeeWithAssignments(row);
  }

  async list(
    ctx: TenantContext,
    options: { status?: EmployeeStatus; query?: string } = {},
  ): Promise<EmployeeWithAssignments[]> {
    const term = options.query?.trim();
    const result = await this.db.execute<EmployeeRecord>(sql`
      SELECT ${EMPLOYEE_WITH_ASSIGNMENTS_COLUMNS}
      FROM employees e
      WHERE e.organization_id = ${ctx.organizationId}::uuid
        ${options.status ? sql`AND e.status = ${options.status}::employee_status` : sql`AND e.status <> 'REMOVED'`}
        ${term ? sql`AND (e.name ILIKE ${`%${term}%`} OR e.phone_e164 ILIKE ${`%${term}%`})` : sql``}
      ORDER BY e.name, e.id
    `);

    return result.rows.map(mapEmployeeWithAssignments);
  }

  async update(
    tx: TransactionContext,
    ctx: TenantContext,
    id: string,
    patch: Partial<{
      name: string;
      phoneE164: string;
      roleNote: string | null;
      status: EmployeeStatus;
      allProjects: boolean;
      maxRequestMinor: bigint | null;
      projectIds: string[];
    }>,
  ): Promise<EmployeeWithAssignments> {
    let result;
    try {
      result = await tx.db.execute<{ id: string }>(sql`
        UPDATE employees SET
          name = COALESCE(${patch.name ?? null}, name),
          phone_e164 = COALESCE(${patch.phoneE164 ?? null}, phone_e164),
          role_note = ${patch.roleNote === undefined ? sql`role_note` : sql`${patch.roleNote}`},
          status = COALESCE(${patch.status ?? null}::employee_status, status),
          all_projects = COALESCE(${patch.allProjects ?? null}, all_projects),
          max_request_minor = ${
            patch.maxRequestMinor === undefined
              ? sql`max_request_minor`
              : sql`${patch.maxRequestMinor === null ? null : patch.maxRequestMinor.toString()}::bigint`
          },
          updated_at = now(),
          lock_version = lock_version + 1
        WHERE id = ${id}::uuid AND organization_id = ${ctx.organizationId}::uuid
        RETURNING id
      `);
    } catch (error) {
      throw translateUniqueViolation(error);
    }
    if (!result.rows[0]) throw new AppError('EMPLOYEE_NOT_FOUND');

    if (patch.projectIds !== undefined) {
      await this.replaceAssignmentsIn(tx, ctx, id, patch.projectIds);
    }

    const updated = await this.findByIdIn(tx.db, ctx, id);
    if (!updated) throw new AppError('EMPLOYEE_NOT_FOUND');
    return updated;
  }

  /**
   * Soft-remove. The row stays so `inbound_messages.employee_id` keeps pointing
   * at a real person in the forensic log, but the partial unique index no longer
   * covers it, which frees the phone number for reuse elsewhere.
   */
  async remove(tx: TransactionContext, ctx: TenantContext, id: string): Promise<void> {
    const result = await tx.db.execute<{ id: string }>(sql`
      UPDATE employees
         SET status = 'REMOVED', updated_at = now(), lock_version = lock_version + 1
       WHERE id = ${id}::uuid AND organization_id = ${ctx.organizationId}::uuid
      RETURNING id
    `);
    if (!result.rows[0]) throw new AppError('EMPLOYEE_NOT_FOUND');
    await tx.db.execute(sql`
      DELETE FROM employee_project_assignments
      WHERE employee_id = ${id}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);
  }

  /**
   * Whether this employee may raise a request against this project. Answers
   * false rather than throwing, because the caller replies to the employee on
   * WhatsApp instead of returning an HTTP error.
   */
  async canRaiseFor(ctx: TenantContext, employeeId: string, projectId: string): Promise<boolean> {
    const result = await this.db.execute<{ allowed: boolean }>(sql`
      SELECT (
        e.all_projects OR EXISTS (
          SELECT 1 FROM employee_project_assignments a
          WHERE a.employee_id = e.id
            AND a.project_id = ${projectId}::uuid
            AND a.organization_id = ${ctx.organizationId}::uuid
        )
      ) AS allowed
      FROM employees e
      WHERE e.id = ${employeeId}::uuid
        AND e.organization_id = ${ctx.organizationId}::uuid
        AND e.status = 'ACTIVE'
    `);
    return result.rows[0]?.allowed ?? false;
  }

  private async replaceAssignmentsIn(
    tx: TransactionContext,
    ctx: TenantContext,
    employeeId: string,
    projectIds: string[],
  ): Promise<void> {
    await tx.db.execute(sql`
      DELETE FROM employee_project_assignments
      WHERE employee_id = ${employeeId}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
    `);
    if (projectIds.length === 0) return;

    const unique = [...new Set(projectIds)];
    // The project ids come from a request body, so they are filtered through
    // the tenant's own projects rather than trusted. A foreign id is dropped
    // here and would fail the caller's own existence check, never silently
    // granting access to another organization's project.
    for (const projectId of unique) {
      await tx.db.execute(sql`
        INSERT INTO employee_project_assignments (organization_id, employee_id, project_id)
        SELECT ${ctx.organizationId}::uuid, ${employeeId}::uuid, p.id
        FROM projects p
        WHERE p.id = ${projectId}::uuid AND p.organization_id = ${ctx.organizationId}::uuid
        ON CONFLICT (employee_id, project_id) DO NOTHING
      `);
    }
  }
}

/**
 * Both unique constraints on `employees` are about the same mistake — one
 * number, one person — so both surface as EMPLOYEE_PHONE_TAKEN. The global
 * index fires when the number belongs to a *different* organization, which the
 * owner cannot see; the message deliberately does not say which company holds
 * it, because that would leak the existence of another tenant.
 */
function translateUniqueViolation(error: unknown): unknown {
  const code = (error as { code?: string } | null)?.code;
  const constraint = (error as { constraint?: string } | null)?.constraint;
  if (
    code === '23505' &&
    (constraint === 'employees_phone_global_idx' ||
      constraint === 'employees_organization_id_phone_e164_key')
  ) {
    return new AppError('EMPLOYEE_PHONE_TAKEN');
  }
  return error;
}

const EMPLOYEE_COLUMNS = sql`
  e.id, e.organization_id, e.name, e.phone_e164, e.role_note, e.status,
  e.all_projects, e.max_request_minor, e.created_by_user_id,
  e.created_at, e.updated_at, e.lock_version
`;

const EMPLOYEE_WITH_ASSIGNMENTS_COLUMNS = sql`
  ${EMPLOYEE_COLUMNS},
  ARRAY(
    SELECT a.project_id::text
    FROM employee_project_assignments a
    WHERE a.organization_id = e.organization_id AND a.employee_id = e.id
    ORDER BY a.project_id
  ) AS project_ids
`;

type EmployeeRecord = {
  id: string;
  organization_id: string;
  name: string;
  phone_e164: string;
  role_note: string | null;
  status: EmployeeStatus;
  all_projects: boolean;
  max_request_minor: string | null;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  lock_version: number;
  project_ids: string[];
};

function mapEmployee(row: EmployeeRecord): EmployeeRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    phoneE164: row.phone_e164,
    roleNote: row.role_note,
    status: row.status,
    allProjects: row.all_projects,
    maxRequestMinor: toBigIntOrNull(row.max_request_minor),
    createdByUserId: row.created_by_user_id,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    lockVersion: row.lock_version,
  };
}

function mapEmployeeWithAssignments(row: EmployeeRecord): EmployeeWithAssignments {
  return { ...mapEmployee(row), projectIds: row.project_ids };
}
