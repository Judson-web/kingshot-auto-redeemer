create table if not exists public.alliance_manual_registration_jobs (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.alliance_sync_config(id) on delete cascade,
  owner_user_id uuid not null,
  status text not null default 'queued' check (status in ('queued','running','completed','partial','failed')),
  selected_player_ids jsonb not null default '[]'::jsonb,
  total_count integer not null default 0 check (total_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  succeeded_count integer not null default 0 check (succeeded_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  current_player_id text,
  results jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint alliance_manual_registration_job_counts check (processed_count <= total_count)
);
create index if not exists alliance_manual_registration_jobs_owner_recent
  on public.alliance_manual_registration_jobs(owner_user_id, created_at desc);
create index if not exists alliance_manual_registration_jobs_queue
  on public.alliance_manual_registration_jobs(status, created_at)
  where status in ('queued','running');
alter table public.alliance_manual_registration_jobs enable row level security;
revoke all on public.alliance_manual_registration_jobs from anon, authenticated;
grant all on public.alliance_manual_registration_jobs to service_role;
