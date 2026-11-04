-- Recover abandoned automatic Alliance Registration runs without touching live leases.
-- A run is stale only after ten minutes AND when its config has no unexpired lease.
create or replace function public.recover_stale_alliance_sync_runs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recovered integer := 0;
begin
  with stale as (
    select r.id, r.config_id
    from public.alliance_sync_runs r
    join public.alliance_sync_config c on c.id = r.config_id
    where r.status = 'running'
      and r.started_at < now() - interval '10 minutes'
      and (c.lease_token is null or c.lease_expires_at is null or c.lease_expires_at <= now())
    for update of r skip locked
  ), closed as (
    update public.alliance_sync_runs r
    set status = 'error',
        finished_at = now(),
        error_code = 'worker_lease_expired',
        error_message = 'Worker lease expired before the run completed; durable player outcomes were retained for retry.'
    from stale s
    where r.id = s.id
    returning r.config_id
  )
  select count(*)::integer into v_recovered from closed;

  update public.alliance_sync_config c
  set lease_token = null,
      lease_expires_at = null,
      last_status = case when c.enabled then 'pending' else 'paused' end,
      last_error_code = case when c.enabled then 'worker_lease_expired' else c.last_error_code end,
      last_error_message = case when c.enabled then 'Previous worker lease expired; pending work is eligible for retry.' else c.last_error_message end,
      next_run_at = case when c.enabled then least(c.next_run_at, now()) else c.next_run_at end,
      updated_at = now()
  where c.last_status = 'running'
    and (c.lease_token is null or c.lease_expires_at is null or c.lease_expires_at <= now())
    and exists (
      select 1 from public.alliance_sync_runs r
      where r.config_id = c.id
        and r.status = 'error'
        and r.error_code = 'worker_lease_expired'
        and r.finished_at >= now() - interval '1 minute'
    );

  return v_recovered;
end;
$$;

revoke all on function public.recover_stale_alliance_sync_runs() from public, anon, authenticated;
grant execute on function public.recover_stale_alliance_sync_runs() to service_role;
