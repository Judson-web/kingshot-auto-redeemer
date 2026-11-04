-- Keep the coordinator heartbeat lease bounded to the same five-minute window
-- used by claim_kingshot_worker_run. A terminated Worker must not block the
-- minute scheduler for thirty minutes after its final heartbeat.
create or replace function public.heartbeat_kingshot_worker_run(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $function$
begin
  update public.kingshot_worker_state
  set lock_until=now()+interval '5 minutes',
      updated_at=now()
  where id=true
    and lock_token=p_token;
  return found;
end
$function$;

-- Preserve the existing service-role-only execution boundary.
revoke all on function public.heartbeat_kingshot_worker_run(uuid) from public, anon, authenticated;
grant execute on function public.heartbeat_kingshot_worker_run(uuid) to service_role;
