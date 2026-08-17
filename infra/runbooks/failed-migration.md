# Recover from a failed migration

Report §11.4 requires expand-and-contract migrations: "Add nullable
columns/tables first, deploy compatible code, backfill asynchronously, then add
constraints/remove old paths in a later release. Never combine a destructive
migration with code that assumes it completed everywhere."

Following that rule is what makes this runbook short.

## 1. Establish what actually applied

Each migration runs in its own transaction, so a failure leaves that file
entirely unapplied — never half-applied.

```sql
SELECT version, checksum, applied_at
  FROM schema_migrations ORDER BY version;
```

Compare against `packages/db/migrations/`. The first missing file is where it
stopped.

## 2. Decide: fix forward or roll back the code

**Fix forward** when the migration was additive (a new nullable column, a new
table, a new index). The old code is still running happily against the old
schema, so there is no user-visible outage — fix the SQL and re-run.

**Roll back the code** when the deployed code requires the failed migration.
Redeploy the previous image first, then fix the migration. Never leave code
running that needs a schema it does not have.

## 3. Common causes

```sql
-- A CREATE INDEX that timed out under load. Rebuild it concurrently instead;
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction, so it belongs in
-- its own migration file with no other statements.
SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE NOT indisvalid;
```

```sql
-- An ALTER that blocked on a long-running query.
SELECT pid, state, wait_event_type, left(query, 120), now() - query_start AS age
  FROM pg_stat_activity WHERE state <> 'idle' ORDER BY age DESC;
```

```sql
-- A constraint that existing data violates. This is the useful case: the
-- constraint found real bad data. Fix the data, do not weaken the constraint,
-- unless the constraint itself was wrong.
```

## 4. Never edit an applied migration

The runner checksums every file and refuses to start if a previously applied one
has changed. Correct a mistake with a new migration, exactly as
`0004_cancelled_draft_constraints.sql` corrected the version constraints from
`0001`.

## 5. Verify

```bash
pnpm db:migrate          # expect "No new migrations"
pnpm db:verify-chain
curl -fsS https://api.<host>/readyz
```
