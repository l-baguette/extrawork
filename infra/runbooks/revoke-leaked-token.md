# Revoke a leaked approval token

**When:** a contractor reports the approval link went to the wrong person, was
posted in a group chat, or appeared somewhere it should not have.

Report §13.6, and §3.4 ("Revoke it when the version is superseded, cancelled or
decided"). A leak is the fourth reason.

## 1. Establish what is at risk

```sql
SELECT v.id AS version_id, co.number, v.version_number, v.status,
       t.id AS token_id, t.expires_at, t.revoked_at, t.first_viewed_at
  FROM approval_tokens t
  JOIN change_order_versions v ON v.id = t.version_id
  JOIN change_orders co ON co.id = v.change_order_id
 WHERE v.organization_id = :organization_id
   AND co.number = :change_number
 ORDER BY v.version_number DESC;
```

If `status` is already `APPROVED` or `DECLINED`, the token is spent: a decision
exists and cannot be undone. Go to step 4 and treat this as a disputed decision,
not a live exposure.

## 2. Revoke immediately

```sql
UPDATE approval_tokens
   SET revoked_at = now(), revoked_reason = 'LEAKED'
 WHERE id = :token_id AND revoked_at IS NULL;
```

The public page will now show "This link is no longer active". Revocation is an
ordinary UPDATE on a live token — it is not evidence, so the runtime role may do
it and no repair mode is required.

## 3. Issue a replacement

Ask the contractor to open the change in the app and use **Create a new
version**. That supersedes the exposed version, mints a fresh token bound to the
same approver, and leaves the old version's frozen snapshot intact.

Do not attempt to re-issue a token for the exposed version: the report binds one
token to one version and one approver, and reusing the version would make the
evidence ambiguous about which link was live when.

## 4. Record it

```sql
-- Run as the maintenance role.
INSERT INTO repair_events (id, organization_id, actor, reason, details)
VALUES (gen_random_uuid(), :organization_id, :operator_email,
        'Approval token revoked after reported leak',
        jsonb_build_object('tokenId', :token_id, 'changeNumber', :change_number));
```

Then tell the contractor, in writing, which link was revoked and which version
replaces it.

## 5. If a decision was already recorded on the leaked link

The decision stands as a record of what happened — it is append-only and must
not be deleted. The honest response is:

1. Note the achieved assurance level (A0 means bearer-link assurance; the
   evidence pack already says the identity of the individual is not proven).
2. Ask the contractor to raise a corrective change (a deduction or reversal),
   which is how report §4.3 requires an approved change to be undone.
3. Consider whether A1 (phone-verified) should be the default for this
   organization going forward.
