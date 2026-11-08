-- Consolidate four simultaneous pg_cron Edge invocations into one bounded worker.
-- Apply only to the secondary execution/Discord Supabase project.
-- The Edge worker itself enforces a 100-second soft deadline and a 50-item cap.

do $$
begin
  if exists (select 1 from cron.job where jobid = 12) then
    perform cron.unschedule(12);
  end if;
  if exists (select 1 from cron.job where jobid = 13) then
    perform cron.unschedule(13);
  end if;
  if exists (select 1 from cron.job where jobid = 14) then
    perform cron.unschedule(14);
  end if;
end
$$;

select cron.alter_job(
  11,
  schedule := '* * * * *',
  command := $cmd$
    select extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','5000');
    select extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','120000');
    select extensions.http(
      ROW(
        'POST'::extensions.http_method,
        'https://sfntksruilzncahytxve.supabase.co/functions/v1/redemption-worker',
        ARRAY[extensions.http_header('content-type','application/json')]::extensions.http_header[],
        'application/json',
        jsonb_build_object(
          'secret',
          (select decrypted_secret
             from vault.decrypted_secrets
            where name='secondary_redemption_sync_secret'
            order by created_at desc
            limit 1),
          'limit',50,
          'slot',0
        )::text
      )::extensions.http_request
    );
  $cmd$,
  active := true
);
