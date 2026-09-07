-- Self-serve account closure with a recovery window (report §9.8).
--
-- Closing an account is destructive and, unlike almost everything else here,
-- irreversible once the purge runs. Two facts have to be recorded rather than
-- inferred: when the owner asked, and the moment after which the data may be
-- destroyed. Deriving the purge date from `updated_at` would silently move it
-- every time an unrelated column changed, which is exactly the kind of quiet
-- drift that turns a 30-day promise into a 3-day one.

ALTER TABLE organizations
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN purge_after timestamptz,
  ADD COLUMN closure_reason text;

-- The three closure columns move together, and only for a CLOSED account. A
-- row that is CLOSED without a purge date would never be picked up by the
-- retention job and would sit unpurged forever; a row that carries a purge date
-- while ACTIVE is a deletion armed against a live account.
ALTER TABLE organizations
  ADD CONSTRAINT organizations_closure_consistent CHECK (
    (status = 'CLOSED' AND closed_at IS NOT NULL AND purge_after IS NOT NULL)
    OR (status <> 'CLOSED' AND closed_at IS NULL AND purge_after IS NULL AND closure_reason IS NULL)
  );

-- The retention job asks one question: which closed accounts are now purgeable?
-- Partial, because an index over every ACTIVE organization would be dead weight.
CREATE INDEX organizations_purge_due_idx
  ON organizations (purge_after)
  WHERE status = 'CLOSED';
