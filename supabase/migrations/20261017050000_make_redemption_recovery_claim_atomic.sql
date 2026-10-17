-- A recovery row authorizes at most one upstream redemption request.
-- Existing in-flight/pending/uncertain rows return false; only a new row or a
-- resolved row reopened by this transaction can return true.
create or replace function public.begin_kingshot_redemption_recovery(p_player_id text,p_code text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_id bigint;
begin
 if nullif(trim(p_player_id),'') is null or nullif(trim(p_code),'') is null then
   raise exception 'Player ID and gift code are required';
 end if;
 insert into public.kingshot_redemption_recovery_queue(player_id,gift_code,state,status,err_code,message,attempts,last_error,updated_at)
 values(trim(p_player_id),trim(p_code),'in_flight',null,null,null,0,null,now())
 on conflict(player_id,gift_code) do update
   set state='in_flight',status=null,err_code=null,message=null,last_error=null,updated_at=now()
   where public.kingshot_redemption_recovery_queue.state='resolved'
 returning id into v_id;
 return v_id is not null;
end $$;
revoke all on function public.begin_kingshot_redemption_recovery(text,text) from public,anon,authenticated;
grant execute on function public.begin_kingshot_redemption_recovery(text,text) to service_role;