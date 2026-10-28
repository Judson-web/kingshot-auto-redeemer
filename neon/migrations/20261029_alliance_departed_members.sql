-- Keep departed alliance members in the sync ledger for history while excluding them
-- from the active roster. Their global Supabase player registrations are not changed.
ALTER TABLE public.alliance_sync_seen_players
  DROP CONSTRAINT IF EXISTS alliance_sync_seen_players_registration_status_check;

ALTER TABLE public.alliance_sync_seen_players
  ADD CONSTRAINT alliance_sync_seen_players_registration_status_check
  CHECK (registration_status = ANY (ARRAY[
    'pending'::text,
    'registered'::text,
    'already_registered'::text,
    'skipped'::text,
    'error'::text,
    'departed'::text
  ]));

-- Record how many previously tracked members left during each validated sync run.
ALTER TABLE public.alliance_sync_runs
  ADD COLUMN IF NOT EXISTS departed_count integer NOT NULL DEFAULT 0
  CHECK (departed_count >= 0);
