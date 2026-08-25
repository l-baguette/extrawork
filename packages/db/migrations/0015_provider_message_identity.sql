-- Scope provider message identities to the concrete provider account.
-- Existing rows remain valid with a null account and are resolved through the
-- worker's deliberately narrow legacy fallback.

ALTER TABLE messages ADD COLUMN provider_account_id text;
ALTER TABLE inbound_messages ADD COLUMN provider_account_id text;

DROP INDEX IF EXISTS messages_provider_idx;
CREATE INDEX messages_provider_identity_idx
  ON messages (provider, provider_account_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX messages_provider_identity_uidx
  ON messages (provider, provider_account_id, provider_message_id)
  WHERE provider IS NOT NULL
    AND provider_account_id IS NOT NULL
    AND provider_message_id IS NOT NULL;

ALTER TABLE inbound_messages
  DROP CONSTRAINT inbound_messages_provider_provider_message_id_key;
CREATE UNIQUE INDEX inbound_messages_provider_identity_uidx
  ON inbound_messages (provider, COALESCE(provider_account_id, ''), provider_message_id);
