-- Browser push subscriptions for opt-in developer announcements and new gift-code alerts.
create table if not exists public.kingshot_push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.kingshot_push_subscriptions enable row level security;
revoke all on public.kingshot_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.kingshot_push_subscriptions to service_role;
create index if not exists kingshot_push_subscriptions_updated_at_idx
  on public.kingshot_push_subscriptions(updated_at desc);
