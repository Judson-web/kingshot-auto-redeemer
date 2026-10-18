-- The recovery queue is an internal worker coordination table.
-- Keep access server-side only; service_role is used by trusted backend workers.
ALTER TABLE public.kingshot_redemption_recovery_queue ENABLE ROW LEVEL SECURITY;

-- Prevent browser-facing Supabase roles (and PUBLIC) from accessing recovery jobs.
REVOKE ALL ON TABLE public.kingshot_redemption_recovery_queue FROM PUBLIC, anon, authenticated;

-- Preserve the worker's required CRUD access. service_role bypasses RLS by design.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kingshot_redemption_recovery_queue TO service_role;
