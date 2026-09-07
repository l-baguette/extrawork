#!/usr/bin/env tsx
/**
 * Erasure of a customer contact's personal data — report §9.8, DPDP Act 2023
 * s.12(3), and the `data-subject-request` runbook.
 *
 * The central tension: an erasure request from one party meets a contractual
 * record the other party relies on. Report §9.8 resolves it — "Data-subject
 * requests are reconciled against contractual evidence requirements rather than
 * blindly deleting shared records." So this command pseudonymises the contact
 * and stops there.
 *
 * Removed: the contact's name, phone number, email address and authority note.
 *
 * Deliberately kept: decisions, the frozen versions that were sent, and the
 * signer name recorded on a decision. Those are append-only by design and the
 * database will refuse to change them anyway — the signer name *is* the assent,
 * and deleting it would destroy the contractor's evidence that the work was
 * agreed. Tell the requester exactly this; the runbook is explicit that a vague
 * answer is worse than a clear refusal.
 *
 *   pnpm --filter @extrawork/db exec tsx src/cli/erase-contact.ts \
 *     --organization <uuid> --contact <uuid> --operator "ops@example.com" \
 *     --reason "DSR-123" [--dry-run]
 */
import { sql } from 'drizzle-orm';
import { loadConfig } from '@extrawork/config';
import { DOMAIN_EVENTS } from '@extrawork/contracts';
import { systemTenantContext } from '@extrawork/domain';
import { formatCliError } from './describe-error.js';
import { createUnitOfWork } from '../client.js';
import { SYSTEM_SCOPE, setProcessDefaultScope } from '../tenant-scope.js';
import { PostgresAuditWriter } from '../repositories/audit.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const organizationId = arg('organization');
const contactId = arg('contact');
const operator = arg('operator');
const reason = arg('reason');
const dryRun = process.argv.includes('--dry-run');

if (!organizationId || !contactId || !operator || !reason) {
  process.stderr.write(
    'usage: erase-contact.ts --organization <uuid> --contact <uuid> ' +
      '--operator <email> --reason <ref> [--dry-run]\n',
  );
  process.exit(1);
}

// Operator tooling acts across tenants by definition.
setProcessDefaultScope(SYSTEM_SCOPE);

const config = loadConfig();
// The runtime role cannot write here by design; erasure is a maintenance act.
const uow = createUnitOfWork({
  connectionString: config.DATABASE_MAINTENANCE_URL ?? config.DATABASE_URL,
  ssl: config.DATABASE_SSL,
  applicationName: 'extrawork-erase-contact',
  statementTimeoutMs: 60_000,
});

/**
 * A tombstone rather than an empty string: a blank name renders as a missing
 * field everywhere and reads like a bug, where "Erased contact" tells whoever
 * opens the record later that this was a decision somebody made.
 */
const TOMBSTONE = 'Erased contact';

const audit = new PostgresAuditWriter();

try {
  const result = await uow.transaction(async (tx) => {
    const found = await tx.db.execute<{ id: string; customer_id: string }>(sql`
      SELECT id, customer_id
        FROM contacts
       WHERE id = ${contactId}::uuid AND organization_id = ${organizationId}::uuid
       FOR UPDATE
    `);
    const contact = found.rows[0];
    if (!contact) {
      throw new Error(`Contact ${contactId} not found in organization ${organizationId}`);
    }

    // Counted before the change so the operator can quote real numbers back to
    // the requester rather than "some records".
    const retained = await tx.db.execute<{ decisions: string; messages: string }>(sql`
      SELECT
        (SELECT count(*) FROM decisions d
           JOIN change_order_versions v ON v.id = d.version_id
          WHERE d.organization_id = ${organizationId}::uuid
            AND v.approver_contact_id = ${contactId}::uuid
        )::text AS decisions,
        (SELECT count(*) FROM messages m
          WHERE m.organization_id = ${organizationId}::uuid
            AND m.contact_id = ${contactId}::uuid
        )::text AS messages
    `);

    if (dryRun) return { customerId: contact.customer_id, retained: retained.rows[0] };

    await tx.db.execute(sql`
      UPDATE contacts SET
        name = ${TOMBSTONE},
        phone_e164 = NULL,
        email_normalized = NULL,
        authority_note = NULL,
        whatsapp_opt_in_status = 'OPTED_OUT',
        erased_at = now(),
        updated_at = now()
      WHERE id = ${contactId}::uuid AND organization_id = ${organizationId}::uuid
    `);

    // The erasure is itself evidence: a regulator asking "did you honour it?"
    // needs a record, and it goes through the audit writer rather than a raw
    // INSERT so the hash chain stays verifiable by `pnpm db:verify-chain`.
    await audit.append(tx, systemTenantContext(organizationId, `cli:erase-contact:${contactId}`), [
      {
        aggregateType: 'customer',
        aggregateId: contact.customer_id,
        projectId: null,
        eventType: DOMAIN_EVENTS.DATA_DELETED,
        actorType: 'SYSTEM',
        actorId: null,
        occurredAt: new Date(),
        payload: {
          contactId,
          operator,
          reason,
          erased: ['name', 'phoneE164', 'email', 'authorityNote'],
          retained: ['decisions', 'sentVersions', 'signerNames'],
        },
      },
    ]);

    return { customerId: contact.customer_id, retained: retained.rows[0] };
  });

  const decisions = Number(result.retained?.decisions ?? '0');
  const messages = Number(result.retained?.messages ?? '0');

  process.stdout.write(
    [
      '',
      dryRun ? '  DRY RUN — nothing was changed' : '  Contact erased',
      '',
      `    organization: ${organizationId}`,
      `    contact:      ${contactId}`,
      `    operator:     ${operator}`,
      `    reason:       ${reason}`,
      '',
      '    Removed:  name, phone number, email address, authority note',
      `    Retained: ${decisions} decision(s) and ${messages} sent message(s), including`,
      '              any signer name recorded on a decision.',
      '',
      '    Tell the requester both halves of that, and why: a recorded decision is',
      '    the contractor’s contractual evidence and is append-only by design',
      '    (report §9.8).',
      '',
    ].join('\n'),
  );
} catch (error) {
  process.stderr.write(`${formatCliError('Erasure failed', error, config.DATABASE_URL)}\n`);
  process.exitCode = 1;
} finally {
  await uow.pool.end();
}
