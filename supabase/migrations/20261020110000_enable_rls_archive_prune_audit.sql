-- Protect the internal archive-pruning audit log from direct Data API access.
-- The audited read RPCs are SECURITY DEFINER, owned by postgres, and retain
-- their existing service_role-only EXECUTE grants. Do not FORCE RLS.
ALTER TABLE private.archive_prune_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.archive_prune_audit FROM PUBLIC, anon, authenticated, service_role;
