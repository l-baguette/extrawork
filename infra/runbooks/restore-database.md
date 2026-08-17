# Restore the database and verify audit chains

**When:** data loss, corruption, or a failed destructive migration.

Report §11.6: "After restore, run projection rebuild and audit-chain
verification before reopening writes." That ordering is not optional — a restore
that reopens writes first can interleave new events into a chain that has not
been proven intact.

## 1. Stop writes

```bash
# Scale the API and worker to zero. Reads may continue from a replica if one
# exists; the decision write path must be closed.
<provider> scale api=0 worker=0
```

Report §13.1 ranks the decision write path above everything else, so this is the
one outage that must be announced immediately.

## 2. Restore

**Managed PITR (preferred):** restore to the last known-good timestamp, which is
the moment before the first bad write. Prefer restoring to a _new_ instance so
the damaged one remains available for forensics.

**From a dump:**

```bash
createdb extrawork_restored
gunzip -c extrawork-2026-08-14T02-00Z.sql.gz | psql -d extrawork_restored
```

## 3. Verify structure before data

```bash
DATABASE_URL=<restored> pnpm db:migrate   # expect "No new migrations"
```

If this applies migrations, the backup predates the current schema. Decide
deliberately whether to roll the application back instead.

## 4. Verify the audit chains — before reopening writes

```bash
DATABASE_URL=<restored> pnpm db:verify-chain --json > /tmp/chains.json
```

Exit code 0 and `"failures": []` are required. A break here means the backup
captured tampered data or a partial write; do not reopen writes, and escalate.

## 5. Rebuild projections

```sql
SELECT * FROM project_integrity_mismatches();
```

For each project reported, follow `repair-project-totals.md`.

## 6. Reconcile side effects

A restore rewinds the outbox and job queue too, so work already performed may be
replayed. Every handler is idempotent (report §13.4), but check for the two
cases where a replay is user-visible:

```sql
-- Messages that may be sent a second time.
SELECT id, purpose, channel, status, created_at FROM messages
 WHERE created_at > :restore_point ORDER BY created_at;

-- Evidence documents that will regenerate. Regeneration is safe: the canonical
-- snapshot hash is unchanged, only the PDF bytes differ (report §8.5).
SELECT id, version_id, status FROM generated_documents
 WHERE requested_at > :restore_point;
```

## 7. Reopen and record

```bash
<provider> scale api=2 worker=1
curl -fsS https://api.<host>/readyz
```

Record the restore point, the data window lost, the chain verification result,
and every project rebuilt. Report §11.6 also requires a **monthly restore
rehearsal** into an isolated environment — log this run against that
requirement if it doubles as one.
