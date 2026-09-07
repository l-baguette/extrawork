-- The record that a purge happened, kept after everything else is gone.
--
-- Every other trace of the organization is deleted or cascades away — including
-- `repair_events`, which references `organizations(id) ON DELETE CASCADE` and so
-- cannot hold the record of its own organization's destruction. Deliberately no
-- foreign key here for the same reason.
--
-- This is the only thing that survives, and it is what answers the question a
-- regulator or a returning customer actually asks: was the deletion carried out,
-- when, by whom, and how much was destroyed. It holds no personal data — a
-- display name for recognition, counts, and timestamps.

CREATE TABLE purged_organizations (
  organization_id uuid PRIMARY KEY,
  display_name text NOT NULL,
  -- The dates that prove the recovery window was honoured rather than skipped.
  closed_at timestamptz NOT NULL,
  purge_after timestamptz NOT NULL,
  purged_at timestamptz NOT NULL DEFAULT now(),
  closure_reason text,
  operator text NOT NULL,
  reason text NOT NULL,
  -- Per-table row counts destroyed, as {"projects": 4, "decisions": 22, ...}.
  deleted_counts jsonb NOT NULL,
  CONSTRAINT purged_after_window CHECK (purged_at >= purge_after)
);

COMMENT ON TABLE purged_organizations IS
  'Tombstone ledger: proof a closed account was purged after its recovery window (report §9.8).';
