-- Keep the once-per-minute scheduler request alive long enough for bounded
-- kingdom validation plus scraping and redemption fan-out to finish. Vercel's
-- handler allows 300 seconds; pg_net's previous 30-second client timeout was
-- shorter than observed healthy coordinator runs (~39 seconds).
DO $migration$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'kingshot-auto-redeem' AND active
  ORDER BY jobid
  LIMIT 1;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'Active kingshot-auto-redeem cron job was not found';
  END IF;

  PERFORM cron.alter_job(
    v_job_id,
    command := $command$
      select net.http_post(
        url:='https://kingshot-autoredeemer.vercel.app/api/kingshot-auto',
        headers:=jsonb_build_object(
          'Content-Type','application/json',
          'X-Kingshot-Scheduler-Token',
          (select token_plain from private.kingshot_scheduler_config where id=true)
        ),
        body:='{}'::jsonb,
        timeout_milliseconds:=55000
      )
    $command$
  );
END
$migration$;
