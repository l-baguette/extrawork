-- Critical integrity hardening.
--
-- This migration closes four independent backend-only gaps:
--   * repair bypasses are based on database privilege, never a caller-set GUC;
--   * version status transitions are enforced at the database boundary;
--   * tenant-owned relationships cannot point at another tenant's row;
--   * scans and generated documents have recoverable, generation-owned leases.

-- ---------------------------------------------------------------------------
-- Privileged repair and immutable version state
-- ---------------------------------------------------------------------------

-- A superuser can disable triggers directly, so recognising that privilege here
-- does not create a new capability. Ordinary roles cannot acquire it by setting
-- a session variable. Projection repairs do not use this bypass at all.
CREATE OR REPLACE FUNCTION repair_mode_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT rolsuper FROM pg_roles WHERE rolname = current_user
$$;

CREATE OR REPLACE FUNCTION versions_freeze_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF repair_mode_enabled() THEN
    RETURN NEW;
  END IF;

  -- Mirror the domain state machine at the persistence boundary. In
  -- particular, no sent/frozen version can ever become an editable DRAFT.
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

  -- Draft content is editable until the one-way send/cancel transition.
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

-- ---------------------------------------------------------------------------
-- Tenant-bound foreign keys
-- ---------------------------------------------------------------------------

-- PostgreSQL requires a unique parent key for each composite foreign key.
CREATE UNIQUE INDEX customers_org_id_uidx ON customers (organization_id, id);
CREATE UNIQUE INDEX contacts_org_id_uidx ON contacts (organization_id, id);
CREATE UNIQUE INDEX projects_org_id_uidx ON projects (organization_id, id);
CREATE UNIQUE INDEX file_objects_org_id_uidx ON file_objects (organization_id, id);
CREATE UNIQUE INDEX change_orders_org_id_uidx ON change_orders (organization_id, id);
CREATE UNIQUE INDEX change_order_versions_org_id_uidx
  ON change_order_versions (organization_id, id);
CREATE UNIQUE INDEX approval_tokens_org_id_uidx ON approval_tokens (organization_id, id);
CREATE UNIQUE INDEX public_sessions_org_id_uidx ON public_sessions (organization_id, id);
CREATE UNIQUE INDEX messages_org_id_uidx ON messages (organization_id, id);
CREATE UNIQUE INDEX decisions_org_id_uidx ON decisions (organization_id, id);
CREATE UNIQUE INDEX employees_org_id_uidx ON employees (organization_id, id);
CREATE UNIQUE INDEX inbound_messages_org_id_uidx ON inbound_messages (organization_id, id);

-- Drop the single-column relationship constraints before replacing them with
-- tenant-bound equivalents. The organization -> organization FKs remain.
ALTER TABLE customers DROP CONSTRAINT customers_merged_into_customer_id_fkey;
ALTER TABLE contacts DROP CONSTRAINT contacts_customer_id_fkey;
ALTER TABLE projects
  DROP CONSTRAINT projects_customer_id_fkey,
  DROP CONSTRAINT projects_default_approver_contact_id_fkey,
  DROP CONSTRAINT projects_baseline_document_fk;
ALTER TABLE baseline_versions
  DROP CONSTRAINT baseline_versions_project_id_fkey,
  DROP CONSTRAINT baseline_versions_file_fk;
ALTER TABLE project_members DROP CONSTRAINT project_members_project_id_fkey;
ALTER TABLE file_objects DROP CONSTRAINT file_objects_project_id_fkey;
ALTER TABLE change_orders
  DROP CONSTRAINT change_orders_project_id_fkey,
  DROP CONSTRAINT change_orders_reversal_of_change_order_id_fkey,
  DROP CONSTRAINT fk_current_version;
