import { sql } from 'drizzle-orm';
import { AppError } from '@extrawork/contracts';
import { duplicateScore, normalizeForSearch, type TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { requireRow } from './organizations.js';
import { toDate, toDateOrNull } from '../row-types.js';

/**
 * Customers and contacts. Report §7.1 (Customers module), §9.5 (normalization,
 * deduplication and merge) and §6.6 (tenant-scoped search).
 */

/**
 * The single contact shown next to a customer in the directory: their default
 * approver, or the earliest contact when none is marked. Not the full contact
 * list — that stays on the detail route.
 */
export interface CustomerApproverSummary {
  id: string;
  name: string;
  phoneE164: string | null;
  email: string | null;
  authorityNote: string | null;
}

export interface CustomerRow {
  id: string;
  organizationId: string;
  displayName: string;
  legalName: string | null;
  notes: string | null;
  mergedIntoCustomerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lockVersion: number;
}

export interface ContactRow {
  id: string;
  organizationId: string;
  customerId: string;
  name: string;
  phoneE164: string | null;
  emailNormalized: string | null;
  isDefaultApprover: boolean;
  authorityNote: string | null;
  whatsappOptInStatus: string;
  whatsappOptInAt: Date | null;
  createdAt: Date;
}

export class CustomerRepository {
  constructor(private readonly db: Database) {}

  async create(
    tx: TransactionContext,
    ctx: TenantContext,
    input: { displayName: string; legalName: string | null; notes: string | null },
  ): Promise<CustomerRow> {
    const result = await tx.db.execute<CustomerRecord>(sql`
      INSERT INTO customers (id, organization_id, display_name, legal_name, notes)
      VALUES (${newId()}::uuid, ${ctx.organizationId}::uuid,
              ${input.displayName}, ${input.legalName}, ${input.notes})
      RETURNING ${CUSTOMER_COLUMNS}
    `);
    return mapCustomer(requireRow(result.rows[0], 'customer'));
  }

  async findById(ctx: TenantContext, id: string): Promise<CustomerRow | null> {
    const result = await this.db.execute<CustomerRecord>(sql`
      SELECT ${CUSTOMER_COLUMNS} FROM customers
      WHERE id = ${id}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    return row ? mapCustomer(row) : null;
  }

  async requireById(ctx: TenantContext, id: string): Promise<CustomerRow> {
    const row = await this.findById(ctx, id);
    if (!row) throw new AppError('CUSTOMER_NOT_FOUND');
    return row;
  }

  /**
   * Keyset pagination on `(updated_at, id)`. Report §9.4: "Use keyset/cursor
   * pagination, not large offsets."
   */
  async list(
    ctx: TenantContext,
    options: { query?: string; cursor?: string; limit: number; includeMerged: boolean },
  ): Promise<{
    items: Array<CustomerRow & { projectCount: number; approver: CustomerApproverSummary | null }>;
    nextCursor: string | null;
  }> {
    const cursor = decodeCursor(options.cursor);
    const searchTerm = options.query?.trim();

    // The approver is joined rather than fetched per row: the directory shows
    // "who can approve extra cost for this customer" on every line, and doing it
    // as a follow-up query per customer is the N+1 this avoids. Only the default
    // approver is included — the full contact list stays on the detail route.
    const result = await this.db.execute<
      CustomerRecord & {
        project_count: string;
        approver_id: string | null;
        approver_name: string | null;
        approver_phone_e164: string | null;
        approver_email: string | null;
        approver_authority_note: string | null;
      }
    >(sql`
      SELECT ${CUSTOMER_COLUMNS_C},
             (SELECT count(*) FROM projects p WHERE p.customer_id = c.id)::text AS project_count,
             a.id AS approver_id,
             a.name AS approver_name,
             a.phone_e164 AS approver_phone_e164,
             a.email_normalized AS approver_email,
             a.authority_note AS approver_authority_note
      FROM customers c
      LEFT JOIN LATERAL (
        SELECT ct.id, ct.name, ct.phone_e164, ct.email_normalized, ct.authority_note
        FROM contacts ct
        WHERE ct.customer_id = c.id
          AND ct.organization_id = c.organization_id
        ORDER BY ct.is_default_approver DESC, ct.created_at
        LIMIT 1
      ) a ON true
      WHERE c.organization_id = ${ctx.organizationId}::uuid
        ${options.includeMerged ? sql`` : sql`AND c.merged_into_customer_id IS NULL`}
        ${
          searchTerm
            ? sql`AND (c.search_document @@ plainto_tsquery('simple', extrawork_unaccent(lower(${searchTerm})))
                       OR c.display_name ILIKE ${`%${searchTerm}%`})`
            : sql``
        }
        ${
          cursor
            ? sql`AND (c.updated_at, c.id) < (${cursor.updatedAt}::timestamptz, ${cursor.id}::uuid)`
            : sql``
        }
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT ${options.limit + 1}
    `);

    const rows = result.rows.slice(0, options.limit);
    const hasMore = result.rows.length > options.limit;
    const last = rows[rows.length - 1];

    return {
      items: rows.map((r) => ({
        ...mapCustomer(r),
        projectCount: Number.parseInt(r.project_count, 10),
        approver: r.approver_id
          ? {
              id: r.approver_id,
              name: r.approver_name ?? '',
              phoneE164: r.approver_phone_e164,
              email: r.approver_email,
              authorityNote: r.approver_authority_note,
            }
          : null,
      })),
      nextCursor: hasMore && last ? encodeCursor(last.updated_at, last.id) : null,
    };
  }

  async update(
    tx: TransactionContext,
    ctx: TenantContext,
    id: string,
    patch: Partial<{ displayName: string; legalName: string | null; notes: string | null }>,
    expectedLockVersion?: number,
  ): Promise<CustomerRow> {
    const result = await tx.db.execute<CustomerRecord>(sql`
      UPDATE customers SET
        display_name = COALESCE(${patch.displayName ?? null}, display_name),
        legal_name = ${patch.legalName === undefined ? sql`legal_name` : patch.legalName},
        notes = ${patch.notes === undefined ? sql`notes` : patch.notes},
        lock_version = lock_version + 1
      WHERE id = ${id}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
        ${expectedLockVersion !== undefined ? sql`AND lock_version = ${expectedLockVersion}` : sql``}
      RETURNING ${CUSTOMER_COLUMNS}
    `);
    const row = result.rows[0];
    if (!row) {
      if (expectedLockVersion !== undefined) throw new AppError('LOCK_CONFLICT');
      throw new AppError('CUSTOMER_NOT_FOUND');
    }
    return mapCustomer(row);
  }

  // --- Contacts ------------------------------------------------------------

  async addContact(
    tx: TransactionContext,
    ctx: TenantContext,
    customerId: string,
    input: {
      name: string;
      phoneE164: string | null;
      email: string | null;
      isDefaultApprover: boolean;
      authorityNote: string | null;
    },
  ): Promise<ContactRow> {
    // Only one default approver per customer, enforced by a partial unique
    // index; clear the previous one first.
    if (input.isDefaultApprover) {
      await tx.db.execute(sql`
        UPDATE contacts SET is_default_approver = false
        WHERE customer_id = ${customerId}::uuid
          AND organization_id = ${ctx.organizationId}::uuid
          AND is_default_approver
      `);
    }

    const result = await tx.db.execute<ContactRecord>(sql`
      INSERT INTO contacts
        (id, organization_id, customer_id, name, phone_e164, email_normalized,
         is_default_approver, authority_note)
      VALUES (
        ${newId()}::uuid, ${ctx.organizationId}::uuid, ${customerId}::uuid,
        ${input.name}, ${input.phoneE164}, ${input.email},
        ${input.isDefaultApprover}, ${input.authorityNote}
      )
      RETURNING ${CONTACT_COLUMNS}
    `);
    return mapContact(requireRow(result.rows[0], 'contact'));
  }

  async listContacts(ctx: TenantContext, customerId: string): Promise<ContactRow[]> {
    const result = await this.db.execute<ContactRecord>(sql`
      SELECT ${CONTACT_COLUMNS} FROM contacts
      WHERE organization_id = ${ctx.organizationId}::uuid AND customer_id = ${customerId}::uuid
      ORDER BY is_default_approver DESC, created_at
    `);
    return result.rows.map(mapContact);
  }

  async findContact(ctx: TenantContext, contactId: string): Promise<ContactRow | null> {
    const result = await this.db.execute<ContactRecord>(sql`
      SELECT ${CONTACT_COLUMNS} FROM contacts
      WHERE id = ${contactId}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    return row ? mapContact(row) : null;
  }

  async requireContact(ctx: TenantContext, contactId: string): Promise<ContactRow> {
    const row = await this.findContact(ctx, contactId);
    if (!row) throw new AppError('CONTACT_NOT_FOUND');
    return row;
  }

  async updateContact(
    tx: TransactionContext,
    ctx: TenantContext,
    contactId: string,
    patch: Partial<{
      name: string;
      phoneE164: string | null;
      email: string | null;
      isDefaultApprover: boolean;
      authorityNote: string | null;
      whatsappOptInStatus: 'UNKNOWN' | 'OPTED_IN' | 'OPTED_OUT';
    }>,
  ): Promise<ContactRow> {
    if (patch.isDefaultApprover) {
      await tx.db.execute(sql`
        UPDATE contacts SET is_default_approver = false
        WHERE organization_id = ${ctx.organizationId}::uuid
          AND customer_id = (SELECT customer_id FROM contacts WHERE id = ${contactId}::uuid)
          AND id <> ${contactId}::uuid
          AND is_default_approver
      `);
    }

    const result = await tx.db.execute<ContactRecord>(sql`
      UPDATE contacts SET
        name = COALESCE(${patch.name ?? null}, name),
        phone_e164 = ${patch.phoneE164 === undefined ? sql`phone_e164` : patch.phoneE164},
        email_normalized = ${patch.email === undefined ? sql`email_normalized` : patch.email},
        is_default_approver = COALESCE(${patch.isDefaultApprover ?? null}, is_default_approver),
        authority_note = ${patch.authorityNote === undefined ? sql`authority_note` : patch.authorityNote},
        whatsapp_opt_in_status = COALESCE(${patch.whatsappOptInStatus ?? null}, whatsapp_opt_in_status),
        whatsapp_opt_in_at = ${
          patch.whatsappOptInStatus === 'OPTED_IN' ? sql`now()` : sql`whatsapp_opt_in_at`
        }
      WHERE id = ${contactId}::uuid AND organization_id = ${ctx.organizationId}::uuid
      RETURNING ${CONTACT_COLUMNS}
    `);
    const row = result.rows[0];
    if (!row) throw new AppError('CONTACT_NOT_FOUND');
    return mapContact(row);
  }

  // --- Deduplication and merge (report §9.5) -------------------------------

  async findDuplicateCandidates(
    ctx: TenantContext,
    customerId: string,
  ): Promise<Array<{ customerId: string; displayName: string; score: number; reasons: string[] }>> {
    const result = await this.db.execute<{
      id: string;
      display_name: string;
      same_phone: boolean;
      same_email: boolean;
      name_similarity: number;
    }>(sql`
      WITH target AS (
        SELECT c.id, c.display_name,
               array_agg(DISTINCT ct.phone_e164) FILTER (WHERE ct.phone_e164 IS NOT NULL) AS phones,
               array_agg(DISTINCT ct.email_normalized) FILTER (WHERE ct.email_normalized IS NOT NULL) AS emails
        FROM customers c
        LEFT JOIN contacts ct ON ct.customer_id = c.id
        WHERE c.id = ${customerId}::uuid AND c.organization_id = ${ctx.organizationId}::uuid
        GROUP BY c.id, c.display_name
      )
      SELECT o.id, o.display_name,
             EXISTS (
               SELECT 1 FROM contacts oc
               WHERE oc.customer_id = o.id AND oc.phone_e164 = ANY(t.phones)
             ) AS same_phone,
             EXISTS (
               SELECT 1 FROM contacts oc
               WHERE oc.customer_id = o.id AND oc.email_normalized = ANY(t.emails)
             ) AS same_email,
             similarity(o.display_name, t.display_name) AS name_similarity
      FROM customers o
      CROSS JOIN target t
      WHERE o.organization_id = ${ctx.organizationId}::uuid
        AND o.id <> t.id
        AND o.merged_into_customer_id IS NULL
      ORDER BY name_similarity DESC
      LIMIT 20
    `);

    return result.rows
      .map((r) => {
        const reasons: string[] = [];
        if (r.same_phone) reasons.push('SAME_PHONE');
        if (r.same_email) reasons.push('SAME_EMAIL');
        if (r.name_similarity >= 0.5) reasons.push('SIMILAR_NAME');
        return {
          customerId: r.id,
          displayName: r.display_name,
          score: duplicateScore({
            samePhone: r.same_phone,
            sameEmail: r.same_email,
            nameSimilarity: r.name_similarity,
          }),
          reasons,
        };
      })
      .filter((c) => c.reasons.length > 0 && c.score >= 0.5);
  }

  /**
   * Merge is never automatic (report §9.5). Source ids survive through
   * `merged_into_customer_id` so historical evidence keeps resolving, and
   * projects/contacts are re-pointed at the surviving record.
   */
  async merge(
    tx: TransactionContext,
    ctx: TenantContext,
    targetCustomerId: string,
    sourceCustomerId: string,
  ): Promise<{ movedProjects: number; movedContacts: number }> {
    if (targetCustomerId === sourceCustomerId) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'A customer cannot be merged into itself',
      });
    }

    const projects = await tx.db.execute(sql`
      UPDATE projects SET customer_id = ${targetCustomerId}::uuid
      WHERE customer_id = ${sourceCustomerId}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
    `);
    const contacts = await tx.db.execute(sql`
      UPDATE contacts SET customer_id = ${targetCustomerId}::uuid, is_default_approver = false
      WHERE customer_id = ${sourceCustomerId}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
    `);
    const merged = await tx.db.execute(sql`
      UPDATE customers SET merged_into_customer_id = ${targetCustomerId}::uuid,
                           lock_version = lock_version + 1
      WHERE id = ${sourceCustomerId}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
        AND merged_into_customer_id IS NULL
    `);
    if ((merged.rowCount ?? 0) === 0) {
      throw new AppError('CUSTOMER_NOT_FOUND', {
        message: 'The source customer could not be merged. It may already be merged.',
      });
    }

    return { movedProjects: projects.rowCount ?? 0, movedContacts: contacts.rowCount ?? 0 };
  }

  /** Follows the merge pointer so an old id still resolves. */
  async resolveMerged(ctx: TenantContext, customerId: string): Promise<string> {
    const result = await this.db.execute<{ id: string }>(sql`
      WITH RECURSIVE chain AS (
        SELECT id, merged_into_customer_id, 0 AS depth
        FROM customers
        WHERE id = ${customerId}::uuid AND organization_id = ${ctx.organizationId}::uuid
        UNION ALL
        SELECT c.id, c.merged_into_customer_id, chain.depth + 1
        FROM customers c
        JOIN chain ON c.id = chain.merged_into_customer_id
        WHERE chain.depth < 10
      )
      SELECT id FROM chain WHERE merged_into_customer_id IS NULL LIMIT 1
    `);
    return result.rows[0]?.id ?? customerId;
  }

  /** Normalised search text, exposed for tests and the seed script. */
  static searchText(displayName: string, legalName: string | null, notes: string | null): string {
    return normalizeForSearch([displayName, legalName, notes].filter(Boolean).join(' '));
  }
}

