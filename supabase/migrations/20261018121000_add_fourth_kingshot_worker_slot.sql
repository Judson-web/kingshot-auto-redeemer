-- Add a fourth durable shard without changing existing worker rows.
begin;

alter table public.kingshot_worker_slots
  drop constraint if exists kingshot_worker_slots_slot_check;

alter table public.kingshot_worker_slots
  add constraint kingshot_worker_slots_slot_check
  check (slot >= 0 and slot < 4);

insert into public.kingshot_worker_slots(slot)
values (3)
on conflict (slot) do nothing;

create or replace function public.claim_kingshot_worker_slot(p_slot integer)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_token uuid;
  v_now timestamptz := now();
begin
  if p_slot is null or p_slot < 0 or p_slot >= 4 then
    return jsonb_build_object('claimed',false,'reason','INVALID_SLOT');
  end if;

  update public.kingshot_worker_slots
  set lock_token=gen_random_uuid(),
      lock_until=v_now+interval '6 minutes',
      last_started_at=v_now,
      last_status='RUNNING',
      last_error=null,
      updated_at=v_now
  where slot=p_slot
    and (lock_until is null or lock_until < v_now)
  returning lock_token into v_token;

  if v_token is null then
    return jsonb_build_object('claimed',false,'reason','SLOT_ALREADY_RUNNING');
  end if;

  return jsonb_build_object(
    'claimed',true,
    'slot',p_slot,
    'token',v_token::text,
    'started_at',v_now
  );
end
$function$;

revoke all on function public.claim_kingshot_worker_slot(integer) from public, anon, authenticated;
grant execute on function public.claim_kingshot_worker_slot(integer) to service_role;

commit;