ALTER TABLE change_order_versions
  DROP CONSTRAINT change_order_versions_change_order_id_fkey,
  DROP CONSTRAINT change_order_versions_project_id_fkey,
  DROP CONSTRAINT change_order_versions_approver_contact_id_fkey,
  DROP CONSTRAINT fk_superseded_by,
  DROP CONSTRAINT change_order_versions_raised_by_employee_id_fkey;
ALTER TABLE line_items DROP CONSTRAINT line_items_version_id_fkey;
ALTER TABLE version_attachments
  DROP CONSTRAINT version_attachments_version_id_fkey,
  DROP CONSTRAINT version_attachments_file_object_id_fkey;
ALTER TABLE approval_tokens
  DROP CONSTRAINT approval_tokens_version_id_fkey,
  DROP CONSTRAINT approval_tokens_approver_contact_id_fkey;
ALTER TABLE public_sessions
  DROP CONSTRAINT public_sessions_approval_token_id_fkey,
  DROP CONSTRAINT public_sessions_version_id_fkey;
ALTER TABLE otp_challenges
  DROP CONSTRAINT otp_challenges_public_session_id_fkey,
  DROP CONSTRAINT otp_challenges_contact_id_fkey;
ALTER TABLE decisions
  DROP CONSTRAINT decisions_project_id_fkey,
  DROP CONSTRAINT decisions_version_id_fkey,
  DROP CONSTRAINT decisions_public_session_id_fkey;
ALTER TABLE audit_events DROP CONSTRAINT audit_events_project_id_fkey;
ALTER TABLE messages
  DROP CONSTRAINT messages_version_id_fkey,
  DROP CONSTRAINT messages_contact_id_fkey,
  DROP CONSTRAINT messages_decision_id_fkey;
ALTER TABLE message_events DROP CONSTRAINT message_events_message_id_fkey;
ALTER TABLE generated_documents
  DROP CONSTRAINT generated_documents_project_id_fkey,
  DROP CONSTRAINT generated_documents_version_id_fkey;
ALTER TABLE payment_intents
  DROP CONSTRAINT payment_intents_project_id_fkey,
  DROP CONSTRAINT payment_intents_version_id_fkey;
ALTER TABLE legal_holds DROP CONSTRAINT legal_holds_project_id_fkey;
ALTER TABLE reminder_schedules DROP CONSTRAINT reminder_schedules_version_id_fkey;
ALTER TABLE employee_project_assignments
  DROP CONSTRAINT employee_project_assignments_employee_id_fkey,
  DROP CONSTRAINT employee_project_assignments_project_id_fkey;
ALTER TABLE inbound_messages
  DROP CONSTRAINT inbound_messages_employee_id_fkey,
  DROP CONSTRAINT inbound_messages_project_id_fkey,
  DROP CONSTRAINT inbound_messages_change_order_id_fkey;
ALTER TABLE inbound_message_media
  DROP CONSTRAINT inbound_message_media_inbound_message_id_fkey,
  DROP CONSTRAINT inbound_message_media_file_object_id_fkey;

ALTER TABLE customers ADD CONSTRAINT customers_merged_tenant_fk
  FOREIGN KEY (organization_id, merged_into_customer_id)
  REFERENCES customers (organization_id, id);
ALTER TABLE contacts ADD CONSTRAINT contacts_customer_tenant_fk
  FOREIGN KEY (organization_id, customer_id)
  REFERENCES customers (organization_id, id) ON DELETE CASCADE;
