-- Transactional RPCs used by the Supabase-backed automatic alliance-sync API.
-- Neon is deliberately not modified; it remains the historical archive.

create or replace function public.register_alliance_sync_config(
  p_owner_user_id uuid,
  p_kingdom_id text,
  p_alliance_tag text,
  p_alliance_name text,
  p_roster_count integer
)
returns public.alliance_sync_config
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.alliance_sync_config;
  v_total integer;
  v_created public.alliance_sync_config;
begin
  if p_kingdom_id !~ '^[0-9]{1,10}$'
     or p_alliance_tag !~ '^[A-Za-z0-9_-]{1,20}$'
     or p_roster_count < 1 then
    raise exception 'invalid_alliance' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_kingdom_id, 0));

  select c.* into v_existing
  from public.alliance_sync_config c
  where c.kingdom_id = p_kingdom_id
    and lower(c.alliance_tag) = lower(p_alliance_tag)
  limit 1;

  if found then
    raise exception 'alliance_already_managed' using errcode = '23505';
  end if;

  select count(*)::integer into v_total
  from public.alliance_sync_config c
  where c.kingdom_id = p_kingdom_id;

  if v_total >= 3 then
    raise exception 'kingdom_alliance_limit' using errcode = '23514';
  end if;

  insert into public.alliance_sync_config
    (owner_user_id, kingdom_id, alliance_tag, alliance_name, interval_hours,
     enabled, next_run_at, last_status, last_roster_count)
  values
    (p_owner_user_id, p_kingdom_id, p_alliance_tag, left(coalesce(p_alliance_name, p_alliance_tag), 80),
     24, true, now(), 'pending', p_roster_count)
  returning * into v_created;

  return v_created;
end;
$$;

revoke all on function public.register_alliance_sync_config(uuid,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.register_alliance_sync_config(uuid,text,text,text,integer) to service_role;

create or replace function public.finish_alliance_sync_run(
  p_config_id uuid,
  p_lease_token uuid,
  p_run_id uuid,
  p_status text,
  p_roster_count integer,
  p_added_count integer,
  p_skipped_count integer,
  p_departed_count integer,
  p_error_code text,
  p_error_message text,
  p_next_run_at timestamptz,
  p_alliance_name text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.alliance_sync_config;
begin
  if p_status not in ('success','partial','error') then
    raise exception 'invalid_sync_status' using errcode = '22023';
  end if;

  update public.alliance_sync_config c
  set alliance_name = coalesce(p_alliance_name, c.alliance_name),
      last_attempt_at = now(),
      last_success_at = case when p_status in ('success','partial') then now() else c.last_success_at end,
      next_run_at = coalesce(p_next_run_at, now() + interval '1 day'),
      lease_token = null,
      lease_expires_at = null,
      consecutive_failures = case when p_status = 'error' then c.consecutive_failures + 1 when p_status = 'partial' then c.consecutive_failures + 1 else 0 end,
      last_status = case when not c.enabled then 'paused' else p_status end,
      last_error_code = p_error_code,
      last_error_message = left(p_error_message, 500),
      last_roster_count = coalesce(p_roster_count, c.last_roster_count),
      last_added_count = coalesce(p_added_count, 0),
      updated_at = now()
  where c.id = p_config_id
    and c.lease_token = p_lease_token
  returning c.* into v_config;

  if not found then
    return false;
  end if;

  update public.alliance_sync_runs r
  set finished_at = now(),
      status = p_status,
      roster_count = p_roster_count,
      added_count = coalesce(p_added_count, 0),
      skipped_count = coalesce(p_skipped_count, 0),
      departed_count = coalesce(p_departed_count, 0),
      error_code = p_error_code,
      error_message = left(p_error_message, 500)
  where r.id = p_run_id and r.config_id = p_config_id;

  return true;
end;
$$;

revoke all on function public.finish_alliance_sync_run(uuid,uuid,uuid,text,integer,integer,integer,integer,text,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.finish_alliance_sync_run(uuid,uuid,uuid,text,integer,integer,integer,integer,text,text,timestamptz,text) to service_role;
