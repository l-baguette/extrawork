-- Three-party workspace, part 2: requests that route through the designer,
-- where the work is, what kind of work it is, and the Tier 1 invoiced mark.
-- Spec decisions D4, D8, D9, D15.

-- ---------------------------------------------------------------------------
-- Room and type of work: terms, so frozen at send like the scope itself.
-- ---------------------------------------------------------------------------

ALTER TABLE change_order_versions
  ADD COLUMN room text
    CHECK (room IS NULL OR length(btrim(room)) BETWEEN 1 AND 80),
  ADD COLUMN work_category text
    CHECK (work_category IS NULL OR work_category IN (
      'CIVIL','DEMOLITION','PLUMBING','ELECTRICAL','CARPENTRY','MODULAR_KITCHEN',
      'FALSE_CEILING','FLOORING','PAINTING','WATERPROOFING','HVAC','FABRICATION',
      'GLASS_ALUMINIUM','FURNITURE','RENOVATION','DESIGN_CHANGE','OTHER'));

-- ---------------------------------------------------------------------------
-- Review provenance (D4).
-- ---------------------------------------------------------------------------
--
-- A proposal is an ordinary DRAFT that somebody other than the designer raised
-- and handed over for review. "Awaiting review" is exactly
--   status = 'DRAFT' AND submitted_for_review_at IS NOT NULL AND reviewed_at IS NULL
-- so the state machine, the transition trigger and the freeze guard need no new
-- status. These columns are provenance, not terms: like `origin` and
-- `raised_by_employee_id` they sit outside the canonical snapshot and outside
-- the freeze guard, because recording that the designer reviewed a request
-- must not alter the digest of what the homeowner agreed to.

ALTER TABLE change_order_versions
  ADD COLUMN submitted_for_review_at timestamptz,
  ADD COLUMN submitted_by_user_id    uuid REFERENCES users(id),
  ADD COLUMN submitted_by_contact_id uuid,
  ADD COLUMN submission_note         text
    CHECK (submission_note IS NULL OR length(submission_note) <= 2000),
  ADD COLUMN reviewed_at             timestamptz,
  ADD COLUMN reviewed_by_user_id     uuid REFERENCES users(id),
  ADD CONSTRAINT versions_submitted_contact_tenant_fk
    FOREIGN KEY (organization_id, submitted_by_contact_id)
    REFERENCES contacts (organization_id, id),
  ADD CONSTRAINT versions_reviewed_after_submitted
    CHECK (reviewed_at IS NULL OR submitted_for_review_at IS NOT NULL);

CREATE INDEX versions_awaiting_review_idx
  ON change_order_versions (organization_id, project_id, submitted_for_review_at DESC)
  WHERE status = 'DRAFT' AND submitted_for_review_at IS NOT NULL AND reviewed_at IS NULL;

-- ---------------------------------------------------------------------------
-- Invoiced mark (Tier 1 B, spec 2026-09-14 section B).
-- ---------------------------------------------------------------------------
--
-- Bookkeeping about the record, not a term of it: outside the snapshot and
-- outside the freeze guard, on purpose, in the same terms as `origin`. The
-- mutable columns carry the current state; the audit chain carries the history
-- of who marked and cleared what. Do not add these to versions_freeze_guard().

ALTER TABLE change_order_versions
  ADD COLUMN invoiced_at          timestamptz,
  ADD COLUMN invoice_reference    text
    CHECK (invoice_reference IS NULL OR length(btrim(invoice_reference)) BETWEEN 1 AND 100),
  ADD COLUMN invoiced_by_user_id  uuid REFERENCES users(id),
  ADD CONSTRAINT versions_invoiced_only_when_approved
    CHECK (invoiced_at IS NULL OR status = 'APPROVED'),
  ADD CONSTRAINT versions_invoice_reference_needs_mark
    CHECK (invoice_reference IS NULL OR invoiced_at IS NOT NULL);

CREATE INDEX versions_unbilled_idx
  ON change_order_versions (organization_id, project_id)
  WHERE status = 'APPROVED' AND invoiced_at IS NULL;

