-- Raise the per-kingdom alliance-sync cap from three to four.
-- The advisory transaction lock keeps the capacity check atomic.
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

  if v_total >= 4 then
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

