-- Durable recovery for redemption outcomes that cannot be written to redemption history.
-- An intent is stored before calling the upstream redemption endpoint. If the result
-- is received but the history write fails, pending_record can safely replay only the
-- database write; it never repeats the game redemption request.
create table if not exists public.kingshot_redemption_recovery_queue (
  id bigserial primary key,
  player_id text not null,
  gift_code text not null,
  state text not null default 'in_flight' check (state in ('in_flight','pending_record','resolved','needs_review')),
  status text,
  err_code integer,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  unique (player_id, gift_code)
);
create index if not exists kingshot_redemption_recovery_pending_idx
  on public.kingshot_redemption_recovery_queue(state, updated_at)
  where state in ('pending_record','needs_review','in_flight');

create or replace function public.begin_kingshot_redemption_recovery(p_player_id text,p_code text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_state text;
begin
 insert into public.kingshot_redemption_recovery_queue(player_id,gift_code,state,status,err_code,message,attempts,last_error,updated_at)
 values(trim(p_player_id),trim(p_code),'in_flight',null,null,null,0,null,now())
 on conflict(player_id,gift_code) do update
   set state='in_flight',status=null,err_code=null,message=null,last_error=null,updated_at=now()
   where public.kingshot_redemption_recovery_queue.state='resolved';
 select state into v_state from public.kingshot_redemption_recovery_queue
  where player_id=trim(p_player_id) and upper(gift_code)=upper(trim(p_code))
  for update;
 return v_state='in_flight';
end $$;

create or replace function public.complete_kingshot_redemption_recovery(
 p_player_id text,p_code text,p_status text,p_err_code integer default null,p_message text default null
) returns boolean language plpgsql security definer set search_path=public as $$
begin
 update public.kingshot_redemption_recovery_queue
 set state='pending_record',status=upper(trim(p_status)),err_code=p_err_code,
     message=left(coalesce(p_message,''),240),updated_at=now(),last_error=null
 where player_id=trim(p_player_id) and upper(gift_code)=upper(trim(p_code))
   and state in ('in_flight','pending_record');
 return found;
end $$;

create or replace function public.list_kingshot_redemption_recovery_queue(p_limit integer default 50)
returns setof public.kingshot_redemption_recovery_queue
language sql security definer set search_path=public as $$
 select * from public.kingshot_redemption_recovery_queue
 where state='pending_record' order by updated_at asc limit greatest(1,least(coalesce(p_limit,50),200));
$$;

create or replace function public.finish_kingshot_redemption_recovery(p_id bigint,p_ok boolean,p_error text default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update public.kingshot_redemption_recovery_queue
 set state=case when p_ok then 'resolved' else 'pending_record' end,
     attempts=attempts+1, last_error=case when p_ok then null else left(coalesce(p_error,'Recovery write failed'),240) end,
     updated_at=now()
 where id=p_id and state='pending_record';
 return found;
end $$;

create or replace function public.resolve_kingshot_redemption_recovery(p_player_id text,p_code text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update public.kingshot_redemption_recovery_queue
 set state='resolved',attempts=attempts+1,last_error=null,updated_at=now()
 where player_id=trim(p_player_id) and upper(gift_code)=upper(trim(p_code)) and state in ('pending_record','in_flight');
 return found;
end $$;

create or replace function public.mark_kingshot_redemption_recovery_uncertain(p_player_id text,p_code text,p_error text default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update public.kingshot_redemption_recovery_queue
 set state='needs_review',last_error=left(coalesce(p_error,'Upstream outcome unknown; do not replay automatically'),240),updated_at=now()
 where player_id=trim(p_player_id) and upper(gift_code)=upper(trim(p_code)) and state='in_flight';
 return found;
end $$;

revoke all on public.kingshot_redemption_recovery_queue from public,anon,authenticated;
revoke all on function public.begin_kingshot_redemption_recovery(text,text) from public,anon,authenticated;
revoke all on function public.complete_kingshot_redemption_recovery(text,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.list_kingshot_redemption_recovery_queue(integer) from public,anon,authenticated;
revoke all on function public.finish_kingshot_redemption_recovery(bigint,boolean,text) from public,anon,authenticated;
revoke all on function public.resolve_kingshot_redemption_recovery(text,text) from public,anon,authenticated;
revoke all on function public.mark_kingshot_redemption_recovery_uncertain(text,text,text) from public,anon,authenticated;
grant execute on function public.begin_kingshot_redemption_recovery(text,text) to service_role;
grant execute on function public.complete_kingshot_redemption_recovery(text,text,text,integer,text) to service_role;
grant execute on function public.list_kingshot_redemption_recovery_queue(integer) to service_role;
grant execute on function public.finish_kingshot_redemption_recovery(bigint,boolean,text) to service_role;
grant execute on function public.resolve_kingshot_redemption_recovery(text,text) to service_role;
grant execute on function public.mark_kingshot_redemption_recovery_uncertain(text,text,text) to service_role;