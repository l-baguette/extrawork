#!/usr/bin/env tsx
/**
 * Data-subject access export — report §9.8, DPDP Act 2023 s.11, and the
 * `data-subject-request` runbook.
 *
 * Produces everything ExtraWork holds about one customer contact: the contact
 * record, every change request addressed to them, the decisions they made with
 * timestamps and achieved assurance, and the evidence digests. It deliberately
 * excludes other customers' data, and never returns an approval token — only
 * the hash of one is stored, and handing out live links in an export would turn
 * a subject-access request into a way to approve someone else's work.
 *
 * The runbook is explicit that this is available regardless of billing status:
 * an access right withheld over an unpaid invoice is not a right.
 *
 *   pnpm --filter @extrawork/db exec tsx src/cli/export-subject.ts \
 *     --organization <uuid> --contact <uuid> --out /tmp/export.json
 */
import { writeFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { loadConfig } from '@extrawork/config';
import { formatCliError } from './describe-error.js';
import { createUnitOfWork } from '../client.js';
import { SYSTEM_SCOPE, setProcessDefaultScope } from '../tenant-scope.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const organizationId = arg('organization');
const contactId = arg('contact');
const out = arg('out');

if (!organizationId || !contactId) {
  process.stderr.write(
    'usage: export-subject.ts --organization <uuid> --contact <uuid> [--out <path>]\n',
  );
  process.exit(1);
}

// Operator tooling acts across tenants by definition.
setProcessDefaultScope(SYSTEM_SCOPE);

const config = loadConfig();
const uow = createUnitOfWork({
  connectionString: config.DATABASE_MAINTENANCE_URL ?? config.DATABASE_URL,
  ssl: config.DATABASE_SSL,
  applicationName: 'extrawork-export-subject',
  statementTimeoutMs: 120_000,
});

try {
  const contactResult = await uow.db.execute<Record<string, unknown>>(sql`
    SELECT c.id, c.name, c.phone_e164, c.email_normalized, c.authority_note,
           c.is_default_approver, c.whatsapp_opt_in_status, c.whatsapp_opt_in_at,
           c.erased_at, c.created_at,
           cu.id AS customer_id, cu.display_name AS customer_name
      FROM contacts c
      JOIN customers cu ON cu.id = c.customer_id
     WHERE c.id = ${contactId}::uuid AND c.organization_id = ${organizationId}::uuid
  `);
  const contact = contactResult.rows[0];
  if (!contact) {
    throw new Error(`Contact ${contactId} not found in organization ${organizationId}`);
  }

  // Requests addressed to this contact. Scoped through the version's approver so
  // a request that was re-addressed to somebody else does not appear here.
  const requests = await uow.db.execute<Record<string, unknown>>(sql`
    SELECT co.id AS change_order_id, co.number, v.title, v.type, v.status,
           v.version_number, v.total_delta_minor, v.revised_contract_total_minor,
           v.schedule_delta_days, v.assurance_required,
           encode(v.canonical_sha256, 'hex') AS snapshot_digest,
           v.canonicalizer_version, v.terms_version, v.sent_at, v.decided_at
      FROM change_order_versions v
      JOIN change_orders co ON co.id = v.change_order_id
     WHERE v.organization_id = ${organizationId}::uuid
       AND v.approver_contact_id = ${contactId}::uuid
     ORDER BY co.number, v.version_number
  `);

  const decisions = await uow.db.execute<Record<string, unknown>>(sql`
    SELECT d.id, d.type, d.signer_name, d.signed_date, d.signed_place,
           d.signer_comment, d.occurred_at, d.assurance_achieved, d.terms_version,
           d.declaration_text, d.receipt_display_id, co.number, v.version_number
      FROM decisions d
      JOIN change_order_versions v ON v.id = d.version_id
      JOIN change_orders co ON co.id = v.change_order_id
     WHERE d.organization_id = ${organizationId}::uuid
       AND v.approver_contact_id = ${contactId}::uuid
     ORDER BY d.occurred_at
  `);

  const messages = await uow.db.execute<Record<string, unknown>>(sql`
    SELECT id, channel, purpose, status, recipient_kind, recipient_name, sent_at
      FROM messages
     WHERE organization_id = ${organizationId}::uuid AND contact_id = ${contactId}::uuid
     ORDER BY created_at
  `);

  const bundle = {
    exportedAt: new Date().toISOString(),
    organizationId,
    subject: contact,
    changeRequestsAddressedToSubject: requests.rows,
    decisionsMadeBySubject: decisions.rows,
    messagesSentToSubject: messages.rows,
    notes: [
      'Approval links are omitted deliberately: only a hash of each token is stored, ' +
        'and a live link would let the holder act on the request.',
      'Recorded decisions and the frozen versions they refer to are retained even after ' +
        'an erasure request, because they are the counterparty’s contractual evidence ' +
        '(report §9.8).',
    ],
  };

  const json = `${JSON.stringify(bundle, null, 2)}\n`;
  if (out) {
    await writeFile(out, json, 'utf8');
    process.stdout.write(
      `\n  Export written to ${out}\n` +
        `    requests:  ${requests.rows.length}\n` +
        `    decisions: ${decisions.rows.length}\n` +
        `    messages:  ${messages.rows.length}\n\n`,
    );
  } else {
    process.stdout.write(json);
  }
} catch (error) {
  process.stderr.write(`${formatCliError('Export failed', error, config.DATABASE_URL)}\n`);
  process.exitCode = 1;
} finally {
  await uow.pool.end();
}
