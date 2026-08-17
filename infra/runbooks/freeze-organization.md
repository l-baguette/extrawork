# Freeze one organization without affecting others

**When:** suspected account compromise, non-payment beyond grace with abuse, a
legal hold, or an organization asking to be paused.

## Freeze

```sql
UPDATE organizations SET status = 'SUSPENDED' WHERE id = :organization_id;
```

What this does, and deliberately does not do:

- **Blocks** authenticated mutations for that tenant: the API resolves the
  organization on every request and rejects a suspended one with
  `ORGANIZATION_SUSPENDED`.
- **Does not** revoke live approval tokens. A customer part-way through
  approving is not a party to the dispute, and report §8.7 is explicit that
  historical evidence is never hidden. Their decision still commits.
- **Does not** delete or hide anything. Reads and exports keep working, which is
  the §16.3 launch blocker about export after lapse.

## If live links must also be stopped

Only when the account itself is compromised, and this is customer-visible:

```sql
UPDATE approval_tokens t
   SET revoked_at = now(), revoked_reason = 'MANUAL'
  FROM change_order_versions v
 WHERE t.version_id = v.id
   AND v.organization_id = :organization_id
   AND t.revoked_at IS NULL;
```

Customers who open a revoked link see "This link is no longer active", which is
accurate but gives them no context. Tell the organization what you did so they
can explain it to their customers.

## Verify the blast radius is one tenant

```sql
-- No other organization changed status.
SELECT id, display_name, status FROM organizations WHERE status <> 'ACTIVE';
```

## Unfreeze

```sql
UPDATE organizations SET status = 'ACTIVE' WHERE id = :organization_id;
```

Revoked tokens are not restored — the organization must send new versions.

## Record

```sql
INSERT INTO repair_events (id, organization_id, actor, reason, details)
VALUES (gen_random_uuid(), :organization_id, :operator_email,
        'Organization frozen', jsonb_build_object('tokensRevoked', :count));
```
