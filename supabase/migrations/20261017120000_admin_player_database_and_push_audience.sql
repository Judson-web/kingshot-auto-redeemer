-- Admin-managed player bans and audience-scoped web push subscriptions.
create table if not exists public.kingshot_player_bans (
  player_id text primary key check (player_id ~ '^[0-9]{5,20}$'),
  reason text not null default 'Blocked by administrator',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.kingshot_player_bans enable row level security;
revoke all on public.kingshot_player_bans from public, anon, authenticated;
grant all on public.kingshot_player_bans to service_role;

alter table public.kingshot_push_subscriptions
  add column if not exists audience text not null default 'public'
  check (audience in ('public','admin'));
create index if not exists kingshot_push_subscriptions_audience_idx
  on public.kingshot_push_subscriptions(audience,last_seen_at desc);
