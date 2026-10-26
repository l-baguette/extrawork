-- Row-level security: the database enforcing tenant isolation, not trusting us.
--
-- Every repository already scopes on `organization_id`, and the tenant-isolation
-- suite proves it does today. Neither survives the query somebody adds next
-- year that forgets its WHERE clause. A policy does: the row is not there to be
-- returned, whatever the query says.
--
-- The tenant comes from `extrawork.organization_id`, set transaction-locally by
-- `applyScope()` in packages/db/src/tenant-scope.ts.
--
-- Unset means *deny*, not allow. `current_setting(..., true)` returns NULL when
-- the setting is missing, and `organization_id::text = NULL` is NULL, which is
-- not true, so no row matches. A code path that forgets to declare a scope
-- returns nothing and fails loudly in tests — the opposite failure (returning
-- everything) is the one that ends up in a disclosure runbook.
--
-- FORCE, because the application connects as the table owner in development and
-- in the test suite, and PostgreSQL exempts owners from RLS by default. Without
-- FORCE the policies would be inert in exactly the places we verify them and
-- live only in production.

DO $$
DECLARE
  -- Tenant data. Deliberately excludes the tables that must be readable
  -- *before* a tenant is known — `organizations`, `memberships`, `users`,
  -- `sessions` — because those are what resolve which tenant you are. Locking
  -- them behind a tenant scope is circular: you could never sign in to
  -- establish the scope that would let you read your own membership.
  target text;
  tenant_tables text[] := ARRAY[
    'approval_tokens', 'audit_events', 'auth_challenges', 'baseline_versions',
    'change_order_versions', 'change_orders', 'contacts', 'customers',
    'data_subject_requests', 'decisions', 'document_sequences',
    'employee_project_assignments', 'employees', 'entitlement_counters',
    'file_objects', 'generated_documents', 'inbound_message_media',
    'inbound_messages', 'job_queue', 'legal_holds', 'line_items',
    'message_events', 'messages', 'otp_challenges', 'outbox_events',
    'payment_intents', 'project_members', 'projects', 'public_sessions',
    'reminder_schedules', 'repair_events', 'request_templates',
    'subscriptions', 'support_access_grants', 'version_attachments'
  ];
BEGIN
  FOREACH target IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target);
    -- USING filters what can be read, updated or deleted; WITH CHECK stops a
    -- row being written into a tenant other than the declared one, which is the
    -- insert-side mirror of the same rule.
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
