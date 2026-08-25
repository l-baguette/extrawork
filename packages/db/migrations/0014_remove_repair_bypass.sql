-- Frozen evidence has no application-visible repair mode.
--
-- A projection repair recomputes mutable projections from immutable evidence;
-- it never needs to rewrite the evidence tables. Returning false here keeps
-- the existing trigger functions simple while ensuring that neither a custom
-- GUC nor the database owner silently bypasses them. A database superuser can
-- always disable triggers explicitly for disaster recovery, but that is a
-- privileged PostgreSQL operation rather than an application capability.

CREATE OR REPLACE FUNCTION repair_mode_enabled()
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT false
$$;
