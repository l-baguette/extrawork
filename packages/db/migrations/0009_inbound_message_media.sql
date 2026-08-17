-- What kind of event a stored webhook is.
--
-- The adapter already classifies every payload it parses — a delivery receipt,
-- a message a person sent, something unrecognised — and then threw that away,
-- leaving the worker to re-derive it by inspecting the shape of the raw JSON.
-- That inference is exactly what report §10.1 says an adapter exists to do once
-- ("map provider data into an internal normalized record"), and re-deriving it
-- downstream is how a payload that looks like two things becomes two different
-- answers in two places.
--
-- Nullable, and the worker still falls back to shape detection when it is
-- absent, because rows stored before this migration have no classification and
-- must stay processable.

ALTER TABLE webhook_inbox ADD COLUMN kind text;

CREATE INDEX webhook_inbox_kind_idx ON webhook_inbox (kind, processed_at)
  WHERE processed_at IS NULL;

-- Attachments that arrived on an inbound WhatsApp message.
--
-- A site photograph is often the most useful thing in the whole request — it is
-- what an owner looks at to decide whether the extra work was really needed —
-- so the bytes have to be findable from the message they came with. Without a
-- link the file exists in storage and nothing can reach it, which is worse than
-- not downloading it at all.
--
-- A join table rather than a column on `file_objects`: the file table is
-- generic and shared with composer uploads, evidence and exports, and adding an
-- intake-shaped foreign key to it would push one channel's concern into
-- everything that touches a file.
--
-- `organization_id` is NOT NULL here even though `inbound_messages.organization_id`
-- is nullable. That is deliberate and load-bearing: a message from an unknown
-- number has no tenant, and media is only ever fetched once the sender has
-- resolved to a real employee. Anything else would let a stranger make the
-- worker download and store arbitrary bytes by texting the business number.
-- The column being NOT NULL is what stops that path being added by accident.

CREATE TABLE inbound_message_media (
  inbound_message_id uuid NOT NULL REFERENCES inbound_messages(id) ON DELETE CASCADE,
  file_object_id uuid NOT NULL REFERENCES file_objects(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The provider's handle for the attachment. Kept so a redelivered webhook
  -- resolves to the file already fetched instead of downloading it twice.
  provider_media_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (inbound_message_id, file_object_id)
);

-- One row per provider attachment per message. This is the idempotency guard
-- for a redelivered inbound webhook: the second attempt conflicts instead of
-- creating a second copy of the same photograph.
CREATE UNIQUE INDEX inbound_message_media_provider_idx
  ON inbound_message_media (inbound_message_id, provider_media_id);

CREATE INDEX inbound_message_media_file_idx
  ON inbound_message_media (file_object_id);

CREATE INDEX inbound_message_media_org_idx
  ON inbound_message_media (organization_id, created_at DESC);
