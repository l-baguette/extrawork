-- Make erasure actually possible (report §9.8, DPDP Act 2023 s.12(3)).
--
-- `contacts_check` requires every contact to keep a phone number or an email
-- address, which is right for a live contact: one with neither cannot be sent
-- anything and is a data-entry mistake. It is wrong for an erased one. Honouring
-- a deletion request means removing both, and the constraint made that
-- impossible — the runbook promised an erasure the schema refused.
--
-- Recording *when* erasure happened, rather than inferring it from two null
-- columns, also gives the answer to the question a regulator actually asks:
-- when did you act on the request.

ALTER TABLE contacts ADD COLUMN erased_at timestamptz;

ALTER TABLE contacts DROP CONSTRAINT contacts_check;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_reachable_unless_erased CHECK (
    erased_at IS NOT NULL OR phone_e164 IS NOT NULL OR email_normalized IS NOT NULL
  );

-- An erased contact keeps no contact details, by definition. Enforced rather
-- than trusted, so a future code path cannot write a phone number back onto a
-- contact whose owner asked to be forgotten.
ALTER TABLE contacts
  ADD CONSTRAINT contacts_erased_has_no_details CHECK (
    erased_at IS NULL
    OR (phone_e164 IS NULL AND email_normalized IS NULL AND authority_note IS NULL)
  );
