-- Allow a DRAFT to be cancelled without ever having been sent.
--
-- Report §4.3 defines this transition explicitly:
--
--   DRAFT --cancel--> CANCELLED
--
-- The original constraints keyed off "status <> 'DRAFT'" as a proxy for "has
-- been sent", which made a cancelled draft unrepresentable: it has no canonical
-- snapshot, no sent_at and no expires_at, because it was never sent.
--
-- The corrected predicate keys off `sent_at`, which is the actual fact these
-- constraints care about. That still forbids the dangerous states the original
-- rules were protecting against — a sent version without a frozen snapshot, or
-- a snapshot on something never sent — and additionally covers the second
-- cancel path (SENT --cancel--> CANCELLED), where sent_at IS NOT NULL.

ALTER TABLE change_order_versions
  DROP CONSTRAINT IF EXISTS change_order_versions_check1,
  DROP CONSTRAINT IF EXISTS change_order_versions_check2,
  DROP CONSTRAINT IF EXISTS change_order_versions_check3;

-- A frozen snapshot exists exactly when the version has been sent.
ALTER TABLE change_order_versions
  ADD CONSTRAINT change_order_versions_snapshot_iff_sent
  CHECK ((sent_at IS NULL) = (canonical_snapshot IS NULL));

-- The digest and its provenance travel with the snapshot, never apart from it.
ALTER TABLE change_order_versions
  ADD CONSTRAINT change_order_versions_digest_with_snapshot
  CHECK (
    canonical_snapshot IS NULL
    OR (canonical_sha256 IS NOT NULL
        AND canonicalizer_version IS NOT NULL
        AND terms_version IS NOT NULL)
  );

-- An expiry exists exactly when the version has been sent, because expiry is a
-- property of the approval link (report §3.4).
ALTER TABLE change_order_versions
  ADD CONSTRAINT change_order_versions_expiry_iff_sent
  CHECK ((sent_at IS NULL) = (expires_at IS NULL));

-- Only DRAFT and CANCELLED may lack a sent_at. Every other status in the
-- machine is reachable only after a send.
ALTER TABLE change_order_versions
  ADD CONSTRAINT change_order_versions_status_requires_sent
  CHECK (status IN ('DRAFT', 'CANCELLED') OR sent_at IS NOT NULL);

-- A decided version must carry the time it was decided.
ALTER TABLE change_order_versions
  ADD CONSTRAINT change_order_versions_decided_at_present
  CHECK (
    status NOT IN ('APPROVED', 'DECLINED', 'REVISION_REQUESTED')
    OR decided_at IS NOT NULL
  );
