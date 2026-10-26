import { sql } from 'drizzle-orm';
import type { MembershipRole, NotificationKind } from '@extrawork/contracts';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate, toDateOrNull } from '../row-types.js';
import { runInScope, SYSTEM_SCOPE } from '../tenant-scope.js';

/**
 * Notifications — migration 0023, spec 2026-10-12 D14.
 *
 * One row per recipient, written in the same transaction as the event that
 * caused it. The audience is resolved at that moment from memberships and
 * project grants, so somebody removed from a project tomorrow keeps what they
 * were told and is told nothing more.
 */

export interface NotificationRow {
  id: string;
  organizationId: string;
  userId: string;
  projectId: string | null;
  kind: NotificationKind;
  title: string;
  body: string | null;
  linkPath: string | null;
  actorLabel: string | null;
  createdAt: Date;
  readAt: Date | null;
}

export interface NewNotification {
  userId: string;
  projectId: string | null;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  linkPath?: string | null;
  actorLabel?: string | null;
  /** Makes repeated writes of the same reminder collapse to one row. */
  dedupeKey?: string | null;
}

export interface NotificationPreferencesRow {
  emailEnabled: boolean;
  completionReminders: boolean;
  reminderLeadDays: number;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesRow = {
  emailEnabled: true,
  completionReminders: true,
  reminderLeadDays: 3,
};

/** Someone who should hear about an event on a project. */
export interface AudienceMember {
  userId: string;
  role: MembershipRole;
  displayName: string;
  email: string;
}

/**
 * `DESIGNERS` — the firm's people who act on a project: OWNER and ADMIN (who
 * see everything) and any PROJECT_MANAGER granted the project.
 * `EVERYONE` — the designers plus every other member granted the project,
 * collaborators included.
 */
export type ProjectAudience = 'DESIGNERS' | 'EVERYONE';

export class NotificationRepository {
  constructor(private readonly db: Database) {}

  /**
   * Inserts one row per recipient and returns the rows actually written. A
   * row whose dedupe key already exists for that user is skipped, which is what
   * makes the daily reminder sweep safe to run on every worker replica.
   */
  async insertMany(
    tx: TransactionContext,
    ctx: TenantContext,
    rows: readonly NewNotification[],
  ): Promise<NotificationRow[]> {
    const written: NotificationRow[] = [];
    for (const row of rows) {
      const result = await tx.db.execute<NotificationRecord>(sql`
        INSERT INTO notifications
          (id, organization_id, user_id, project_id, kind, title, body, link_path,
           actor_label, dedupe_key)
        VALUES (
          ${newId()}::uuid, ${ctx.organizationId}::uuid, ${row.userId}::uuid,
          ${row.projectId}::uuid, ${row.kind}, ${truncate(row.title, 200)},
          ${row.body ? truncate(row.body, 1000) : null}, ${row.linkPath ?? null},
          ${row.actorLabel ? truncate(row.actorLabel, 200) : null}, ${row.dedupeKey ?? null}
        )
        ON CONFLICT (organization_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
        DO NOTHING
        RETURNING ${COLUMNS}
      `);
      const inserted = result.rows[0];
      if (inserted) written.push(mapNotification(inserted));
    }
    return written;
  }

  async findById(db: Database, ctx: TenantContext, id: string): Promise<NotificationRow | null> {
    const result = await db.execute<NotificationRecord>(sql`
      SELECT ${COLUMNS} FROM notifications
      WHERE organization_id = ${ctx.organizationId}::uuid AND id = ${id}::uuid
    `);
    const row = result.rows[0];
    return row ? mapNotification(row) : null;
  }

  /** Newest first, keyset-paginated on (created_at, id). */
  async listForUser(
    ctx: TenantContext,
    userId: string,
    options: { unreadOnly?: boolean; cursor?: string; limit: number },
  ): Promise<{ items: NotificationRow[]; nextCursor: string | null; unreadCount: number }> {
    const cursor = decodeCursor(options.cursor);
    const result = await this.db.execute<NotificationRecord>(sql`
      SELECT ${COLUMNS} FROM notifications
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND user_id = ${userId}::uuid
        ${options.unreadOnly ? sql`AND read_at IS NULL` : sql``}
        ${
          cursor
            ? sql`AND (created_at, id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
            : sql``
        }
      ORDER BY created_at DESC, id DESC
      LIMIT ${options.limit + 1}
    `);
    const rows = result.rows.map(mapNotification);
    const page = rows.slice(0, options.limit);
    const last = page[page.length - 1];
    const unread = await this.db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM notifications
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND user_id = ${userId}::uuid AND read_at IS NULL
    `);
    return {
      items: page,
      nextCursor: rows.length > options.limit && last ? encodeCursor(last) : null,
      unreadCount: Number.parseInt(unread.rows[0]?.count ?? '0', 10),
    };
  }

  async markRead(
    tx: TransactionContext,
    ctx: TenantContext,
    userId: string,
    target: { ids: readonly string[] } | { all: true },
  ): Promise<number> {
    const result =
      'all' in target
        ? await tx.db.execute(sql`
            UPDATE notifications SET read_at = now()
            WHERE organization_id = ${ctx.organizationId}::uuid
              AND user_id = ${userId}::uuid AND read_at IS NULL
          `)
        : await tx.db.execute(sql`
            UPDATE notifications SET read_at = now()
            WHERE organization_id = ${ctx.organizationId}::uuid
              AND user_id = ${userId}::uuid AND read_at IS NULL
              AND id = ANY(${`{${target.ids.join(',')}}`}::uuid[])
          `);
    return result.rowCount ?? 0;
  }

