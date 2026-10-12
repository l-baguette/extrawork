-- Three-party workspace, part 1: collaborators, roles and workspace settings.
-- Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md
-- (decisions D1, D2, D3, D7, D11, D13).
--
-- A project shared with another firm stays in the designer's workspace. The
-- collaborator joins that workspace with the COLLABORATOR role and a grant on
-- each shared project (`project_members`), so sessions, project grants and the
-- row-level security from 0019 apply to them unchanged. Nothing here opens a
-- path for one tenant to read another tenant's rows.

-- Not usable in this transaction; nothing below references the new value.
ALTER TYPE membership_role ADD VALUE IF NOT EXISTS 'COLLABORATOR';

-- ---------------------------------------------------------------------------
-- Memberships: which party a collaborator represents, for display and RACI.
-- ---------------------------------------------------------------------------

ALTER TABLE memberships
  ADD COLUMN collaborator_party text
    CHECK (collaborator_party IS NULL OR collaborator_party IN
      ('CONSTRUCTION','ARCHITECT','CONSULTANT','HOMEOWNER','OTHER')),
  ADD COLUMN company_name text
    CHECK (company_name IS NULL OR length(company_name) <= 200);

-- ---------------------------------------------------------------------------
-- Organizations: what kind of firm, how requests are routed, storage quota.
-- ---------------------------------------------------------------------------

ALTER TABLE organizations
  ADD COLUMN business_type text
    CHECK (business_type IS NULL OR business_type IN
      ('DESIGN_FIRM','ARCHITECTURE_FIRM','DESIGN_AND_BUILD','CONSTRUCTION',
       'SPECIALIST_CONTRACTOR','OTHER')),
  -- D3. DESIGNER_REVIEW: every request raised by a site-team member, a
  -- collaborator or the homeowner waits for the designer before it reaches the
  -- client. AUTO_SEND keeps the original behaviour, where a complete WhatsApp
  -- request within the sender's ceiling goes straight to the customer.
  ADD COLUMN request_routing text NOT NULL DEFAULT 'DESIGNER_REVIEW'
    CHECK (request_routing IN ('DESIGNER_REVIEW','AUTO_SEND')),
  -- D11. Per workspace, not per user: 2 GiB during the beta.
  ADD COLUMN storage_quota_bytes bigint NOT NULL DEFAULT 2147483648
    CHECK (storage_quota_bytes >= 0);

-- D13. New workspaces start on a free beta plan; paid plans stay modelled.
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_plan_code_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_code_check
  CHECK (plan_code IN ('TRIAL','STARTER_MONTHLY','PROJECT_PASS','PRO_MONTHLY','BETA'));

-- ---------------------------------------------------------------------------
-- Project invitations.
-- ---------------------------------------------------------------------------
--
-- One row per (email, project). The token is stored only as its SHA-256, the
-- same rule as approval tokens: a database read never yields a usable link.
-- Acceptance requires the signed-in user's email to equal `email_normalized`,
-- so a forwarded link does not hand a stranger the project.

CREATE TABLE project_invitations (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id          uuid NOT NULL,
  email_normalized    text NOT NULL
    CHECK (email_normalized = lower(email_normalized) AND position('@' IN email_normalized) > 1),
  display_name        text CHECK (display_name IS NULL OR length(display_name) <= 200),
  party               text NOT NULL DEFAULT 'OTHER'
    CHECK (party IN ('CONSTRUCTION','ARCHITECT','CONSULTANT','HOMEOWNER','OTHER')),
  company_name        text CHECK (company_name IS NULL OR length(company_name) <= 200),
  phone_e164          text CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  message             text CHECK (message IS NULL OR length(message) <= 1000),
  token_sha256        bytea NOT NULL UNIQUE,
  status              text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')),
  invited_by_user_id  uuid REFERENCES users(id),
  accepted_by_user_id uuid REFERENCES users(id),
  accepted_at         timestamptz,
  revoked_at          timestamptz,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_invitations_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT project_invitations_accepted_consistency
    CHECK ((status = 'ACCEPTED') = (accepted_at IS NOT NULL)),
  CONSTRAINT project_invitations_revoked_consistency
    CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

-- At most one live invitation per person per project; re-inviting refreshes it.
CREATE UNIQUE INDEX project_invitations_pending_uidx
  ON project_invitations (project_id, email_normalized) WHERE status = 'PENDING';
CREATE INDEX project_invitations_email_idx
  ON project_invitations (email_normalized) WHERE status = 'PENDING';
CREATE INDEX project_invitations_project_idx
  ON project_invitations (organization_id, project_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Site team (the `employees` table): people identified only by WhatsApp.
-- ---------------------------------------------------------------------------
--
-- D7. The global uniqueness of a phone number assumed the contractor was the
-- customer. A foreman now routinely works with several design firms, so the
-- same number may sit on several rosters. Intake never guesses between them:
-- a sender who matches more than one project is asked which one.
-- Uniqueness within one organization (the table's UNIQUE constraint) stays.

DROP INDEX IF EXISTS employees_phone_global_idx;
CREATE INDEX employees_phone_idx ON employees (phone_e164) WHERE status <> 'REMOVED';

ALTER TABLE employees
  ADD COLUMN party text NOT NULL DEFAULT 'INTERNAL'
    CHECK (party IN ('INTERNAL','CONSTRUCTION','ARCHITECT','CONSULTANT','OTHER')),
  ADD COLUMN company_name text CHECK (company_name IS NULL OR length(company_name) <= 200),
  ADD COLUMN team_role text NOT NULL DEFAULT 'OTHER'
    CHECK (team_role IN ('SITE_SUPERVISOR','FOREMAN','CONTRACTOR','DESIGNER','WORKER','OTHER'));

-- ---------------------------------------------------------------------------
-- Row-level security for the new tenant table (mirrors 0019).
-- ---------------------------------------------------------------------------

ALTER TABLE project_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_invitations
  USING (
    current_setting('extrawork.organization_id', true) = '*'
    OR organization_id::text = current_setting('extrawork.organization_id', true)
  )
  WITH CHECK (
    current_setting('extrawork.organization_id', true) = '*'
    OR organization_id::text = current_setting('extrawork.organization_id', true)
  );
