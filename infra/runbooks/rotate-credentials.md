# Rotate provider and webhook credentials

**When:** on schedule, on staff departure, or immediately on suspected exposure.

Report §11.3: "Rotate webhook secrets and API keys; support overlapping key
versions during rotation." Overlap is what makes rotation a non-event: a webhook
signed with the old secret must keep verifying until the provider has finished
switching.

## Order of operations (never reverse this)

1. **Add** the new secret alongside the old one.
2. **Switch** the provider to the new secret.
3. **Observe** that traffic verifies against the new secret.
4. **Remove** the old secret.

Removing before observing is how a rotation becomes an outage.

## Meta / WhatsApp Cloud API

```bash
# 1. Add. The verifier accepts either while both are set.
<provider> secrets set WHATSAPP_APP_SECRET_NEXT="<new>"
<provider> deploy

# 2. Switch in the Meta app dashboard.
# 3. Observe: signature failures should be zero.
```

```sql
SELECT signature_verified, count(*)
  FROM webhook_inbox
 WHERE provider = 'meta' AND received_at > now() - interval '30 minutes'
 GROUP BY 1;
```

```bash
# 4. Promote and remove.
<provider> secrets set WHATSAPP_APP_SECRET="<new>"
<provider> secrets unset WHATSAPP_APP_SECRET_NEXT
```

Rotating `WHATSAPP_VERIFY_TOKEN` is separate and only used for the GET challenge
at subscription time.

## Razorpay

Same shape with `RAZORPAY_WEBHOOK_SECRET_NEXT`. Payment webhooks are the
authority for payment state (report §10.4), so a gap here means payments silently
stop reconciling — check `payment_intents` for rows stuck in a non-terminal
state after rotating.

## Auth provider

Rotating the signing key invalidates sessions. Report §13.1 says existing
sessions should be honoured until safe expiry, so prefer the provider's own key
rollover (JWKS serves both keys during overlap) over a hard cut.

## Application secrets

- `SESSION_SECRET` — rotating signs out every business user. Schedule it.
- `PRIVACY_HASH_SECRET` — **do not rotate casually.** It keys the IP
  pseudonymisation stored on historical decisions (report §12.3). Rotating means
  old and new hashes are no longer comparable; that is acceptable, but record
  the rotation date so an investigation knows why hashes diverge at a boundary.
- `STORAGE_URL_SECRET` — only used by the local filesystem driver; invalidates
  outstanding signed URLs immediately.

## After any rotation

```bash
curl -fsS https://api.<host>/readyz
```

Confirm the next real provider webhook verifies, and record the rotation date
and who performed it.
