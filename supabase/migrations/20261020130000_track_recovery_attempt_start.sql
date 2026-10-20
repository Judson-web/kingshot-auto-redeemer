-- Track the lifetime of the current redemption attempt independently from
-- row creation time and retry touches, so repeated failed result writes stay visible.
alter table public.kingshot_redemption_recovery_queue
  add column if not exists attempt_started_at timestamptz not null default now();

create index if not exists kingshot_redemption_recovery_attempt_age_idx
  on public.kingshot_redemption_recovery_queue(state,attempt_started_at)
  where state in ('pending_record','needs_review','in_flight');

create or replace function public.begin_kingshot_redemption_recovery(p_player_id text,p_code text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_state text;
begin
 insert into public.kingshot_redemption_recovery_queue(
   player_id,gift_code,state,status,err_code,message,attempts,last_error,attempt_started_at,updated_at
 )
 values(trim(p_player_id),trim(p_code),'in_flight',null,null,null,0,null,now(),now())
 on conflict(player_id,gift_code) do update
   set state='in_flight',
       status=null,
       err_code=null,
       message=null,
       attempts=0,
       last_error=null,
       attempt_started_at=now(),
       updated_at=now()
   where public.kingshot_redemption_recovery_queue.state='resolved';

 select state into v_state
 from public.kingshot_redemption_recovery_queue
 where player_id=trim(p_player_id) and upper(gift_code)=upper(trim(p_code))
 for update;

 return v_state='in_flight';
end $$;

revoke all on function public.begin_kingshot_redemption_recovery(text,text) from public,anon,authenticated;
grant execute on function public.begin_kingshot_redemption_recovery(text,text) to service_role;
