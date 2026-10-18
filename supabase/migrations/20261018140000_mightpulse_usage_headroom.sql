-- Cache MightPulse's uncounted usage endpoint in shared state so the
-- application budget also accounts for use of the API key outside this app.
begin;

alter table public.mightpulse_api_request_budget
  add column if not exists usage_observed_at timestamptz,
  add column if not exists usage_minute_remaining integer,
  add column if not exists usage_minute_resets_at timestamptz,
  add column if not exists usage_day_remaining integer,
  add column if not exists usage_day_resets_at timestamptz;

create or replace function public.record_mightpulse_api_usage(
  p_observed_at timestamptz,
  p_minute_remaining integer,
  p_minute_resets_at timestamptz,
  p_day_remaining integer,
  p_day_resets_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_existing timestamptz;
begin
  if p_observed_at is null
     or p_minute_remaining is null or p_minute_remaining < 0
     or p_minute_resets_at is null
     or p_day_remaining is null or p_day_remaining < 0
     or p_day_resets_at is null then
    return jsonb_build_object('recorded', false, 'reason', 'INVALID_USAGE_SNAPSHOT');
  end if;

  select usage_observed_at into v_existing
  from public.mightpulse_api_request_budget
  where budget_id = true
  for update;

  if not found then
    return jsonb_build_object('recorded', false, 'reason', 'BUDGET_ROW_MISSING');
  end if;

  -- A slower response from an older concurrent preflight must not replace a newer snapshot.
  if v_existing is not null and p_observed_at <= v_existing then
    return jsonb_build_object('recorded', false, 'reason', 'STALE_USAGE_SNAPSHOT');
  end if;

  update public.mightpulse_api_request_budget
  set usage_observed_at = p_observed_at,
      usage_minute_remaining = p_minute_remaining,
      usage_minute_resets_at = p_minute_resets_at,
      usage_day_remaining = p_day_remaining,
      usage_day_resets_at = p_day_resets_at,
      updated_at = v_now
  where budget_id = true;

  return jsonb_build_object('recorded', true);
end
$function$;

revoke all on function public.record_mightpulse_api_usage(timestamptz, integer, timestamptz, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.record_mightpulse_api_usage(timestamptz, integer, timestamptz, integer, timestamptz) to service_role;

create or replace function public.claim_mightpulse_api_request(
  p_mark_cooldown_seconds integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_budget public.mightpulse_api_request_budget%rowtype;
  v_timestamps timestamptz[];
  v_cooldown_until timestamptz;
  v_oldest timestamptz;
  v_minute_count integer;
  v_day_count integer;
  v_usage_minute_count integer := 0;
  v_usage_day_count integer := 0;
  v_effective_minute_remaining integer;
  v_effective_day_remaining integer;
  v_retry_after_ms bigint;
  v_cooldown_seconds integer;
begin
  select * into v_budget
  from public.mightpulse_api_request_budget
  where budget_id = true
  for update;

  if not found then
    insert into public.mightpulse_api_request_budget (budget_id)
    values (true)
    on conflict (budget_id) do nothing;

    select * into v_budget
    from public.mightpulse_api_request_budget
    where budget_id = true
    for update;
  end if;

  select coalesce(array_agg(entry.request_at order by entry.request_at), '{}'::timestamptz[])
    into v_timestamps
  from unnest(coalesce(v_budget.request_timestamps, '{}'::timestamptz[])) as entry(request_at)
  where entry.request_at > v_now - interval '24 hours';

  v_cooldown_until := case
    when v_budget.cooldown_until > v_now then v_budget.cooldown_until
    else null
  end;

  update public.mightpulse_api_request_budget
  set request_timestamps = v_timestamps,
      cooldown_until = v_cooldown_until,
      updated_at = v_now
  where budget_id = true;

  if coalesce(p_mark_cooldown_seconds, 0) > 0 then
    v_cooldown_seconds := least(90, greatest(15, p_mark_cooldown_seconds));
    v_cooldown_until := greatest(
      coalesce(v_cooldown_until, 'epoch'::timestamptz),
      v_now + make_interval(secs => v_cooldown_seconds)
    );
    update public.mightpulse_api_request_budget
    set cooldown_until = v_cooldown_until,
        updated_at = v_now
    where budget_id = true;

    return jsonb_build_object(
      'claimed', false,
      'reason', 'UPSTREAM_RATE_LIMIT',
      'retry_after_ms', greatest(1, ceil(extract(epoch from (v_cooldown_until - v_now)) * 1000)::bigint)
    );
  end if;

  if v_cooldown_until is not null then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'RATE_LIMIT_COOLDOWN',
      'retry_after_ms', greatest(1, ceil(extract(epoch from (v_cooldown_until - v_now)) * 1000)::bigint)
    );
  end if;

  select count(*)::integer into v_minute_count
  from unnest(v_timestamps) as entry(request_at)
  where entry.request_at > v_now - interval '60 seconds';

  v_day_count := cardinality(v_timestamps);

  -- Respect actual upstream remaining allowance as well as the local cross-instance limits.
  if v_budget.usage_observed_at is not null
     and v_budget.usage_minute_resets_at > v_now then
    select count(*)::integer into v_usage_minute_count
    from unnest(v_timestamps) as entry(request_at)
    where entry.request_at > v_budget.usage_observed_at
      and entry.request_at < v_budget.usage_minute_resets_at;

    v_effective_minute_remaining := greatest(0, v_budget.usage_minute_remaining - v_usage_minute_count);
    if v_effective_minute_remaining <= 0 then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'UPSTREAM_MINUTE_BUDGET_EXHAUSTED',
        'retry_after_ms', greatest(1, ceil(extract(epoch from (v_budget.usage_minute_resets_at - v_now)) * 1000)::bigint),
        'remaining_minute', 0,
        'remaining_day', greatest(0, 4500 - v_day_count)
      );
    end if;
  else
    v_effective_minute_remaining := null;
  end if;

  if v_budget.usage_observed_at is not null
     and v_budget.usage_day_resets_at > v_now then
    select count(*)::integer into v_usage_day_count
    from unnest(v_timestamps) as entry(request_at)
    where entry.request_at > v_budget.usage_observed_at
      and entry.request_at < v_budget.usage_day_resets_at;

    v_effective_day_remaining := greatest(0, v_budget.usage_day_remaining - v_usage_day_count);
    if v_effective_day_remaining <= 0 then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'UPSTREAM_DAY_BUDGET_EXHAUSTED',
        'retry_after_ms', greatest(1, ceil(extract(epoch from (v_budget.usage_day_resets_at - v_now)) * 1000)::bigint),
        'remaining_minute', greatest(0, 45 - v_minute_count),
        'remaining_day', 0
      );
    end if;
  else
    v_effective_day_remaining := null;
  end if;

  if v_minute_count >= 45 then
    select min(entry.request_at) into v_oldest
    from unnest(v_timestamps) as entry(request_at)
    where entry.request_at > v_now - interval '60 seconds';

    v_retry_after_ms := greatest(1, ceil(extract(epoch from ((v_oldest + interval '60 seconds') - v_now)) * 1000)::bigint);
    return jsonb_build_object(
      'claimed', false,
      'reason', 'MINUTE_BUDGET_EXHAUSTED',
      'retry_after_ms', v_retry_after_ms,
      'remaining_minute', 0,
      'remaining_day', greatest(0, 4500 - v_day_count)
    );
  end if;

  if v_day_count >= 4500 then
    select min(entry.request_at) into v_oldest
    from unnest(v_timestamps) as entry(request_at);

    v_retry_after_ms := greatest(1, ceil(extract(epoch from ((v_oldest + interval '24 hours') - v_now)) * 1000)::bigint);
    return jsonb_build_object(
      'claimed', false,
      'reason', 'DAY_BUDGET_EXHAUSTED',
      'retry_after_ms', v_retry_after_ms,
      'remaining_minute', greatest(0, 45 - v_minute_count),
      'remaining_day', 0
    );
  end if;

  v_timestamps := array_append(v_timestamps, v_now);
  update public.mightpulse_api_request_budget
  set request_timestamps = v_timestamps,
      updated_at = v_now
  where budget_id = true;

  return jsonb_build_object(
    'claimed', true,
    'remaining_minute', greatest(0, least(44 - v_minute_count, coalesce(v_effective_minute_remaining, 45) - 1)),
    'remaining_day', greatest(0, least(4499 - v_day_count, coalesce(v_effective_day_remaining, 4500) - 1))
  );
end
$function$;

revoke all on function public.claim_mightpulse_api_request(integer) from public, anon, authenticated;
grant execute on function public.claim_mightpulse_api_request(integer) to service_role;

commit;
