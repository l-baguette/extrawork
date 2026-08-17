# Replay webhook and outbox events

**When:** an outbox event dead-lettered, a job exhausted its attempts, or a
provider webhook was received but not normalised.

Report §13.4: "Replay: operator may replay one event or bounded batch through an
audited command."

## Diagnose first

```sql
-- Outbox events that gave up.
SELECT id, topic, aggregate_id, attempt_count, last_error_code, last_error_at
  FROM outbox_events
 WHERE dead_lettered_at IS NOT NULL
 ORDER BY created_at DESC LIMIT 50;

-- Jobs that dead-lettered, with the reason.
SELECT id, kind, attempt_count, left(last_error, 200) AS error, last_error_at
  FROM job_queue
 WHERE status = 'DEAD_LETTER'
 ORDER BY last_error_at DESC LIMIT 50;

-- Webhooks received but never normalised.
SELECT id, provider, provider_event_id, received_at, process_error
  FROM webhook_inbox
 WHERE processed_at IS NULL AND received_at < now() - interval '15 minutes'
 ORDER BY received_at LIMIT 50;
```

**Read the error before replaying.** A `PermanentJobError` (validation, a
missing aggregate, an unsupported channel) will fail identically forever;
replaying it just refills the dead-letter queue.

## Replay

```bash
# One outbox event.
pnpm --filter @extrawork/db exec tsx src/cli/replay.ts outbox <eventId>

# One job.
pnpm --filter @extrawork/db exec tsx src/cli/replay.ts job <jobId>

# A bounded batch, newest first. There is no unbounded replay by design.
pnpm --filter @extrawork/db exec tsx src/cli/replay.ts outbox --kind message.send_requested.v1 --limit 25
```

Replay resets the row to pending and clears the lease; the worker picks it up on
its next poll. Every handler is idempotent, so a replay of work that actually
succeeded is safe.

## Special cases

**Evidence generation** — safe to replay unconditionally. `claimForGeneration`
only proceeds from `PENDING`/`FAILED`, so a duplicate replay is a no-op rather
than a second document.

**Messages** — replaying a `send_request_message` or `send_reminder` may deliver
a second message to a customer. Check `messages` for an existing row with the
same `dedupe_key` before replaying, and prefer telling the contractor to resend
from the app over silently double-messaging their customer.

**Decisions** — never replayable. A decision is created by the customer's own
request; there is no job that creates one, and there must not be.
