-- Keep the pg_cron trigger timeout above the normal production worker runtime.
-- The worker commonly takes 6-8 seconds, so the previous 5s pg_net timeout
-- produced false scheduler timeouts even when Vercel completed the cycle.
do $$
begin
  if exists (select 1 from cron.job where jobid = 2) then
    perform cron.alter_job(
      job_id := 2,
      command := replace(
        (select command from cron.job where jobid = 2),
        'timeout_milliseconds:=5000',
        'timeout_milliseconds:=15000'
      )
    );
  end if;
end $$;