ALTER TABLE projects
  ADD CONSTRAINT projects_customer_tenant_fk
    FOREIGN KEY (organization_id, customer_id)
    REFERENCES customers (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT projects_approver_tenant_fk
    FOREIGN KEY (organization_id, default_approver_contact_id)
    REFERENCES contacts (organization_id, id),
  ADD CONSTRAINT projects_baseline_file_tenant_fk
    FOREIGN KEY (organization_id, baseline_document_file_id)
    REFERENCES file_objects (organization_id, id);
ALTER TABLE baseline_versions
  ADD CONSTRAINT baseline_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT baseline_file_tenant_fk
    FOREIGN KEY (organization_id, supporting_file_id)
    REFERENCES file_objects (organization_id, id);
ALTER TABLE project_members ADD CONSTRAINT project_members_project_tenant_fk
  FOREIGN KEY (organization_id, project_id)
  REFERENCES projects (organization_id, id) ON DELETE CASCADE;
ALTER TABLE file_objects ADD CONSTRAINT file_objects_project_tenant_fk
  FOREIGN KEY (organization_id, project_id)
  REFERENCES projects (organization_id, id) ON DELETE SET NULL (project_id);
ALTER TABLE change_orders
  ADD CONSTRAINT change_orders_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT change_orders_reversal_tenant_fk
    FOREIGN KEY (organization_id, reversal_of_change_order_id)
    REFERENCES change_orders (organization_id, id),
  ADD CONSTRAINT change_orders_current_version_tenant_fk
    FOREIGN KEY (organization_id, current_version_id)
    REFERENCES change_order_versions (organization_id, id)
    DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE change_order_versions
  ADD CONSTRAINT versions_change_order_tenant_fk
    FOREIGN KEY (organization_id, change_order_id)
    REFERENCES change_orders (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT versions_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT versions_approver_tenant_fk
    FOREIGN KEY (organization_id, approver_contact_id)
    REFERENCES contacts (organization_id, id),
  ADD CONSTRAINT versions_superseded_tenant_fk
    FOREIGN KEY (organization_id, superseded_by_version_id)
    REFERENCES change_order_versions (organization_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT versions_employee_tenant_fk
    FOREIGN KEY (organization_id, raised_by_employee_id)
    REFERENCES employees (organization_id, id);
ALTER TABLE line_items ADD CONSTRAINT line_items_version_tenant_fk
  FOREIGN KEY (organization_id, version_id)
  REFERENCES change_order_versions (organization_id, id) ON DELETE RESTRICT;
ALTER TABLE version_attachments
  ADD CONSTRAINT attachments_version_tenant_fk
    FOREIGN KEY (organization_id, version_id)
    REFERENCES change_order_versions (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT attachments_file_tenant_fk
    FOREIGN KEY (organization_id, file_object_id)
    REFERENCES file_objects (organization_id, id) ON DELETE RESTRICT;
ALTER TABLE approval_tokens
  ADD CONSTRAINT approval_tokens_version_tenant_fk
    FOREIGN KEY (organization_id, version_id)
    REFERENCES change_order_versions (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT approval_tokens_contact_tenant_fk
    FOREIGN KEY (organization_id, approver_contact_id)
    REFERENCES contacts (organization_id, id);
ALTER TABLE public_sessions
  ADD CONSTRAINT public_sessions_token_tenant_fk
    FOREIGN KEY (organization_id, approval_token_id)
    REFERENCES approval_tokens (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT public_sessions_version_tenant_fk
    FOREIGN KEY (organization_id, version_id)
    REFERENCES change_order_versions (organization_id, id) ON DELETE CASCADE;
ALTER TABLE otp_challenges
  ADD CONSTRAINT otp_session_tenant_fk
    FOREIGN KEY (organization_id, public_session_id)
    REFERENCES public_sessions (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT otp_contact_tenant_fk
    FOREIGN KEY (organization_id, contact_id)
    REFERENCES contacts (organization_id, id);
ALTER TABLE decisions
  ADD CONSTRAINT decisions_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT decisions_version_tenant_fk
    FOREIGN KEY (organization_id, version_id)
    REFERENCES change_order_versions (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT decisions_session_tenant_fk
    FOREIGN KEY (organization_id, public_session_id)
    REFERENCES public_sessions (organization_id, id);
ALTER TABLE audit_events ADD CONSTRAINT audit_project_tenant_fk
  FOREIGN KEY (organization_id, project_id)
  REFERENCES projects (organization_id, id) ON DELETE SET NULL (project_id);
ALTER TABLE messages
  ADD CONSTRAINT messages_version_tenant_fk
    FOREIGN KEY (organization_id, version_id)
    REFERENCES change_order_versions (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT messages_contact_tenant_fk
    FOREIGN KEY (organization_id, contact_id)
    REFERENCES contacts (organization_id, id),
  ADD CONSTRAINT messages_decision_tenant_fk
    FOREIGN KEY (organization_id, decision_id)
    REFERENCES decisions (organization_id, id) ON DELETE CASCADE;
ALTER TABLE message_events ADD CONSTRAINT message_events_message_tenant_fk
  FOREIGN KEY (organization_id, message_id)
  REFERENCES messages (organization_id, id) ON DELETE CASCADE;
ALTER TABLE generated_documents
  ADD CONSTRAINT generated_documents_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT generated_documents_version_tenant_fk
    FOREIGN KEY (organization_id, version_id)
    REFERENCES change_order_versions (organization_id, id) ON DELETE CASCADE;
ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id) ON DELETE SET NULL (project_id),
  ADD CONSTRAINT payment_intents_version_tenant_fk
    FOREIGN KEY (organization_id, version_id)
    REFERENCES change_order_versions (organization_id, id) ON DELETE SET NULL (version_id);
ALTER TABLE legal_holds ADD CONSTRAINT legal_holds_project_tenant_fk
  FOREIGN KEY (organization_id, project_id)
  REFERENCES projects (organization_id, id) ON DELETE CASCADE;
ALTER TABLE reminder_schedules ADD CONSTRAINT reminders_version_tenant_fk
  FOREIGN KEY (organization_id, version_id)
  REFERENCES change_order_versions (organization_id, id) ON DELETE CASCADE;
ALTER TABLE employee_project_assignments
  ADD CONSTRAINT assignments_employee_tenant_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT assignments_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id) ON DELETE CASCADE;
ALTER TABLE inbound_messages
  ADD CONSTRAINT inbound_employee_tenant_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE SET NULL (employee_id),
  ADD CONSTRAINT inbound_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id) ON DELETE SET NULL (project_id),
  ADD CONSTRAINT inbound_change_tenant_fk
    FOREIGN KEY (organization_id, change_order_id)
    REFERENCES change_orders (organization_id, id) ON DELETE SET NULL (change_order_id);
ALTER TABLE inbound_message_media
  ADD CONSTRAINT inbound_media_message_tenant_fk
    FOREIGN KEY (organization_id, inbound_message_id)
    REFERENCES inbound_messages (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT inbound_media_file_tenant_fk
    FOREIGN KEY (organization_id, file_object_id)
    REFERENCES file_objects (organization_id, id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Resource lease ownership
-- ---------------------------------------------------------------------------

ALTER TABLE file_objects
  ADD COLUMN scan_lease_token text,
  ADD COLUMN scan_leased_until timestamptz,
  ADD COLUMN scan_attempt_count integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT file_scan_lease_pair_check
    CHECK ((scan_lease_token IS NULL) = (scan_leased_until IS NULL)),
  ADD CONSTRAINT file_scan_attempt_count_check CHECK (scan_attempt_count >= 0);

CREATE INDEX file_objects_expired_scan_lease_idx
  ON file_objects (scan_leased_until)
  WHERE scan_status = 'SCANNING';

ALTER TABLE generated_documents
  ADD COLUMN generation_lease_token text,
  ADD COLUMN generation_leased_until timestamptz,
  ADD COLUMN generation_attempt_count integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT document_generation_lease_pair_check
    CHECK ((generation_lease_token IS NULL) = (generation_leased_until IS NULL)),
  ADD CONSTRAINT document_generation_attempt_count_check
    CHECK (generation_attempt_count >= 0);

CREATE INDEX generated_documents_expired_lease_idx
  ON generated_documents (generation_leased_until)
  WHERE status = 'GENERATING';
