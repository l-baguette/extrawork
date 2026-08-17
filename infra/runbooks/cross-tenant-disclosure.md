# Respond to a suspected cross-tenant disclosure

**When:** a user reports seeing another business's data, or a denied-access
alert spikes.

Report §12.2 names cross-tenant IDOR as a top threat, and §16.3 makes automated
cross-tenant negative tests a launch blocker. Treat any credible report as a
**severity 1** until disproven.

## 1. Preserve evidence, then contain

Do not delete anything. Capture:

```sql
-- Every audit event by the reporting user in the window.
SELECT occurred_at, event_type, aggregate_type, aggregate_id, organization_id
  FROM audit_events
 WHERE actor_id = :user_id AND occurred_at BETWEEN :from AND :to
 ORDER BY occurred_at;
```

Pull the API logs for that user's session id and request ids. Logs carry a
pseudonymous organization id (report §11.5), so correlate on `requestId`.

If a specific endpoint is implicated and a fix is not immediate, disable it at
the edge rather than leaving it exposed.

## 2. Determine whether data actually crossed

The authorization rule is `actor.organization_id == resource.organization_id`
(report §3.2) and every tenant-owned repository method takes a `TenantContext`.
A genuine cross-tenant read therefore requires either a repository method
missing that scope, or a route resolving a resource before authorizing it.

```bash
# Any repository method that does not take a tenant context is a candidate.
rg -n "async \w+\(" packages/db/src/repositories/ | rg -v "TenantContext|tx: TransactionContext|db: Database"
```

Reproduce with the negative corpus:

```bash
pnpm test:integration tests/integration/tenant-isolation.test.ts
```

## 3. If disclosure is confirmed

1. Fix the specific boundary, and **add a failing test first** in
   `tests/integration/tenant-isolation.test.ts` so the regression is permanent.
2. Determine the blast radius: which organizations, which records, over what
   window. Be precise; do not estimate upward or downward.
3. Notify both affected organizations. Under India's DPDP framework the
   organization is typically the Data Fiduciary for its customers' data, so it
   must be told promptly enough to meet its own obligations. Counsel decides the
   regulator notification; engineering supplies the facts.
4. Rotate any credential that appeared in the disclosed data.

## 4. If disproven

Say so plainly to the reporter, with the evidence: the audit events for their
session, and the organization ids on the records they saw. Most reports are a
user with two memberships looking at the wrong active organization.

## 5. Always

Add the case to the cross-tenant corpus even when disproven — a report that
turned out fine still describes a path someone thought was reachable.
