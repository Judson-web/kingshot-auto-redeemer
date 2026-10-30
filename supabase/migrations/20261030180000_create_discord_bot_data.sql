create table if not exists public.discord_guilds (
  guild_id text primary key check (guild_id ~ '^[0-9]{5,25}$'),
  guild_name text,
  status text not null default 'active' check (status in ('active','disabled','left')),
  installed_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.discord_guild_settings (
  guild_id text primary key references public.discord_guilds(guild_id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.discord_command_events (
  id bigint generated always as identity primary key,
  guild_id text references public.discord_guilds(guild_id) on delete set null,
  command_name text not null check (length(command_name) between 1 and 64),
  actor_id text check (actor_id is null or actor_id ~ '^[0-9]{5,25}$'),
  outcome text not null check (outcome in ('accepted','succeeded','failed','rejected')),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists public.discord_audit_log (
  id uuid primary key default gen_random_uuid(),
  guild_id text references public.discord_guilds(guild_id) on delete set null,
  actor_id text check (actor_id is null or actor_id ~ '^[0-9]{5,25}$'),
  action text not null check (length(action) between 1 and 100),
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists discord_command_events_created_idx on public.discord_command_events (created_at desc);
create index if not exists discord_command_events_guild_created_idx on public.discord_command_events (guild_id, created_at desc);
create index if not exists discord_audit_log_guild_created_idx on public.discord_audit_log (guild_id, created_at desc);

alter table public.discord_guilds enable row level security;
alter table public.discord_guild_settings enable row level security;
alter table public.discord_command_events enable row level security;
alter table public.discord_audit_log enable row level security;

revoke all on public.discord_guilds, public.discord_guild_settings, public.discord_command_events, public.discord_audit_log from anon, authenticated;
grant all on public.discord_guilds, public.discord_guild_settings, public.discord_command_events, public.discord_audit_log to service_role;
grant usage, select on sequence public.discord_command_events_id_seq to service_role;
