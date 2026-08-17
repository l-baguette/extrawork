-- Search documents and projection helpers.
-- Report §6.6 (tenant-scoped search), §9.5 (normalization), §13.3 (projection
-- integrity).

-- ---------------------------------------------------------------------------
-- Search documents
-- ---------------------------------------------------------------------------

-- `unaccent` is not IMMUTABLE by default because it depends on a dictionary,
-- so it cannot be used directly in an index expression. Wrapping it in an
-- IMMUTABLE function with the dictionary pinned is the standard, safe form:
-- the dictionary is fixed at 'unaccent' and never varies at runtime.
--
-- The extension's schema is resolved rather than hardcoded. A plain Postgres
-- install puts extensions in `public`; Supabase puts them in `extensions`. This
-- migration previously assumed `public.unaccent` and failed outright on a
-- managed host with "text search dictionary public.unaccent does not exist".
-- Both the function call and the dictionary name have to be qualified with
-- whichever schema the extension actually landed in.
--
-- `SET search_path` pins resolution for every later call, so the function
-- cannot be redirected by a caller's own search_path.
DO $do$
DECLARE
  ext_schema text;
BEGIN
  SELECT n.nspname INTO ext_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'unaccent';

  IF ext_schema IS NULL THEN
    RAISE EXCEPTION 'The unaccent extension is not installed; migration 0001 creates it';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION extrawork_unaccent(text) '
    'RETURNS text '
    'LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT '
    'SET search_path = pg_catalog, %I '
    'AS $fn$ SELECT %I.unaccent(%L::regdictionary, $1) $fn$',
    ext_schema,
    ext_schema,
    ext_schema || '.unaccent'
  );
END
$do$;

CREATE OR REPLACE FUNCTION extrawork_search_vector(VARIADIC parts text[])
RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT to_tsvector(
    'simple',
    extrawork_unaccent(lower(coalesce(array_to_string(parts, ' '), '')))
  )
$$;

CREATE OR REPLACE FUNCTION customers_search_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_document := extrawork_search_vector(
    NEW.display_name, coalesce(NEW.legal_name, ''), coalesce(NEW.notes, '')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER customers_search_update
  BEFORE INSERT OR UPDATE OF display_name, legal_name, notes ON customers
  FOR EACH ROW EXECUTE FUNCTION customers_search_trigger();

CREATE OR REPLACE FUNCTION projects_search_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_document := extrawork_search_vector(
    NEW.title,
    NEW.project_number,
    coalesce(NEW.site_address_json->>'city', ''),
    coalesce(NEW.site_address_json->>'line1', '')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_search_update
  BEFORE INSERT OR UPDATE OF title, project_number, site_address_json ON projects
  FOR EACH ROW EXECUTE FUNCTION projects_search_trigger();

-- A change order's searchable text lives on its current version, so the
-- trigger fires from the version table and updates the parent.
CREATE OR REPLACE FUNCTION change_orders_search_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE change_orders
     SET search_document = extrawork_search_vector(
           NEW.title, NEW.scope_description, coalesce(NEW.reason, ''), number
         ),
         updated_at = now()
   WHERE id = NEW.change_order_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER change_orders_search_update
  AFTER INSERT OR UPDATE OF title, scope_description, reason ON change_order_versions
  FOR EACH ROW EXECUTE FUNCTION change_orders_search_trigger();

-- ---------------------------------------------------------------------------
-- Projection integrity (report §13.3)
-- ---------------------------------------------------------------------------

-- Recomputes the approved delta for one project directly from approved
-- versions. Used by the nightly integrity job and by the repair command; it
-- returns values rather than writing, so the caller decides what to do.
CREATE OR REPLACE FUNCTION project_recomputed_totals(p_project_id uuid)
RETURNS TABLE (
  approved_delta_minor bigint,
  approved_schedule_delta_days integer,
  approved_count bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    coalesce(sum(v.total_delta_minor), 0)::bigint,
    coalesce(sum(v.schedule_delta_days), 0)::integer,
    count(*)::bigint
  FROM change_order_versions v
  WHERE v.project_id = p_project_id
    AND v.status = 'APPROVED'
$$;

-- Full-tenant sweep used by the nightly job: returns only the mismatches.
CREATE OR REPLACE FUNCTION project_integrity_mismatches()
RETURNS TABLE (
  project_id uuid,
  organization_id uuid,
  stored_delta_minor bigint,
  recomputed_delta_minor bigint,
  stored_revised_total_minor bigint,
  recomputed_revised_total_minor bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id,
    p.organization_id,
    p.approved_delta_minor,
    coalesce(a.sum_delta, 0)::bigint,
    p.revised_total_minor,
    (p.baseline_total_minor + coalesce(a.sum_delta, 0))::bigint
  FROM projects p
  LEFT JOIN (
    SELECT project_id, sum(total_delta_minor) AS sum_delta
    FROM change_order_versions
    WHERE status = 'APPROVED'
    GROUP BY project_id
  ) a ON a.project_id = p.id
  WHERE p.approved_delta_minor <> coalesce(a.sum_delta, 0)
     OR p.revised_total_minor <> p.baseline_total_minor + coalesce(a.sum_delta, 0)
$$;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_touch BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER customers_touch BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER contacts_touch BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER projects_touch BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER change_orders_touch BEFORE UPDATE ON change_orders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER change_order_versions_touch BEFORE UPDATE ON change_order_versions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER messages_touch BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER subscriptions_touch BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER job_queue_touch BEFORE UPDATE ON job_queue
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
