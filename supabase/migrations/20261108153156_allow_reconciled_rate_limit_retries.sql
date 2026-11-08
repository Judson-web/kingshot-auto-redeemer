-- Allow a previously reconciled, explicit Kingshot rate-limit response to be retried.
create or replace function public.redemption_enqueue_batch(p_items jsonb)
returns integer language plpgsql security definer
set search_path=pg_catalog,public,redemption as $$
declare v_count integer;
begin
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 then
  raise exception 'p_items must be an array with at most 100 items';
 end if;
 insert into redemption.queue(player_id,gift_code,kingdom_id,available_at)
 select trim(x->>'player_id'),trim(x->>'gift_code'),nullif(trim(x->>'kingdom_id'),''),
        coalesce(nullif(x->>'available_at','')::timestamptz,now())
 from jsonb_array_elements(p_items) x
 where coalesce(trim(x->>'player_id'),'')<>'' and coalesce(trim(x->>'gift_code'),'')<>''
 on conflict(player_id,gift_code) do update
  set state='pending',
      kingdom_id=excluded.kingdom_id,
      available_at=case
        when redemption.queue.state='pending' then greatest(redemption.queue.available_at,excluded.available_at)
        else greatest(now(),excluded.available_at)
      end,
      lease_owner=null,
      lease_until=null,
      reconciled_at=null,
      last_status=case when redemption.queue.state='pending' then redemption.queue.last_status else null end,
      last_error=case when redemption.queue.state='pending' then redemption.queue.last_error else null end,
      result=case when redemption.queue.state='pending' then redemption.queue.result else '{}'::jsonb end,
      updated_at=now()
  where redemption.queue.state='pending'
     or (redemption.queue.state='completed'
         and redemption.queue.last_status='TIMEOUT_RETRY'
         and redemption.queue.reconciled_at is not null);
 get diagnostics v_count=row_count;
 return v_count;
end $$;
revoke all on function public.redemption_enqueue_batch(jsonb) from public,anon,authenticated;
grant execute on function public.redemption_enqueue_batch(jsonb) to service_role;
