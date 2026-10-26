-- Three-party workspace, part 3: each project as a shared folder.
-- Spec decisions D10, D11, D12.
--
-- A project holds folders; a folder holds documents. A document is a stored
-- file, a link (Google Drive, Dropbox, OneDrive or any https URL), or a short
-- note — WhatsApp text that is not a request lands here as a note. The
-- "Approvals & change records" folder is not stored: it is the request register
-- and its evidence packs, rendered alongside these.
--
-- Visibility is per folder:
--   INTERNAL  the designer's firm only
--   PROJECT   the firm and the project's collaborators
--   CLIENT    all of the above, and the homeowner portal

CREATE TABLE project_folders (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id         uuid NOT NULL,
  name               text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  visibility         text NOT NULL DEFAULT 'PROJECT'
    CHECK (visibility IN ('INTERNAL','PROJECT','CLIENT')),
  -- The defaults every project gets. Intake files WhatsApp content into the
  -- WHATSAPP folder by key, so it survives being renamed.
  system_key         text
    CHECK (system_key IS NULL OR system_key IN ('PLANS','CONTRACTS','PHOTOS','BILLS','WHATSAPP')),
  position           integer NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_folders_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX project_folders_org_id_uidx ON project_folders (organization_id, id);
-- A document's folder must be on the document's own project; this is the
-- parent key that rule is enforced against.
CREATE UNIQUE INDEX project_folders_project_id_uidx
  ON project_folders (organization_id, project_id, id);
CREATE UNIQUE INDEX project_folders_name_uidx
  ON project_folders (project_id, lower(btrim(name)));
CREATE UNIQUE INDEX project_folders_system_uidx
  ON project_folders (project_id, system_key) WHERE system_key IS NOT NULL;
CREATE INDEX project_folders_project_idx
  ON project_folders (organization_id, project_id, position);

CREATE TRIGGER project_folders_touch BEFORE UPDATE ON project_folders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE project_documents (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id           uuid NOT NULL,
  folder_id            uuid NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('FILE','LINK','NOTE')),
  title                text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  notes                text CHECK (notes IS NULL OR length(notes) <= 2000),
  file_object_id       uuid,
  -- https only: an http or javascript: link in a shared folder is a trap.
  url                  text CHECK (url IS NULL OR (url ~ '^https://[^\s]+$' AND length(url) <= 2000)),
  body                 text CHECK (body IS NULL OR length(body) BETWEEN 1 AND 4000),
  source               text NOT NULL DEFAULT 'WEB' CHECK (source IN ('WEB','WHATSAPP','PORTAL')),
  -- Exactly who added it. A WhatsApp sender has no user account: they are a
  -- site-team member or a customer contact, recorded as such rather than
  -- attributed to whichever designer happens to be signed in.
  added_by_user_id     uuid REFERENCES users(id),
  added_by_employee_id uuid,
  added_by_contact_id  uuid,
  inbound_message_id   uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  deleted_by_user_id   uuid REFERENCES users(id),
  CONSTRAINT project_documents_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT project_documents_folder_fk
    FOREIGN KEY (organization_id, project_id, folder_id)
    REFERENCES project_folders (organization_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_documents_file_tenant_fk
    FOREIGN KEY (organization_id, file_object_id)
    REFERENCES file_objects (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_documents_employee_tenant_fk
    FOREIGN KEY (organization_id, added_by_employee_id)
    REFERENCES employees (organization_id, id),
  CONSTRAINT project_documents_contact_tenant_fk
    FOREIGN KEY (organization_id, added_by_contact_id)
    REFERENCES contacts (organization_id, id),
  CONSTRAINT project_documents_inbound_tenant_fk
    FOREIGN KEY (organization_id, inbound_message_id)
    REFERENCES inbound_messages (organization_id, id),
  CONSTRAINT project_documents_kind_file CHECK ((kind = 'FILE') = (file_object_id IS NOT NULL)),
  CONSTRAINT project_documents_kind_link CHECK ((kind = 'LINK') = (url IS NOT NULL)),
  CONSTRAINT project_documents_kind_note CHECK ((kind = 'NOTE') = (body IS NOT NULL)),
  CONSTRAINT project_documents_deleted_consistency
    CHECK (deleted_by_user_id IS NULL OR deleted_at IS NOT NULL)
);

CREATE UNIQUE INDEX project_documents_org_id_uidx ON project_documents (organization_id, id);
CREATE INDEX project_documents_folder_idx
  ON project_documents (organization_id, folder_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX project_documents_project_idx
  ON project_documents (organization_id, project_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX project_documents_file_idx ON project_documents (file_object_id)
  WHERE file_object_id IS NOT NULL;

CREATE TRIGGER project_documents_touch BEFORE UPDATE ON project_documents
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Milestones: the dated points of a project's timeline.
-- ---------------------------------------------------------------------------

CREATE TABLE project_milestones (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id           uuid NOT NULL,
  title                text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  kind                 text NOT NULL DEFAULT 'MILESTONE'
    CHECK (kind IN ('MILESTONE','SITE_VISIT','DELIVERY','HANDOVER','PAYMENT','OTHER')),
  due_date             date NOT NULL,
  notes                text CHECK (notes IS NULL OR length(notes) <= 2000),
  -- Shown on the homeowner portal when true.
  client_visible       boolean NOT NULL DEFAULT true,
  completed_at         timestamptz,
  completed_by_user_id uuid REFERENCES users(id),
  created_by_user_id   uuid REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_milestones_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX project_milestones_org_id_uidx ON project_milestones (organization_id, id);
CREATE INDEX project_milestones_project_idx
  ON project_milestones (organization_id, project_id, due_date);
CREATE INDEX project_milestones_open_due_idx
  ON project_milestones (due_date) WHERE completed_at IS NULL;

CREATE TRIGGER project_milestones_touch BEFORE UPDATE ON project_milestones
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security (mirrors 0019).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['project_folders','project_documents','project_milestones'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (
          current_setting('extrawork.organization_id', true) = '*'
          OR organization_id::text = current_setting('extrawork.organization_id', true)
        )
        WITH CHECK (
          current_setting('extrawork.organization_id', true) = '*'
          OR organization_id::text = current_setting('extrawork.organization_id', true)
        )
    $p$, target);
  END LOOP;
END $$;
