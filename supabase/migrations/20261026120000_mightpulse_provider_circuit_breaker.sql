-- Provider-wide circuit breaker for MightPulse, shared by all serverless instances.
-- The table is writable only by tightly scoped SECURITY DEFINER RPCs.
begin;

create schema if not exists private;

create table if not exists private.mightpulse_provider_circuit_breaker (
  singleton boolean primary key default true check (singleton),
  failure_window_started_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  open_until timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

insert into private.mightpulse_provider_circuit_breaker (singleton)
values (true)
on conflict (singleton) do nothing;

alter table private.mightpulse_provider_circuit_breaker enable row level security;
revoke all on table private.mightpulse_provider_circuit_breaker from public, anon, authenticated, service_role;

create or replace function public.check_mightpulse_provider_circuit_breaker()
returns jsonb
language plpgsql
security definer
set search_path = private, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_state private.mightpulse_provider_circuit_breaker%rowtype;
begin
  select * into v_state
  from private.mightpulse_provider_circuit_breaker
  where singleton = true;

  if not found then
    return jsonb_build_object('open', false, 'failureCount', 0, 'retryAfterMs', 0);
  end if;

  if v_state.open_until is not null and v_state.open_until > v_now then
    return jsonb_build_object(
      'open', true,
      'failureCount', v_state.failure_count,
      'retryAfterMs', greatest(1, ceil(extract(epoch from (v_state.open_until - v_now)) * 1000)::bigint)
    );
  end if;

  if v_state.open_until is not null and v_state.open_until <= v_now then
    update private.mightpulse_provider_circuit_breaker
    set failure_window_started_at = null,
        failure_count = 0,
        open_until = null,
        updated_at = v_now
    where singleton = true
      and open_until <= v_now;
    return jsonb_build_object('open', false, 'failureCount', 0, 'retryAfterMs', 0);
  end if;

  return jsonb_build_object(
    'open', false,
    'failureCount', v_state.failure_count,
    'retryAfterMs', 0
  );
end
$function$;

create or replace function public.record_mightpulse_provider_block_sweep()
returns jsonb
language plpgsql
security definer
set search_path = private, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_state private.mightpulse_provider_circuit_breaker%rowtype;
  v_window_started_at timestamptz;
  v_failure_count integer;
  v_open_until timestamptz := null;
begin
  select * into v_state
  from private.mightpulse_provider_circuit_breaker
  where singleton = true
  for update;

  if not found then
    insert into private.mightpulse_provider_circuit_breaker (singleton)
    values (true)
    on conflict (singleton) do nothing;

    select * into v_state
    from private.mightpulse_provider_circuit_breaker
    where singleton = true
    for update;
  end if;

  if v_state.open_until is not null and v_state.open_until > v_now then
    return jsonb_build_object(
      'open', true,
      'failureCount', v_state.failure_count,
      'retryAfterMs', greatest(1, ceil(extract(epoch from (v_state.open_until - v_now)) * 1000)::bigint)
    );
  end if;

  if v_state.failure_window_started_at is null
     or v_state.failure_window_started_at < v_now - interval '60 seconds'
     or (v_state.open_until is not null and v_state.open_until <= v_now) then
    v_window_started_at := v_now;
    v_failure_count := 1;
  else
    v_window_started_at := v_state.failure_window_started_at;
    v_failure_count := v_state.failure_count + 1;
  end if;

  if v_failure_count >= 3 then
    v_open_until := v_now + interval '120 seconds';
  end if;

  update private.mightpulse_provider_circuit_breaker
  set failure_window_started_at = v_window_started_at,
      failure_count = v_failure_count,
      open_until = v_open_until,
      updated_at = v_now
  where singleton = true;

  return jsonb_build_object(
    'open', v_open_until is not null,
    'failureCount', v_failure_count,
    'retryAfterMs', case
      when v_open_until is not null
        then greatest(1, ceil(extract(epoch from (v_open_until - v_now)) * 1000)::bigint)
      else 0
    end
  );
end
$function$;

create or replace function public.reset_mightpulse_provider_circuit_breaker()
returns jsonb
language plpgsql
security definer
set search_path = private, pg_temp
as $function$
begin
  update private.mightpulse_provider_circuit_breaker
  set failure_window_started_at = null,
      failure_count = 0,
      open_until = null,
      updated_at = clock_timestamp()
  where singleton = true;

  return jsonb_build_object('reset', true);
end
$function$;

revoke all on function public.check_mightpulse_provider_circuit_breaker() from public, anon, authenticated;
revoke all on function public.record_mightpulse_provider_block_sweep() from public, anon, authenticated;
revoke all on function public.reset_mightpulse_provider_circuit_breaker() from public, anon, authenticated;
grant execute on function public.check_mightpulse_provider_circuit_breaker() to service_role;
grant execute on function public.record_mightpulse_provider_block_sweep() to service_role;
grant execute on function public.reset_mightpulse_provider_circuit_breaker() to service_role;

commit;
