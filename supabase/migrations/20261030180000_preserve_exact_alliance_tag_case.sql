-- Alliance tags are case-sensitive identifiers. "ONE" and "One" are distinct.
drop index if exists public.alliance_sync_one_config_per_alliance_idx;

create unique index alliance_sync_one_config_per_alliance_idx
  on public.alliance_sync_config (kingdom_id, alliance_tag);

create or replace function public.register_alliance_sync_config(
  p_owner_user_id uuid,
  p_kingdom_id text,
  p_alliance_tag text,
  p_alliance_name text,
  p_roster_count integer
) returns public.alliance_sync_config
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_total integer;
  v_created public.alliance_sync_config;
begin
  if p_kingdom_id !~ '^[0-9]{1,10}$'
     or p_alliance_tag !~ '^[A-Za-z0-9_-]{1,20}$'
     or p_roster_count < 1 then
    raise exception 'invalid_alliance' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_kingdom_id, 0));

  if exists (
    select 1 from public.alliance_sync_config c
    where c.kingdom_id = p_kingdom_id
      and c.alliance_tag = p_alliance_tag
  ) then
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
    (p_owner_user_id, p_kingdom_id, p_alliance_tag,
     left(coalesce(p_alliance_name, p_alliance_tag), 80),
     24, true, now(), 'pending', p_roster_count)
  returning * into v_created;

  return v_created;
end;
$function$;
