-- Minimal Supabase-compatible baseline for isolated migration integration tests.
-- This is deliberately disposable and contains no production data or credentials.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists private;
create table private.kingshot_developer_api_keys (
  id uuid primary key,
  revoked_at timestamptz,
  expires_at timestamptz
);

create table public.kingshot_developer_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null,
  event_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_status integer,
  last_error text
);
