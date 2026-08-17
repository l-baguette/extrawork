# Repair incorrect project totals

**When:** the nightly integrity job (or `/metrics`
`extrawork_integrity_mismatch_total`) reports that a project's stored
`approved_delta_minor` disagrees with a recomputation from its approved
versions.

Report §13.3 defines the required behaviour, and the job already performed the
first four steps: it marked the project `INTEGRITY_REVIEW`, blocked new sends
and evidence regeneration, preserved reads, and alerted. This runbook is step
five: the controlled rebuild.

## 1. Confirm and quantify

```sql
SELECT * FROM project_integrity_mismatches();
```

```sql
-- What the projection says versus what the versions add up to.
SELECT p.id, p.project_number, p.approved_delta_minor AS stored,
       r.approved_delta_minor AS recomputed,
       p.approved_delta_minor - r.approved_delta_minor AS drift
  FROM projects p
 CROSS JOIN LATERAL project_recomputed_totals(p.id) r
 WHERE p.id = :project_id;
```

## 2. Understand _why_ before repairing

A rebuild that hides the cause will simply recur. Check, in order:

```sql
-- Were any versions altered outside the application?
SELECT id, status, total_delta_minor, updated_at, lock_version
  FROM change_order_versions
 WHERE project_id = :project_id AND status = 'APPROVED'
 ORDER BY decided_at;

-- Does the audit chain still verify for this project's changes?
```

```bash
pnpm db:verify-chain --org <organizationId>
```

If the chain is broken, **stop**. That is a suspected tampering or restore
problem, not a projection drift: follow `restore-database.md` and escalate.

## 3. Rebuild

```bash
# Uses DATABASE_MAINTENANCE_URL; records before/after values and emits a
# repair event in the same transaction.
pnpm --filter @extrawork/db exec tsx src/cli/repair-project-totals.ts \
  --project <projectId> --operator "<your email>" --reason "<incident id>"
```

The command:

1. locks the project row,
2. recomputes from approved versions,
3. writes the new projection,
4. records old and new values in `repair_events`,
5. clears `INTEGRITY_REVIEW` only if the recomputation now matches.

## 4. Verify

```bash
pnpm db:verify-chain --org <organizationId>
```

```sql
SELECT count(*) FROM project_integrity_mismatches();  -- expect 0
SELECT status FROM projects WHERE id = :project_id;   -- expect ACTIVE
```

## 5. Close out

Record in the incident: the drift amount, the cause, whether any evidence pack
was generated while the projection was wrong (check `generated_documents` for
that project between the drift window), and whether any customer was shown an
incorrect revised total. If a customer saw a wrong number on a _sent_ version,
that version's frozen snapshot holds what they actually saw — quote it, do not
recompute it.
