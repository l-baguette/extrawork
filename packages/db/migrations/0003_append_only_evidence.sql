-- Append-only evidence enforcement.
--
-- Report §9.6: "Sent change versions, decisions, and audit events are
-- append-only at the application level, protected by database privileges that
-- deny UPDATE/DELETE to the runtime role."
-- Report §12.1 repeats this as a mandatory control.
--
-- Two layers are used, because privileges alone are not enough:
--
--  1. TRIGGERS below reject any UPDATE that would rewrite frozen evidence, and
--     any DELETE of a decision or audit event. Triggers apply to every role,
--     including the owner, so a mistaken migration or a psql session cannot
--     silently rewrite history either.
--  2. `harden.sql` (run separately by `pnpm db:harden`) additionally REVOKEs
--     UPDATE/DELETE from the dedicated runtime role. That step needs a
--     superuser and a separate role, so it is deployment-time rather than
--     migration-time.
--
-- Repairs go through `repair_events` and the documented repair command, which
-- runs as the maintenance role with the guard temporarily disabled via
-- `SET LOCAL extrawork.allow_repair = 'on'`.

CREATE OR REPLACE FUNCTION repair_mode_enabled()
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN coalesce(current_setting('extrawork.allow_repair', true), 'off') = 'on';
END;
$$;

-- ---------------------------------------------------------------------------
-- Audit events: strictly append-only.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_events_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF repair_mode_enabled() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION
    'audit_events is append-only: % is not permitted (report §9.6)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

-- ---------------------------------------------------------------------------
-- Decisions: immutable once written.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION decisions_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF repair_mode_enabled() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION
    'decisions are immutable: % is not permitted (report §4.3, §9.6)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER decisions_no_update
  BEFORE UPDATE ON decisions
  FOR EACH ROW EXECUTE FUNCTION decisions_append_only();

CREATE TRIGGER decisions_no_delete
  BEFORE DELETE ON decisions
  FOR EACH ROW EXECUTE FUNCTION decisions_append_only();

-- ---------------------------------------------------------------------------
-- Change-order versions: a frozen snapshot is never edited in place.
--
-- Status and lifecycle timestamps must still move (SENT -> VIEWED -> APPROVED),
-- so this guard is field-level rather than row-level: once a version leaves
-- DRAFT, the commercial content, scope, snapshot and digest are locked.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION versions_freeze_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF repair_mode_enabled() THEN
    RETURN NEW;
  END IF;

  -- A draft is fully editable.
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  IF NEW.canonical_snapshot IS DISTINCT FROM OLD.canonical_snapshot
     OR NEW.canonical_sha256 IS DISTINCT FROM OLD.canonical_sha256
     OR NEW.canonicalizer_version IS DISTINCT FROM OLD.canonicalizer_version
     OR NEW.terms_version IS DISTINCT FROM OLD.terms_version
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.scope_description IS DISTINCT FROM OLD.scope_description
     OR NEW.reason IS DISTINCT FROM OLD.reason
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
  THEN
    RAISE EXCEPTION
      'change_order_versions.% is frozen once sent; create a revision instead (report §4.4)',
      'commercial content'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- A terminal decision is final for that version.
  IF OLD.status IN ('APPROVED','DECLINED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      'change_order_versions.status is terminal at % (report §4.3)', OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER versions_freeze
  BEFORE UPDATE ON change_order_versions
  FOR EACH ROW EXECUTE FUNCTION versions_freeze_guard();

CREATE OR REPLACE FUNCTION versions_delete_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF repair_mode_enabled() THEN
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION
      'a sent change-order version cannot be deleted (report §4.3)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER versions_no_delete_after_send
  BEFORE DELETE ON change_order_versions
  FOR EACH ROW EXECUTE FUNCTION versions_delete_guard();

-- ---------------------------------------------------------------------------
-- Line items of a frozen version are equally immutable.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION line_items_freeze_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status version_status;
  v_id uuid;
BEGIN
  IF repair_mode_enabled() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  SELECT status INTO v_status FROM change_order_versions WHERE id = v_id;

  IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
    RAISE EXCEPTION
      'line items of a sent version are frozen; create a revision instead (report §4.4)'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER line_items_freeze
  BEFORE UPDATE OR DELETE ON line_items
  FOR EACH ROW EXECUTE FUNCTION line_items_freeze_guard();

-- ---------------------------------------------------------------------------
-- Attachments cannot be removed after send (report §4.6).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION version_attachments_freeze_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status version_status;
  v_id uuid;
BEGIN
  IF repair_mode_enabled() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  SELECT status INTO v_status FROM change_order_versions WHERE id = v_id;

  IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
    RAISE EXCEPTION
      'attachments cannot change after send; create a revision instead (report §4.6)'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER version_attachments_freeze
  BEFORE UPDATE OR DELETE ON version_attachments
  FOR EACH ROW EXECUTE FUNCTION version_attachments_freeze_guard();

-- ---------------------------------------------------------------------------
-- Baseline versions are historical records.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION baseline_versions_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF repair_mode_enabled() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION
    'baseline_versions is append-only: record an amendment instead (report §4.1)'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER baseline_versions_no_update
  BEFORE UPDATE OR DELETE ON baseline_versions
  FOR EACH ROW EXECUTE FUNCTION baseline_versions_append_only();
