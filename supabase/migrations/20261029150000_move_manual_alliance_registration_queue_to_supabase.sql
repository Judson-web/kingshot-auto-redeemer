create table if not exists public.alliance_manual_registration_jobs (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null,
  owner_user_id uuid not null,
  kingdom_id text not null,
  alliance_tag text not null,
  status text not null default 'queued'
    check (status in ('queued','running','completed','partial','failed')),
  selected_player_ids jsonb not null check (jsonb_typeof(selected_player_ids) = 'array'),
  total_count integer not null check (total_count > 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  succeeded_count integer not null default 0 check (succeeded_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  current_player_id text,
  results jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array'),
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint alliance_manual_registration_counts_valid
    check (processed_count <= total_count and succeeded_count + failed_count <= processed_count)
);

create unique index if not exists alliance_manual_registration_one_active_per_config
  on public.alliance_manual_registration_jobs(config_id)
  where status in ('queued','running');
create index if not exists alliance_manual_registration_jobs_owner_created
  on public.alliance_manual_registration_jobs(owner_user_id, created_at desc);
create index if not exists alliance_manual_registration_jobs_queue
  on public.alliance_manual_registration_jobs(status, created_at);

alter table public.alliance_manual_registration_jobs enable row level security;
revoke all on public.alliance_manual_registration_jobs from anon, authenticated, public;
grant all on public.alliance_manual_registration_jobs to service_role;

create or replace function public.claim_alliance_manual_registration_job()
returns setof public.alliance_manual_registration_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  select j.id into claimed_id
  from public.alliance_manual_registration_jobs j
  where j.status = 'queued'
     or (j.status = 'running' and j.updated_at < now() - interval '120 seconds')
  order by j.created_at
  limit 1
  for update skip locked;

  if claimed_id is null then return; end if;

  return query
  update public.alliance_manual_registration_jobs j
  set status = 'running', started_at = coalesce(j.started_at, now()), updated_at = now()
  where j.id = claimed_id
    and (j.status = 'queued' or (j.status = 'running' and j.updated_at < now() - interval '120 seconds'))
  returning j.*;
end;
$$;

create or replace function public.record_alliance_manual_registration_result(
  p_job_id uuid, p_player_id text, p_result jsonb
)
returns setof public.alliance_manual_registration_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.alliance_manual_registration_jobs j
  set processed_count = j.processed_count + 1,
      succeeded_count = j.succeeded_count + case when coalesce((p_result->>'ok')::boolean, false) then 1 else 0 end,
      failed_count = j.failed_count + case when coalesce((p_result->>'ok')::boolean, false) then 0 else 1 end,
      skipped_count = j.skipped_count + case when coalesce((p_result->>'alreadyRegistered')::boolean, false) then 1 else 0 end,
      current_player_id = p_player_id,
      results = j.results || jsonb_build_array(p_result),
      updated_at = now()
  where j.id = p_job_id and j.status = 'running' and j.processed_count < j.total_count
  returning j.*;
end;
$$;

revoke all on function public.claim_alliance_manual_registration_job() from public, anon, authenticated;
revoke all on function public.record_alliance_manual_registration_result(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_alliance_manual_registration_job() to service_role;
grant execute on function public.record_alliance_manual_registration_result(uuid, text, jsonb) to service_role;
