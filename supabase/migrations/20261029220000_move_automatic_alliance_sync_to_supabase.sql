-- Move automatic alliance-sync live state to Supabase.
-- Neon remains untouched as the historical archive until the cutover is verified.

create table if not exists public.alliance_sync_config (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  kingdom_id text not null check (kingdom_id ~ '^[0-9]{1,10}$'),
  alliance_tag text not null check (alliance_tag ~ '^[A-Za-z0-9_-]{1,20}$'),
  alliance_name text not null default '',
  enabled boolean not null default true,
  interval_hours integer not null default 24 check (interval_hours in (24,48,72,168)),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_run_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_status text not null default 'pending'
    check (last_status in ('pending','running','success','partial','deferred','error','paused','unregistered')),
  last_error_code text,
  last_error_message text,
  last_roster_count integer,
  last_added_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alliance_sync_config_owner_user_id_kingdom_id_alliance_tag_key
    unique (owner_user_id, kingdom_id, alliance_tag)
);
create unique index if not exists alliance_sync_one_config_per_alliance_idx
  on public.alliance_sync_config (kingdom_id, lower(alliance_tag));
create index if not exists alliance_sync_config_due_idx
  on public.alliance_sync_config (next_run_at) where enabled = true;

create table if not exists public.alliance_sync_runs (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.alliance_sync_config(id) on delete restrict,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running','success','partial','deferred','error')),
  roster_count integer,
  added_count integer not null default 0,
  skipped_count integer not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  departed_count integer not null default 0 check (departed_count >= 0)
);
create index if not exists alliance_sync_runs_config_idx
  on public.alliance_sync_runs (config_id, started_at desc);

create table if not exists public.alliance_sync_seen_players (
  config_id uuid not null references public.alliance_sync_config(id) on delete restrict,
  player_id text not null check (player_id ~ '^[0-9]{5,20}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  registered_at timestamptz,
  registration_status text not null default 'pending'
    check (registration_status in ('pending','registered','already_registered','skipped','error','departed')),
  last_error_code text,
  primary key (config_id, player_id)
);
create index if not exists alliance_sync_seen_pending_idx
  on public.alliance_sync_seen_players (config_id, first_seen_at)
  where registration_status in ('pending','error');

-- These tables are backend-owned. All access goes through server-side service-role
-- credentials and the existing authenticated admin API.
alter table public.alliance_sync_config enable row level security;
alter table public.alliance_sync_runs enable row level security;
alter table public.alliance_sync_seen_players enable row level security;
revoke all on public.alliance_sync_config from anon, authenticated, public;
revoke all on public.alliance_sync_runs from anon, authenticated, public;
revoke all on public.alliance_sync_seen_players from anon, authenticated, public;
grant all on public.alliance_sync_config to service_role;
grant all on public.alliance_sync_runs to service_role;
grant all on public.alliance_sync_seen_players to service_role;

-- Atomically claim one due configuration. The token is the worker lease fence.
create or replace function public.claim_due_alliance_sync_config(p_lease_token uuid)
returns setof public.alliance_sync_config
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  select c.id into claimed_id
  from public.alliance_sync_config c
  where c.enabled = true
    and c.next_run_at <= now()
    and (c.lease_expires_at is null or c.lease_expires_at < now())
  order by c.next_run_at
  limit 1
  for update skip locked;

  if claimed_id is null then return; end if;

  return query
  update public.alliance_sync_config c
  set lease_token = p_lease_token,
      lease_expires_at = now() + interval '4 minutes',
      last_status = 'running',
      last_attempt_at = now(),
      updated_at = now()
  where c.id = claimed_id
    and c.enabled = true
    and (c.lease_expires_at is null or c.lease_expires_at < now())
  returning c.*;
end;
$$;

revoke all on function public.claim_due_alliance_sync_config(uuid) from public, anon, authenticated;
grant execute on function public.claim_due_alliance_sync_config(uuid) to service_role;