-- ---------------------------------------------------------------------------
-- Where a request came from.
-- ---------------------------------------------------------------------------
--   PASTED        the designer pasted a WhatsApp message (Tier 1 C)
--   COLLABORATOR  a collaborator raised it in the web app
--   PORTAL        the homeowner asked for it from the project portal

ALTER TABLE change_order_versions DROP CONSTRAINT change_order_versions_origin_check;
ALTER TABLE change_order_versions ADD CONSTRAINT change_order_versions_origin_check
  CHECK (origin IN ('WEB','WHATSAPP','IMPORT','PASTED','COLLABORATOR','PORTAL'));

-- ---------------------------------------------------------------------------
-- Project description (new-project form).
-- ---------------------------------------------------------------------------

ALTER TABLE projects
  ADD COLUMN description text CHECK (description IS NULL OR length(description) <= 4000);

-- ---------------------------------------------------------------------------
-- Freeze guard: room and work_category are terms (D9).
-- ---------------------------------------------------------------------------
-- Identical to the 0013 definition apart from the two added comparisons.

CREATE OR REPLACE FUNCTION versions_freeze_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF repair_mode_enabled() THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT','SENT','CANCELLED')) OR
    (OLD.status = 'SENT' AND NEW.status IN
      ('SENT','VIEWED','APPROVED','DECLINED','REVISION_REQUESTED','EXPIRED','CANCELLED','SUPERSEDED')) OR
    (OLD.status = 'VIEWED' AND NEW.status IN
      ('VIEWED','APPROVED','DECLINED','REVISION_REQUESTED','EXPIRED','CANCELLED','SUPERSEDED')) OR
    (OLD.status = 'REVISION_REQUESTED' AND NEW.status IN
      ('REVISION_REQUESTED','CANCELLED','SUPERSEDED')) OR
    (OLD.status = 'EXPIRED' AND NEW.status IN ('EXPIRED','CANCELLED','SUPERSEDED')) OR
    (OLD.status IN ('APPROVED','DECLINED','CANCELLED','SUPERSEDED')
      AND NEW.status = OLD.status)
  ) THEN
    RAISE EXCEPTION
      'invalid change_order_versions transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  IF NEW.canonical_snapshot IS DISTINCT FROM OLD.canonical_snapshot
     OR NEW.canonical_sha256 IS DISTINCT FROM OLD.canonical_sha256
     OR NEW.canonicalizer_version IS DISTINCT FROM OLD.canonicalizer_version
     OR NEW.terms_version IS DISTINCT FROM OLD.terms_version
     OR NEW.template_snapshot IS DISTINCT FROM OLD.template_snapshot
     OR NEW.template_version IS DISTINCT FROM OLD.template_version
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.scope_description IS DISTINCT FROM OLD.scope_description
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.room IS DISTINCT FROM OLD.room
     OR NEW.work_category IS DISTINCT FROM OLD.work_category
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.subtotal_delta_minor IS DISTINCT FROM OLD.subtotal_delta_minor
     OR NEW.tax_delta_minor IS DISTINCT FROM OLD.tax_delta_minor
     OR NEW.total_delta_minor IS DISTINCT FROM OLD.total_delta_minor
     OR NEW.baseline_total_minor IS DISTINCT FROM OLD.baseline_total_minor
     OR NEW.prior_approved_delta_minor IS DISTINCT FROM OLD.prior_approved_delta_minor
     OR NEW.revised_contract_total_minor IS DISTINCT FROM OLD.revised_contract_total_minor
     OR NEW.schedule_delta_days IS DISTINCT FROM OLD.schedule_delta_days
     OR NEW.revised_completion_date IS DISTINCT FROM OLD.revised_completion_date
     OR NEW.approver_contact_id IS DISTINCT FROM OLD.approver_contact_id
     OR NEW.assurance_required IS DISTINCT FROM OLD.assurance_required
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.change_order_id IS DISTINCT FROM OLD.change_order_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
  THEN
    RAISE EXCEPTION
      'change_order_versions commercial content is frozen once sent; create a revision instead'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;
