create or replace function public.redemption_service_health()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, cron
as $$
  with required_jobs(jobname, max_age_seconds) as (
    values
      ('secondary-redemption-codes-refresh', 900),
      ('secondary-redemption-backfill', 300),
      ('secondary-redemption-discord-outbox', 300),
      ('secondary-redemption-primary-result-sync', 300),
      ('secondary-redemption-gift-code-discord-outbox', 300),
      ('secondary-redemption-edge-worker-0', 300)
  ),
  job_health as (
    select r.jobname, r.max_age_seconds,
      coalesce(j.active, false) as active,
      d.status as last_status, d.end_time as last_run_at,
      case when d.end_time is not null then greatest(0, floor(extract(epoch from (now() - d.end_time)))::integer) else null end as age_seconds,
      (j.active is true and d.status = 'succeeded' and d.end_time >= now() - make_interval(secs => r.max_age_seconds)) as healthy
    from required_jobs r
    left join cron.job j on j.jobname = r.jobname
    left join lateral (
      select status, end_time from cron.job_run_details
      where jobid = j.jobid order by start_time desc limit 1
    ) d on true
  )
  select jsonb_build_object(
    'healthy', coalesce(bool_and(healthy), false),
    'status', case when coalesce(bool_and(healthy), false) then 'OPERATIONAL' else 'NEEDS_ATTENTION' end,
    'checkedAt', now(),
    'jobs', coalesce(jsonb_agg(jsonb_build_object(
      'name', jobname, 'active', active, 'lastStatus', last_status,
      'lastRunAt', last_run_at, 'ageSeconds', age_seconds,
      'maxAgeSeconds', max_age_seconds, 'healthy', healthy
    ) order by jobname), '[]'::jsonb)
  ) from job_health;
$$;
revoke all on function public.redemption_service_health() from public, anon, authenticated;
grant execute on function public.redemption_service_health() to service_role;