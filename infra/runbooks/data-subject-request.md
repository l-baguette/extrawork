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
pnpm db:export-subject --organization <id> --contact <contactId> --out /tmp/export.json
```

The export includes: contact record, every change request addressed to them,
their decisions with timestamps and achieved assurance, and the evidence manifest
digests. It excludes other customers' data.

## 3. Erasure

What can be erased, and what cannot:

| Data                           | Action                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Contact name, phone, email     | erasable — replaced with a tombstone and stamped `erased_at`                                              |
| Marketing/analytics events     | erasable                                                                                                  |
| Draft change orders never sent | erasable                                                                                                  |
| **A recorded decision**        | **not erasable** — it is the contractual record the contractor relies on, and it is append-only by design |
| **A frozen sent version**      | **not erasable** for the same reason                                                                      |
| Signer name on a decision      | not erasable; it _is_ the assent artefact                                                                 |

```bash
pnpm db:erase-contact --organization <id> --contact <contactId> \
  --operator "<email>" --reason "<ref>"    # add --dry-run to preview
```

The command pseudonymises the contact, leaves decisions intact, and emits
`data.deleted.v1`. Tell the requester plainly which data was removed and which
was retained, and why — vague answers here are worse than a clear refusal.

## 4. Organization account deletion

Report §9.8: 30-day recovery grace, then purge, unless a legal hold or
contractual necessity applies.

**The owner does steps 1 and 2 themselves.** Settings → "Close this account"
requires them to retype the business name, then marks the organization `CLOSED`,
stamps `closed_at`, and sets `purge_after` to 30 days out. The account
immediately becomes read-only — reads and exports keep working for the whole
window, which is what makes step 2 possible — and the owner can undo it from the
same screen until the purge runs. Both the request and any cancellation are
audited (`organization.closure_requested.v1`, `organization.closure_cancelled.v1`).

Operators only get involved for the destructive step:

1. Confirm the window has elapsed. The daily retention job logs
   `closed organizations are past their recovery window and awaiting operator purge`
   with the ids, and skips any organization under a legal hold.
2. Offer and produce a full export before anything is purged.
3. Re-check legal holds: `SELECT * FROM legal_holds WHERE released_at IS NULL;`
4. Purge. Dry-run first — it prints exactly what would be destroyed:

```bash
pnpm db:purge-organization --organization <id> --operator "<email>" \
  --reason "<ref>" --dry-run
# then, with --confirm set to the same organization id:
pnpm db:purge-organization --organization <id> --operator "<email>" \
  --reason "<ref>" --confirm <id>
```

It refuses unless the account is CLOSED, the window has elapsed and no hold is
open, lifts the append-only guards for one transaction, and leaves a permanent
row in `purged_organizations` — the only surviving proof the deletion happened.
`repair_events` cannot hold that record: it cascades away with the organization.

Closing an account never erases recorded decisions — the erasure table in §3
applies here too. Say so when the owner asks.

## 5. Legal hold

A hold suspends automatic deletion for explicitly scoped projects and is
audited. Retention jobs skip held projects by design.

```sql
-- `placed_by_user_id` is a users.id, not an email. NULL is allowed when the hold
-- comes from outside the product (a court order, say) rather than from a user.
INSERT INTO legal_holds (id, organization_id, project_id, reason, placed_by_user_id)
VALUES (gen_random_uuid(), :organization_id, :project_id, :reason, :placed_by_user_id);
```

Release it the same way, deliberately:

```sql
UPDATE legal_holds SET released_at = now(), released_by_user_id = :user_id
 WHERE id = :hold_id;
```