/**
 * `RETURNING` and un-joined selects address the table directly; joined reads
 * alias it as `c`. Keeping both spellings avoids a "missing FROM-clause entry"
 * at runtime, which a type checker cannot catch inside a SQL template.
 */
const CUSTOMER_COLUMNS = sql`
  id, organization_id, display_name, legal_name, notes,
  merged_into_customer_id, created_at, updated_at, lock_version
`;

const CUSTOMER_COLUMNS_C = sql`
  c.id, c.organization_id, c.display_name, c.legal_name, c.notes,
  c.merged_into_customer_id, c.created_at, c.updated_at, c.lock_version
`;

const CONTACT_COLUMNS = sql`
  id, organization_id, customer_id, name, phone_e164, email_normalized,
  is_default_approver, authority_note, whatsapp_opt_in_status, whatsapp_opt_in_at, created_at
`;

type CustomerRecord = {
  id: string;
  organization_id: string;
  display_name: string;
  legal_name: string | null;
  notes: string | null;
  merged_into_customer_id: string | null;
  created_at: Date;
  updated_at: Date;
  lock_version: number;
};

type ContactRecord = {
  id: string;
  organization_id: string;
  customer_id: string;
  name: string;
  phone_e164: string | null;
  email_normalized: string | null;
  is_default_approver: boolean;
  authority_note: string | null;
  whatsapp_opt_in_status: string;
  whatsapp_opt_in_at: Date | null;
  created_at: Date;
};

function mapCustomer(row: CustomerRecord): CustomerRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    displayName: row.display_name,
    legalName: row.legal_name,
    notes: row.notes,
    mergedIntoCustomerId: row.merged_into_customer_id,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    lockVersion: row.lock_version,
  };
}

function mapContact(row: ContactRecord): ContactRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    customerId: row.customer_id,
    name: row.name,
    phoneE164: row.phone_e164,
    emailNormalized: row.email_normalized,
    isDefaultApprover: row.is_default_approver,
    authorityNote: row.authority_note,
    whatsappOptInStatus: row.whatsapp_opt_in_status,
    whatsappOptInAt: toDateOrNull(row.whatsapp_opt_in_at),
    createdAt: toDate(row.created_at),
  };
}

export function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(`${updatedAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { updatedAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [updatedAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!updatedAt || !id) return null;
    return { updatedAt, id };
  } catch {
    throw new AppError('VALIDATION_FAILED', { message: 'That pagination cursor is not valid' });
  }
}