  /**
   * Unread counts across every workspace the user belongs to, for the badge on
   * the workspace switcher.
   *
   * System-scoped because it deliberately spans tenants — but only the
   * caller's own rows, keyed on their user id from the session, and only
   * workspaces where their membership is still active.
   */
  async unreadSummaryForUser(
    userId: string,
  ): Promise<Array<{ organizationId: string; unreadCount: number }>> {
    const result = await runInScope(SYSTEM_SCOPE, () =>
      this.db.execute<{ organization_id: string; unread: string }>(sql`
        SELECT n.organization_id, count(*)::text AS unread
        FROM notifications n
        JOIN memberships m
          ON m.organization_id = n.organization_id AND m.user_id = n.user_id
        WHERE n.user_id = ${userId}::uuid AND n.read_at IS NULL AND m.status = 'ACTIVE'
        GROUP BY n.organization_id
      `),
    );
    return result.rows.map((r) => ({
      organizationId: r.organization_id,
      unreadCount: Number.parseInt(r.unread, 10),
    }));
  }

  // --- Preferences -----------------------------------------------------------

  async getPreferences(
    db: Database,
    ctx: TenantContext,
    userId: string,
  ): Promise<NotificationPreferencesRow> {
    const result = await db.execute<{
      email_enabled: boolean;
      completion_reminders: boolean;
      reminder_lead_days: number;
    }>(sql`
      SELECT email_enabled, completion_reminders, reminder_lead_days
      FROM notification_preferences
      WHERE organization_id = ${ctx.organizationId}::uuid AND user_id = ${userId}::uuid
    `);
    const row = result.rows[0];
    if (!row) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    return {
      emailEnabled: row.email_enabled,
      completionReminders: row.completion_reminders,
      reminderLeadDays: row.reminder_lead_days,
    };
  }

  async upsertPreferences(
    tx: TransactionContext,
    ctx: TenantContext,
    userId: string,
    prefs: NotificationPreferencesRow,
  ): Promise<NotificationPreferencesRow> {
    await tx.db.execute(sql`
      INSERT INTO notification_preferences
        (organization_id, user_id, email_enabled, completion_reminders, reminder_lead_days)
      VALUES (
        ${ctx.organizationId}::uuid, ${userId}::uuid, ${prefs.emailEnabled},
        ${prefs.completionReminders}, ${prefs.reminderLeadDays}
      )
      ON CONFLICT (organization_id, user_id) DO UPDATE SET
        email_enabled = EXCLUDED.email_enabled,
        completion_reminders = EXCLUDED.completion_reminders,
        reminder_lead_days = EXCLUDED.reminder_lead_days,
        updated_at = now()
    `);
    return prefs;
  }

  // --- Audience ---------------------------------------------------------------

  /**
   * The people to tell about something that happened on a project, from
   * memberships and grants as they stand right now. Only ACTIVE memberships in
   * this organization; a collaborator is included only with a grant on the
   * project.
   */
  async projectAudience(
    db: Database,
    ctx: TenantContext,
    projectId: string,
    audience: ProjectAudience,
  ): Promise<AudienceMember[]> {
    const result = await db.execute<{
      user_id: string;
      role: MembershipRole;
      display_name: string;
      email_normalized: string;
    }>(sql`
      SELECT m.user_id, m.role, u.display_name, u.email_normalized
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${ctx.organizationId}::uuid
        AND m.status = 'ACTIVE'
        AND (
          m.role IN ('OWNER', 'ADMIN')
          OR (
            ${audience === 'EVERYONE' ? sql`true` : sql`m.role = 'PROJECT_MANAGER'`}
            AND EXISTS (
              SELECT 1 FROM project_members pm
              WHERE pm.organization_id = m.organization_id
                AND pm.project_id = ${projectId}::uuid
                AND pm.user_id = m.user_id
            )
          )
        )
      ORDER BY m.created_at
    `);
    return result.rows.map((r) => ({
      userId: r.user_id,
      role: r.role,
      displayName: r.display_name,
      email: r.email_normalized,
    }));
  }

  /** Designers of the whole organization, for events not tied to one project. */
  async organizationDesigners(db: Database, ctx: TenantContext): Promise<AudienceMember[]> {
    const result = await db.execute<{
      user_id: string;
      role: MembershipRole;
      display_name: string;
      email_normalized: string;
    }>(sql`
      SELECT m.user_id, m.role, u.display_name, u.email_normalized
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${ctx.organizationId}::uuid
        AND m.status = 'ACTIVE'
        AND m.role IN ('OWNER', 'ADMIN')
      ORDER BY m.created_at
    `);
    return result.rows.map((r) => ({
      userId: r.user_id,
      role: r.role,
      displayName: r.display_name,
      email: r.email_normalized,
    }));
  }
}

const COLUMNS = sql`
  id, organization_id, user_id, project_id, kind, title, body, link_path,
  actor_label, created_at, read_at
`;

type NotificationRecord = {
  id: string;
  organization_id: string;
  user_id: string;
  project_id: string | null;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link_path: string | null;
  actor_label: string | null;
  created_at: Date | string;
  read_at: Date | string | null;
};

function mapNotification(row: NotificationRecord): NotificationRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    projectId: row.project_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    linkPath: row.link_path,
    actorLabel: row.actor_label,
    createdAt: toDate(row.created_at),
    readAt: toDateOrNull(row.read_at),
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function encodeCursor(row: NotificationRow): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const [createdAt, id] = decoded.split('|');
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { createdAt, id };
}
