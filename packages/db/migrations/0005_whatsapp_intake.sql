-- WhatsApp intake: employees submit change requests by message.
--
-- This is the product's core interface: a site employee sends one WhatsApp
-- message and the system authenticates them, parses it, prices it, drafts a
-- contract and sends the customer a link to sign. Nothing here replaces the
-- existing change-order domain — it adds an inbound channel that feeds it.
--
-- Design notes:
--   * Employees have NO login. They are identified solely by the phone number
--     the owner registered, which is why the number is unique per organization
--     and why every inbound message is logged whether or not it authenticates.
--   * `inbound_messages` is an append-only forensic record. An unauthenticated
--     message is still recorded: "someone texted us claiming to be X" is
--     exactly the kind of thing an operator needs to see later.

-- ---------------------------------------------------------------------------
-- Employees: people allowed to raise requests, addressed by phone number only.
-- ---------------------------------------------------------------------------

CREATE TYPE employee_status AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');

CREATE TABLE employees (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  phone_e164        text NOT NULL,
  role_note         text,
  status            employee_status NOT NULL DEFAULT 'ACTIVE',
  -- When true the employee may raise a request on any of the org's projects.
  -- Otherwise they are limited to their explicit assignments below.
  all_projects      boolean NOT NULL DEFAULT false,
  -- A per-request ceiling in minor units. NULL means no ceiling. This is the
  -- owner's main control: a site supervisor can raise ₹20k of extra work
  -- without the owner being consulted, but not ₹5 lakh.
  max_request_minor bigint CHECK (max_request_minor IS NULL OR max_request_minor >= 0),
  created_by_user_id uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  lock_version      integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, phone_e164)
);

-- A phone number identifies exactly one employee across the whole system.
-- Without this, an inbound message from a number registered at two
-- organizations would be ambiguous, and guessing which tenant it belongs to is
-- precisely the cross-tenant mistake the report forbids (§3.2).
CREATE UNIQUE INDEX employees_phone_global_idx
  ON employees (phone_e164) WHERE status <> 'REMOVED';

CREATE INDEX employees_org_idx ON employees (organization_id, status);

CREATE TABLE employee_project_assignments (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, project_id)
);

CREATE INDEX employee_assignments_project_idx
  ON employee_project_assignments (project_id);

-- ---------------------------------------------------------------------------
-- Inbound message log: every message received, authenticated or not.
-- ---------------------------------------------------------------------------

CREATE TYPE inbound_status AS ENUM (
  'RECEIVED',        -- logged, not yet processed
  'REJECTED_UNKNOWN_SENDER',
  'REJECTED_NOT_AUTHORIZED',
  'REJECTED_UNPARSEABLE',
  'REJECTED_POLICY',  -- over the employee's ceiling, project closed, etc.
  'ACCEPTED'          -- produced a change order
);

CREATE TABLE inbound_messages (
  id                   uuid PRIMARY KEY,
  -- Null when the sender is unknown: we cannot attribute the message to a
  -- tenant, and inventing one would be a cross-tenant guess.
  organization_id      uuid REFERENCES organizations(id) ON DELETE SET NULL,
  employee_id          uuid REFERENCES employees(id) ON DELETE SET NULL,
  project_id           uuid REFERENCES projects(id) ON DELETE SET NULL,
  change_order_id      uuid REFERENCES change_orders(id) ON DELETE SET NULL,
  provider             text NOT NULL DEFAULT 'whatsapp',
  provider_message_id  text NOT NULL,
  from_phone_e164      text NOT NULL,
  body                 text,
  media_count          integer NOT NULL DEFAULT 0,
  status               inbound_status NOT NULL DEFAULT 'RECEIVED',
  -- What the parser understood, and what it could not.
  parsed               jsonb,
  rejection_reason     text,
  -- The reply we sent back, so support can see exactly what the employee saw.
  reply_text           text,
  received_at          timestamptz NOT NULL DEFAULT now(),
  processed_at         timestamptz,
  UNIQUE (provider, provider_message_id)
);

CREATE INDEX inbound_messages_org_idx
  ON inbound_messages (organization_id, received_at DESC);
CREATE INDEX inbound_messages_phone_idx
  ON inbound_messages (from_phone_e164, received_at DESC);
-- Feeds the "messages we could not process" operator view.
CREATE INDEX inbound_messages_unresolved_idx
  ON inbound_messages (received_at DESC)
  WHERE status <> 'ACCEPTED';

-- ---------------------------------------------------------------------------
-- Request templates: the owner-editable copy shown to the customer.
-- ---------------------------------------------------------------------------
--
-- The owner can change the wording their customers see. What they cannot
-- change is the assurance language and the disclaimer: those describe what the
-- record actually is, and letting a seller edit them would let the product
-- overstate its own evidence (report §3.3, §12.4). They live in code and are
-- covered by golden tests.

CREATE TABLE request_templates (
  organization_id   uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  -- Shown at the top of the customer page and the contract.
  heading           text NOT NULL DEFAULT 'Approval requested for additional work',
  intro             text NOT NULL DEFAULT
    'We have been asked to carry out work beyond the original scope of your project. '
    'Please review the details below and record your decision.',
  -- Contract body. Supports {{placeholders}} resolved at render time.
  terms_body        text NOT NULL DEFAULT '',
  -- Free-text payment/settlement note, e.g. "Billed with the next running account bill".
  payment_note      text,
  footer_note       text,
  -- Bumped on every edit; frozen into each sent version so a later edit cannot
  -- change what a customer already agreed to.
  template_version  integer NOT NULL DEFAULT 1,
  updated_by_user_id uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- The exact template text used for a sent version, captured at send time.
ALTER TABLE change_order_versions
  ADD COLUMN template_snapshot jsonb,
  ADD COLUMN template_version integer,
  -- Set when the request arrived over WhatsApp rather than the web composer.
  ADD COLUMN origin text NOT NULL DEFAULT 'WEB'
    CHECK (origin IN ('WEB', 'WHATSAPP', 'IMPORT')),
  ADD COLUMN raised_by_employee_id uuid REFERENCES employees(id);

CREATE INDEX versions_origin_idx
  ON change_order_versions (organization_id, origin, created_at DESC);

-- ---------------------------------------------------------------------------
-- Signature artifacts: the drawn signature or typed initials on a decision.
-- ---------------------------------------------------------------------------
--
-- Report §3.3 remains in force: this raises the *quality of the evidence*, not
-- the legal class of the record. A drawn signature is still a secure-link
-- record of assent, and the copy says so.

ALTER TABLE decisions
  -- SHA-256 of the signature image bytes; the image itself lives in private
  -- object storage, never inline in the row.
  ADD COLUMN signature_sha256 bytea,
  ADD COLUMN signature_storage_key text,
  ADD COLUMN signature_kind text
    CHECK (signature_kind IS NULL OR signature_kind IN ('TYPED_NAME', 'DRAWN', 'INITIALS')),
  -- Width/height of the captured canvas, so the image can be rendered at the
  -- proportions it was drawn at in the evidence pack.
  ADD COLUMN signature_width integer,
  ADD COLUMN signature_height integer;
