-- Durable, per-recipient delivery state for decision notifications.
--
-- The original decision jobs called every provider in one handler. If an
-- early recipient succeeded and a later recipient failed, retrying the parent
-- job replayed the successful call. `messages` is already the outbound-message
-- ledger, so extend it rather than creating a second source of truth.

ALTER TABLE messages
  ADD COLUMN decision_id uuid REFERENCES decisions(id) ON DELETE CASCADE,
  ADD COLUMN recipient_kind text,
  ADD COLUMN recipient_name text,
  ADD COLUMN recipient_address text,
  ADD COLUMN delivery_payload jsonb,
  ADD COLUMN delivery_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN delivery_lease_token text,
  ADD COLUMN delivery_leased_until timestamptz,
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN error_detail text;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_purpose_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_purpose_check
  CHECK (purpose IN ('REQUEST','REMINDER','DECISION_RECEIPT','TEAM_DECISION','OTP'));

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_status_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_status_check
  CHECK (status IN ('PENDING','SENDING','SHARE_INTENT_OPENED','ACCEPTED','SENT',
                    'DELIVERED','READ','FAILED','SUPPRESSED'));

ALTER TABLE messages
  ADD CONSTRAINT messages_recipient_kind_check
  CHECK (recipient_kind IS NULL OR recipient_kind IN ('CUSTOMER','EMPLOYEE','OWNER')),
  ADD CONSTRAINT messages_delivery_attempt_count_check
  CHECK (delivery_attempt_count >= 0),
  ADD CONSTRAINT messages_delivery_lease_pair_check
  CHECK ((delivery_lease_token IS NULL) = (delivery_leased_until IS NULL)),
  ADD CONSTRAINT messages_delivery_intent_check
  CHECK (
    delivery_payload IS NULL OR (
      decision_id IS NOT NULL
      AND recipient_kind IS NOT NULL
      AND recipient_name IS NOT NULL
      AND recipient_address IS NOT NULL
      AND dedupe_key IS NOT NULL
    )
  );

-- PostgreSQL does not automatically index foreign keys. This supports decision
-- evidence/operations lookups and keeps a decision delete from scanning the
-- entire message ledger.
CREATE INDEX messages_decision_idx
  ON messages (decision_id, created_at DESC)
  WHERE decision_id IS NOT NULL;

-- Small operational index for finding abandoned sends. Child jobs normally
-- claim by primary key; this index is for recovery and monitoring only.
CREATE INDEX messages_active_delivery_lease_idx
  ON messages (delivery_leased_until)
  WHERE status = 'SENDING' AND delivery_payload IS NOT NULL;
