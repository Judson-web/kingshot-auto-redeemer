-- Track the lifetime of the current redemption attempt independently from
-- row creation time and retry touches, so repeated failed result writes stay visible.
alter table public.kingshot_redemption_recovery_queue
  add column if not exists attempt_started_at timestamptz not null default now();

create index if not exists kingshot_redemption_recovery_attempt_age_idx
  on public.kingshot_redemption_recovery_queue(state,attempt_started_at)
  where state in ('pending_record','needs_review','in_flight');

-- Preserve the atomic claim contract: true means this call inserted a new
-- intent or reopened a resolved one. Existing unresolved attempts return false.
create or replace function public.begin_kingshot_redemption_recovery(p_player_id text,p_code text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_id bigint;
begin
 if nullif(trim(p_player_id),'') is null or nullif(trim(p_code),'') is null then
   raise exception 'Player ID and gift code are required';
 end if;

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
   where public.kingshot_redemption_recovery_queue.state='resolved'
 returning id into v_id;

 return v_id is not null;
end $$;

revoke all on function public.begin_kingshot_redemption_recovery(text,text) from public,anon,authenticated;
grant execute on function public.begin_kingshot_redemption_recovery(text,text) to service_role;
