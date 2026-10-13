-- Private, short-retention first-party visitor telemetry.
create table if not exists public.kingshot_visitor_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  ip_address inet,
  country_code text,
  region text,
  city text,
  timezone text,
  path text not null,
  referrer_host text,
  user_agent text,
  browser text,
  operating_system text,
  device_type text,
  language text,
  screen_class text,
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists kingshot_visitor_events_occurred_at_idx
  on public.kingshot_visitor_events (occurred_at desc);
create index if not exists kingshot_visitor_events_expires_at_idx
  on public.kingshot_visitor_events (expires_at);

alter table public.kingshot_visitor_events enable row level security;
revoke all on table public.kingshot_visitor_events from anon, authenticated;
grant select, insert, delete on table public.kingshot_visitor_events to service_role;
grant usage, select on sequence public.kingshot_visitor_events_id_seq to service_role;

comment on table public.kingshot_visitor_events is
  'Short-retention first-party website telemetry. Raw IP addresses are retained for at most 30 days; no public client policies.';
