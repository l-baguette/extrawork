-- Record the simulator as a message channel in its own right.
--
-- `messages.channel` names the channel a message actually went out on, and the
-- original list anticipated automated WhatsApp only as `WHATSAPP_CLOUD_API`.
-- The simulator gateway (migration-era: WHATSAPP_DRIVER=simulator) also
-- genuinely delivers — to a file an operator can read — so a message it handled
-- has to be recordable.
--
-- Recording it as `WHATSAPP_CLOUD_API` was the alternative and is rejected:
-- the message log is operational evidence, and claiming a message went through
-- Meta when it went to `.data/whatsapp/outbox.jsonl` would make the log lie
-- about the one thing it exists to answer — did this customer actually receive
-- anything? A distinct value keeps "delivered by the simulator" visibly
-- different from "delivered by WhatsApp".

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_channel_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_channel_check
  CHECK (channel IN (
    'WHATSAPP_NATIVE_SHARE',
    'WHATSAPP_CLOUD_API',
    'WHATSAPP_SIMULATOR',
    'EMAIL',
    'SMS',
    'COPY_LINK'
  ));
