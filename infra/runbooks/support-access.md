# Grant and revoke support access

Report §3.1: a support operator sees "metadata-only by default; time-bound
audited access after customer grant". Report §12.1 additionally requires
re-authentication for granting it.

Support staff have **no** default access to scope text, photographs, contracts
or customer contact details. That is a product promise, not a configuration.

## Granting

Access is granted **by the organization**, not by ExtraWork. An operator cannot
grant themselves access.

1. Ask the organization owner or an administrator to open
   **Settings → Support access** and grant access, naming the operator and a
   duration (default 24 hours, maximum 7 days).
2. The grant is written to `support_access_grants` and emits
   `support.access_granted.v1`.

```sql
SELECT id, operator_email, granted_by_user_id, scope, expires_at, revoked_at
  FROM support_access_grants
 WHERE organization_id = :organization_id
 ORDER BY created_at DESC;
```

If the customer cannot use the UI (for example they are locked out), an
emergency grant requires two named staff and is recorded the same way — the
grant row is the evidence either way.

## While access is active

Every read through an active grant is audited with `actor_type = 'SUPPORT'`.
Look at what you needed and nothing else; the audit trail is shown to the
organization.

```sql
SELECT occurred_at, event_type, aggregate_type, aggregate_id
  FROM audit_events
 WHERE organization_id = :organization_id AND actor_type = 'SUPPORT'
 ORDER BY occurred_at DESC;
```

## Revoking

Grants expire on their own. Revoke early as soon as the case closes:

```sql
UPDATE support_access_grants
   SET revoked_at = now(), revoked_reason = 'case closed'
 WHERE id = :grant_id AND revoked_at IS NULL;
```

This emits `support.access_revoked.v1`.

## What support may never do

- Decide on a customer's behalf. There is no code path for it, and adding one
  would destroy the product's central claim.
- Edit a frozen version, a decision, or an audit event. Triggers and role
  privileges prevent it; attempting it raises an alert.
- Read an approval token. Only the hash is stored.
