# Handle a data access, export or deletion request

Report §9.8 and §12.3. The central tension: a data-principal erasure request
meets a contractual evidence record that another party (the contractor) relies
on. Report §9.8 is explicit — "Data-subject requests are reconciled against
contractual evidence requirements rather than blindly deleting shared records."

Log every request in `data_subject_requests` on receipt.

## 1. Identify the requester's role

| Requester                   | Usually                                                              | Route                                             |
| --------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| A contractor's staff member | user of the organization                                             | the organization handles it                       |
| A customer/approver         | data principal; the **organization** is typically the Data Fiduciary | notify the organization, act on their instruction |
| The organization itself     | account closure                                                      | §4 below                                          |

ExtraWork rarely acts unilaterally on an approver's data: the contractor holds
the underlying relationship. Notify the organization and record their decision.

## 2. Access and export

Always available, and never gated on billing status (§16.3 launch blocker):

```bash
pnpm --filter @extrawork/db exec tsx src/cli/export-subject.ts \
  --organization <id> --contact <contactId> --out /tmp/export.json
```

The export includes: contact record, every change request addressed to them,
their decisions with timestamps and achieved assurance, and the evidence manifest
digests. It excludes other customers' data.

## 3. Erasure

What can be erased, and what cannot:

| Data                           | Action                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Contact name, phone, email     | erasable — replaced with a tombstone                                                                      |
| Marketing/analytics events     | erasable                                                                                                  |
| Draft change orders never sent | erasable                                                                                                  |
| **A recorded decision**        | **not erasable** — it is the contractual record the contractor relies on, and it is append-only by design |
| **A frozen sent version**      | **not erasable** for the same reason                                                                      |
| Signer name on a decision      | not erasable; it _is_ the assent artefact                                                                 |

```bash
pnpm --filter @extrawork/db exec tsx src/cli/erase-contact.ts \
  --organization <id> --contact <contactId> --operator "<email>" --reason "<ref>"
```

The command pseudonymises the contact, leaves decisions intact, and emits
`data.deleted.v1`. Tell the requester plainly which data was removed and which
was retained, and why — vague answers here are worse than a clear refusal.

## 4. Organization account deletion

Report §9.8: 30-day recovery grace, then purge, unless a legal hold or
contractual necessity applies.

1. Mark the organization `CLOSED`; reads and exports continue.
2. Offer and produce a full export before anything is purged.
3. Check for legal holds: `SELECT * FROM legal_holds WHERE released_at IS NULL;`
4. After 30 days, purge. Record the purge in `repair_events`.

## 5. Legal hold

A hold suspends automatic deletion for explicitly scoped projects and is
audited. Retention jobs skip held projects by design.

```sql
INSERT INTO legal_holds (id, organization_id, project_id, reason, created_by)
VALUES (gen_random_uuid(), :organization_id, :project_id, :reason, :operator);
```
