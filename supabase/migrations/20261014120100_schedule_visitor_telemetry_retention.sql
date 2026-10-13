-- Reconcile the named job so applying this migration twice never creates duplicates.
select cron.unschedule(jobid)
from cron.job
where jobname = 'purge-kingshot-visitor-telemetry';

select cron.schedule(
  'purge-kingshot-visitor-telemetry',
  '17 3 * * *',
  $$delete from public.kingshot_visitor_events where expires_at <= now()$$
);
