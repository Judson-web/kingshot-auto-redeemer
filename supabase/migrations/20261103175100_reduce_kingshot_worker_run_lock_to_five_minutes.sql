-- Bound the coordinator lease to the maximum Cloudflare Worker runtime plus recovery margin.
-- A failed invocation must not block the minute scheduler for the previous 30-minute window.
create or replace function public.claim_kingshot_worker_run()
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_token uuid;
  v_now timestamptz := now();
begin
  insert into public.kingshot_worker_state(id) values(true) on conflict(id) do nothing;
  update public.kingshot_worker_state
  set lock_token=gen_random_uuid(),
      lock_until=v_now+interval '5 minutes',
      last_started_at=v_now,
      last_status='RUNNING',
      last_error=null,
      updated_at=v_now
  where id=true and (lock_until is null or lock_until<v_now)
  returning lock_token into v_token;
  if v_token is null then
    return jsonb_build_object('claimed',false);
  end if;
  return jsonb_build_object('claimed',true,'token',v_token::text,'started_at',v_now);
end
$function$;

revoke all on function public.claim_kingshot_worker_run() from public, anon, authenticated;
grant execute on function public.claim_kingshot_worker_run() to service_role;
