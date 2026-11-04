-- Apply only after the native Cloudflare Worker is deployed and its API smoke tests pass.
-- This keeps Supabase pg_cron as the scheduler and preserves existing schedules/tokens.

do $$
declare
  v_job record;
  v_command text;
  v_old_origin constant text := 'https://kingshot-autoredeemer.vercel.app';
  v_new_origin constant text := 'https://app.ks-redeemer.workers.dev';
  v_announcement_job_id bigint;
  v_announcement_command text := $cmd$
    select net.http_post(
      url := 'https://app.ks-redeemer.workers.dev/api/custom-message',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select token_plain from private.kingshot_scheduler_config where id = true)
      ),
      body := '{"action":"SCHEDULE_RUN"}'::jsonb,
      timeout_milliseconds := 55000
    );
  $cmd$;
begin
  if not exists (
    select 1 from private.kingshot_scheduler_config
    where id = true and length(token_plain) between 32 and 512
  ) then
    raise exception 'The private Kingshot scheduler token is not configured.';
  end if;

  if not exists (
    select 1 from private.alliance_sync_scheduler_config
    where id = true and length(token_plain) between 32 and 512
  ) then
    raise exception 'The private alliance-sync scheduler token is not configured.';
  end if;

  for v_job in
    select jobid, jobname, command
    from cron.job
    where jobname in (
      'kingshot-auto-redeem',
      'alliance-sync-worker',
      'alliance-manual-registration-queue'
    )
  loop
    if position(v_old_origin in v_job.command) > 0 then
      v_command := replace(v_job.command, v_old_origin, v_new_origin);
    elsif position(v_new_origin in v_job.command) > 0 then
      v_command := v_job.command;
    else
      raise exception 'Unexpected command target for cron job %; refusing to overwrite it.', v_job.jobname;
    end if;

    perform cron.alter_job(v_job.jobid, command := v_command);
  end loop;

  if (
    select count(*) from cron.job
    where jobname in (
      'kingshot-auto-redeem',
      'alliance-sync-worker',
      'alliance-manual-registration-queue'
    )
  ) <> 3 then
    raise exception 'Expected all three existing worker cron jobs to be present.';
  end if;

  select jobid into v_announcement_job_id
  from cron.job
  where jobname = 'scheduled-announcement-worker'
  limit 1;

  if v_announcement_job_id is null then
    perform cron.schedule(
      'scheduled-announcement-worker',
      '*/5 * * * *',
      v_announcement_command
    );
  else
    perform cron.alter_job(
      v_announcement_job_id,
      schedule := '*/5 * * * *',
      command := v_announcement_command,
      active := true
    );
  end if;
end;
$$;
