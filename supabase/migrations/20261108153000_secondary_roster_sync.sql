-- Secondary Supabase: mirror the authoritative primary roster using existing player IDs.
-- The mirror is execution metadata only; it does not create player identities or own registrations.
alter table redemption.queue enable row level security;
alter table redemption.source_pacing enable row level security;
alter table redemption.journal enable row level security;
create table if not exists redemption.roster (
 player_id text primary key,
 kingdom_id text,
 enabled boolean not null default true,
 stale boolean not null default false,
 source_updated_at timestamptz,
 last_synced_at timestamptz not null default now()
);
create index if not exists redemption_roster_enabled_idx on redemption.roster(enabled,stale,player_id);
alter table redemption.roster enable row level security;
revoke all on redemption.roster from public,anon,authenticated;
grant select,insert,update,delete on redemption.roster to service_role;
create or replace function public.redemption_sync_roster(p_players jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,redemption
as $$
declare v_seen integer; v_inserted integer; v_updated integer;
begin
 if jsonb_typeof(p_players) <> 'array' then raise exception 'p_players must be a JSON array'; end if;
 if jsonb_array_length(p_players) > 10000 then raise exception 'Roster sync exceeds 10000 players'; end if;
 with incoming as (
  select distinct on (trim(x->>'player_id'))
   trim(x->>'player_id') as player_id,
   nullif(trim(x->>'kingdom_id'),'') as kingdom_id,
   coalesce((x->>'enabled')::boolean,true) as enabled,
   coalesce((x->>'stale')::boolean,false) as stale,
   case when nullif(x->>'updated_at','') is not null then (x->>'updated_at')::timestamptz else null end as source_updated_at
  from jsonb_array_elements(p_players) x
  where coalesce(trim(x->>'player_id'),'') <> ''
  order by trim(x->>'player_id')
 ), upserted as (
  insert into redemption.roster(player_id,kingdom_id,enabled,stale,source_updated_at,last_synced_at)
  select player_id,kingdom_id,enabled,stale,source_updated_at,now() from incoming
  on conflict(player_id) do update set kingdom_id=excluded.kingdom_id,enabled=excluded.enabled,stale=excluded.stale,
   source_updated_at=excluded.source_updated_at,last_synced_at=now()
  returning (xmax=0) as inserted
 )
 select count(*),count(*) filter(where inserted),count(*) filter(where not inserted)
 into v_seen,v_inserted,v_updated from upserted;
 return jsonb_build_object('received',v_seen,'inserted',v_inserted,'updated',v_updated,'refreshed_at',now());
end $$;
revoke all on function public.redemption_sync_roster(jsonb) from public,anon,authenticated;
grant execute on function public.redemption_sync_roster(jsonb) to service_role;
