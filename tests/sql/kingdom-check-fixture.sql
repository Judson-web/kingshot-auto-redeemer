-- Disposable PostgreSQL fixture for the V4 migration integration test.
-- This intentionally creates only the pre-migration contract used by the RPCs.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.kingshot_autoredeem (
  player_id text primary key,
  enabled boolean not null default true,
  stale boolean not null default false,
  kingdom_id text,
  last_kingdom_check_at timestamptz,
  kingdom_check_claimed_at timestamptz,
  updated_at timestamptz,
  player_name text,
  avatar_url text,
  stale_at timestamptz,
  stale_reason text
);

create table public.kingshot_player_events (
  id bigint generated always as identity primary key,
  player_id text not null,
  event_type text not null,
  old_kingdom_id text,
  new_kingdom_id text,
  created_at timestamptz not null default clock_timestamp()
);
