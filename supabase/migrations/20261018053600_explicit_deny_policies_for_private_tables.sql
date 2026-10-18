-- Explicit deny-all policies make the intended server-only posture clear to
-- auditors while preserving trusted service_role and table-owner access.
-- Only touch RLS-enabled tables that currently have no policies.
DO $migration$
DECLARE
  item record;
  policy_name text := 'deny_all_untrusted_access';
BEGIN
  FOR item IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname IN ('public', 'private')
      AND c.relrowsecurity = true
      AND NOT EXISTS (
        SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
      )
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL TO public USING (false) WITH CHECK (false)',
      policy_name, item.schema_name, item.table_name
    );
  END LOOP;
END
$migration$;
