-- Remove the abandoned private visitor analytics dashboard and its data stores.
do $$
declare
  job_id bigint;
begin
  if to_regclass('cron.job') is not null then
    select jobid into job_id from cron.job where jobname = 'purge-kingshot-visitor-telemetry' limit 1;
    if job_id is not null then
      perform cron.unschedule(job_id);
    end if;
  end if;
end
$$;

drop function if exists public.kingshot_visitor_analytics(integer);
drop table if exists public.kingshot_visitor_events;
drop table if exists public.kingshot_vercel_analytics_daily;
