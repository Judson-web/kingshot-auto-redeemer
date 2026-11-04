-- Move the global Kingshot upstream pacing/circuit-breaker state to Neon.
-- This is additive and deliberately separate from Supabase redemption history.
create table if not exists public.redemption_source_state (
  source_url text primary key,
  next_request_at timestamptz not null default now(),
  cooldown_until timestamptz not null default now(),
  last_http_status integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists redemption_source_state_updated_idx
  on public.redemption_source_state(updated_at desc);
