-- Dedicated execution plane in the secondary Supabase project.
-- Primary Supabase remains authoritative for players, gift codes and history.
create extension if not exists pgmq;
create schema if not exists redemption;

create table if not exists redemption.queue (
  id bigint generated always as identity primary key,
  player_id text not null,
  gift_code text not null,
  kingdom_id text,
  state text not null default 'pending' check (state in ('pending','leased','completed','uncertain','dead')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  last_status text,
  last_error text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(player_id,gift_code)
);
create index if not exists redemption_queue_claim_idx on redemption.queue(state,available_at,lease_until,id);
create index if not exists redemption_queue_player_idx on redemption.queue(player_id,gift_code);

create table if not exists redemption.source_pacing (
  source_key text primary key,
  next_request_at timestamptz not null default now(),
  cooldown_until timestamptz not null default now(),
  spacing_ms integer not null default 200 check (spacing_ms between 100 and 5000),
  last_status integer,
  updated_at timestamptz not null default now()
);
create table if not exists redemption.journal (
  id bigint generated always as identity primary key,
  player_id text not null,
  gift_code text not null,
  attempt_no integer not null,
  state text not null check (state in ('in_flight','recorded','uncertain','cancelled')),
  upstream_status text,
  err_code integer,
  message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(player_id,gift_code,attempt_no)
);
create index if not exists redemption_journal_open_idx on redemption.journal(state,started_at) where state in ('in_flight','uncertain');

create or replace function public.redemption_enqueue_batch(p_items jsonb)
returns integer language plpgsql security definer set search_path=pg_catalog,public,redemption as $$
declare v_count integer;
begin
 if jsonb_typeof(p_items) <> 'array' then raise exception 'p_items must be a JSON array'; end if;
 insert into redemption.queue(player_id,gift_code,kingdom_id)
 select trim(x->>'player_id'),upper(trim(x->>'gift_code')),nullif(trim(x->>'kingdom_id'),'')
 from jsonb_array_elements(p_items) x
 where coalesce(trim(x->>'player_id'),'') <> '' and coalesce(trim(x->>'gift_code'),'') <> ''
 on conflict(player_id,gift_code) do update set kingdom_id=excluded.kingdom_id,updated_at=now()
 where redemption.queue.state in ('pending','dead');
 get diagnostics v_count = row_count;
 return v_count;
end $$;

create or replace function public.redemption_claim_batch(
 p_worker text,p_shard integer default 0,p_shards integer default 1,p_limit integer default 25,p_lease_seconds integer default 90
) returns setof redemption.queue language plpgsql security definer set search_path=pg_catalog,public,redemption as $$
begin
 if coalesce(trim(p_worker),'')='' or p_shards<1 or p_shard<0 or p_shard>=p_shards then raise exception 'Invalid worker or shard'; end if;
 return query
 with picked as (
  select q.id from redemption.queue q
  where ((q.state='pending' and q.available_at<=now()) or (q.state='leased' and q.lease_until<now()))
   and mod(hashtextextended(q.player_id,0) & 9223372036854775807,p_shards)=p_shard
  order by q.available_at,q.id for update skip locked
  limit greatest(1,least(coalesce(p_limit,25),100))
 ), claimed as (
  update redemption.queue q set state='leased',lease_owner=p_worker,
   lease_until=now()+make_interval(secs=>greatest(15,least(coalesce(p_lease_seconds,90),600))),
   attempts=q.attempts+1,updated_at=now()
  from picked where q.id=picked.id returning q.*
 ) select * from claimed;
end $$;

create or replace function public.redemption_complete_batch(p_results jsonb)
returns integer language plpgsql security definer set search_path=pg_catalog,public,redemption as $$
declare v_count integer;
begin
 if jsonb_typeof(p_results)<>'array' then raise exception 'p_results must be a JSON array'; end if;
 update redemption.queue q set
  state=case when coalesce(x->>'state','completed') in ('completed','uncertain','dead') then x->>'state' else 'pending' end,
  last_status=left(x->>'status',64),last_error=left(x->>'error',500),
  result=coalesce(x->'result','{}'::jsonb),
  available_at=case when coalesce(x->>'state','')='pending' then now()+make_interval(secs=>greatest(1,least(coalesce((x->>'retry_after_seconds')::int,30),3600))) else q.available_at end,
  lease_owner=null,lease_until=null,updated_at=now()
 from jsonb_array_elements(p_results) x
 where q.id=(x->>'id')::bigint and q.state='leased' and q.lease_owner=x->>'worker';
 get diagnostics v_count=row_count; return v_count;
end $$;

create or replace function public.redemption_reserve_request(p_source text default 'century-gift-code',p_spacing_ms integer default 200)
returns timestamptz language plpgsql security definer set search_path=pg_catalog,public,redemption as $$
declare v_start timestamptz;
begin
 insert into redemption.source_pacing(source_key,spacing_ms) values(p_source,greatest(100,least(coalesce(p_spacing_ms,200),5000))) on conflict(source_key) do nothing;
 perform pg_advisory_xact_lock(hashtextextended(p_source,0));
 select greatest(now(),next_request_at) into v_start from redemption.source_pacing where source_key=p_source for update;
 if exists(select 1 from redemption.source_pacing where source_key=p_source and cooldown_until>now()) then return null; end if;
 update redemption.source_pacing set next_request_at=v_start+make_interval(secs=>greatest(100,least(coalesce(p_spacing_ms,200),5000))/1000.0),
  spacing_ms=greatest(100,least(coalesce(p_spacing_ms,200),5000)),updated_at=now() where source_key=p_source;
 return v_start;
end $$;

create or replace function public.redemption_set_cooldown(p_source text,p_seconds integer,p_http_status integer default null)
returns timestamptz language sql security definer set search_path=pg_catalog,public,redemption as $$
 insert into redemption.source_pacing(source_key,cooldown_until,last_status,updated_at)
 values(p_source,now()+make_interval(secs=>greatest(30,least(coalesce(p_seconds,30),3600))),p_http_status,now())
 on conflict(source_key) do update set cooldown_until=greatest(redemption.source_pacing.cooldown_until,excluded.cooldown_until),
 last_status=excluded.last_status,updated_at=now() returning cooldown_until
$$;

revoke all on schema redemption from public,anon,authenticated;
revoke all on all tables in schema redemption from public,anon,authenticated;
grant usage on schema redemption to service_role;
grant select,insert,update,delete on all tables in schema redemption to service_role;
grant usage,select on all sequences in schema redemption to service_role;
revoke all on function public.redemption_enqueue_batch(jsonb) from public,anon,authenticated;
revoke all on function public.redemption_claim_batch(text,integer,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.redemption_complete_batch(jsonb) from public,anon,authenticated;
revoke all on function public.redemption_reserve_request(text,integer) from public,anon,authenticated;
revoke all on function public.redemption_set_cooldown(text,integer,integer) from public,anon,authenticated;
grant execute on function public.redemption_enqueue_batch(jsonb) to service_role;
grant execute on function public.redemption_claim_batch(text,integer,integer,integer,integer) to service_role;
grant execute on function public.redemption_complete_batch(jsonb) to service_role;
grant execute on function public.redemption_reserve_request(text,integer) to service_role;
grant execute on function public.redemption_set_cooldown(text,integer,integer) to service_role;
