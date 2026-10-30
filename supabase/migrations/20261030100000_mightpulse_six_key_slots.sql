-- Extend the shared MightPulse quota slots to support all six separately-issued MightPulse credentials.
-- Raw credentials remain in Vercel environment variables and are never stored here.
begin;

alter table public.mightpulse_api_key_budget
  drop constraint if exists mightpulse_api_key_budget_key_id_check;

alter table public.mightpulse_api_key_budget
  add constraint mightpulse_api_key_budget_key_id_check
  check (key_id in (
    'key6', 'key5', 'key4', 'key3', 'key2', 'legacy', 'kss', 'kss1',
    'kss2', 'kss3', 'kss4', 'kss5', 'kss6',
    'kss7', 'kss8', 'kss9', 'kss10'
  ));

create or replace function public.record_mightpulse_api_key_usage(
  p_key_id text,
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
  if p_key_id not in (
    'key6', 'key5', 'key4', 'key3', 'key2', 'legacy', 'kss', 'kss1', 'kss2', 'kss3', 'kss4',
    'kss5', 'kss6', 'kss7', 'kss8', 'kss9', 'kss10'
  ) or p_observed_at is null
     or p_minute_remaining is null or p_minute_remaining < 0
     or p_minute_resets_at is null
     or p_day_remaining is null or p_day_remaining < 0
     or p_day_resets_at is null then
    return jsonb_build_object('recorded', false, 'reason', 'INVALID_USAGE_SNAPSHOT');
  end if;

  insert into public.mightpulse_api_key_budget (key_id)
  values (p_key_id)
  on conflict (key_id) do nothing;

  select usage_observed_at into v_existing
  from public.mightpulse_api_key_budget
  where key_id = p_key_id
  for update;

  if v_existing is not null and p_observed_at <= v_existing then
    return jsonb_build_object('recorded', false, 'reason', 'STALE_USAGE_SNAPSHOT');
  end if;

  update public.mightpulse_api_key_budget
  set usage_observed_at = p_observed_at,
      usage_minute_remaining = p_minute_remaining,
      usage_minute_resets_at = p_minute_resets_at,
      usage_day_remaining = p_day_remaining,
      usage_day_resets_at = p_day_resets_at,
      updated_at = v_now
  where key_id = p_key_id;

  return jsonb_build_object('recorded', true);
end
$function$;

create or replace function public.claim_mightpulse_api_key_request(
  p_key_id text,
  p_mark_cooldown_seconds integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_budget public.mightpulse_api_key_budget%rowtype;
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
  if p_key_id not in (
    'key6', 'key5', 'key4', 'key3', 'key2', 'legacy', 'kss1', 'kss', 'kss2', 'kss3', 'kss4',
    'kss5', 'kss6', 'kss7', 'kss8', 'kss9', 'kss10'
  ) then
    return jsonb_build_object('claimed', false, 'reason', 'INVALID_KEY_SLOT', 'retry_after_ms', 60000);
  end if;

  insert into public.mightpulse_api_key_budget (key_id)
  values (p_key_id)
  on conflict (key_id) do nothing;

  select * into v_budget
  from public.mightpulse_api_key_budget
  where key_id = p_key_id
  for update;

  select coalesce(array_agg(entry.request_at order by entry.request_at), '{}'::timestamptz[])
  into v_timestamps
  from unnest(coalesce(v_budget.request_timestamps, '{}'::timestamptz[])) as entry(request_at)
  where entry.request_at > v_now - interval '24 hours';

  v_cooldown_until := case when v_budget.cooldown_until > v_now then v_budget.cooldown_until else null end;

  update public.mightpulse_api_key_budget
  set request_timestamps = v_timestamps, cooldown_until = v_cooldown_until, updated_at = v_now
  where key_id = p_key_id;

  if coalesce(p_mark_cooldown_seconds, 0) > 0 then
    v_cooldown_seconds := least(90, greatest(15, p_mark_cooldown_seconds));
    v_cooldown_until := greatest(coalesce(v_cooldown_until, 'epoch'::timestamptz), v_now + make_interval(secs => v_cooldown_seconds));
    update public.mightpulse_api_key_budget
    set cooldown_until = v_cooldown_until, updated_at = v_now
    where key_id = p_key_id;
    return jsonb_build_object('claimed', false, 'reason', 'UPSTREAM_RATE_LIMIT',
      'retry_after_ms', greatest(1, ceil(extract(epoch from (v_cooldown_until - v_now)) * 1000)::bigint));
  end if;

  if v_cooldown_until is not null then
    return jsonb_build_object('claimed', false, 'reason', 'RATE_LIMIT_COOLDOWN',
      'retry_after_ms', greatest(1, ceil(extract(epoch from (v_cooldown_until - v_now)) * 1000)::bigint));
  end if;

  select count(*)::integer into v_minute_count
  from unnest(v_timestamps) as entry(request_at)
  where entry.request_at > v_now - interval '60 seconds';
  v_day_count := cardinality(v_timestamps);

  if v_budget.usage_observed_at is not null and v_budget.usage_minute_resets_at > v_now then
    select count(*)::integer into v_usage_minute_count
    from unnest(v_timestamps) as entry(request_at)
    where entry.request_at > v_budget.usage_observed_at and entry.request_at < v_budget.usage_minute_resets_at;
    v_effective_minute_remaining := greatest(0, v_budget.usage_minute_remaining - v_usage_minute_count);
    if v_effective_minute_remaining <= 0 then
      return jsonb_build_object('claimed', false, 'reason', 'UPSTREAM_MINUTE_BUDGET_EXHAUSTED',
        'retry_after_ms', greatest(1, ceil(extract(epoch from (v_budget.usage_minute_resets_at - v_now)) * 1000)::bigint),
        'remaining_minute', 0, 'remaining_day', greatest(0, 4500 - v_day_count));
    end if;
  else
    v_effective_minute_remaining := null;
  end if;

  if v_budget.usage_observed_at is not null and v_budget.usage_day_resets_at > v_now then
    select count(*)::integer into v_usage_day_count
    from unnest(v_timestamps) as entry(request_at)
    where entry.request_at > v_budget.usage_observed_at and entry.request_at < v_budget.usage_day_resets_at;
    v_effective_day_remaining := greatest(0, v_budget.usage_day_remaining - v_usage_day_count);
    if v_effective_day_remaining <= 0 then
      return jsonb_build_object('claimed', false, 'reason', 'UPSTREAM_DAY_BUDGET_EXHAUSTED',
        'retry_after_ms', greatest(1, ceil(extract(epoch from (v_budget.usage_day_resets_at - v_now)) * 1000)::bigint),
        'remaining_minute', greatest(0, 45 - v_minute_count), 'remaining_day', 0);
    end if;
  else
    v_effective_day_remaining := null;
  end if;

  if v_minute_count >= 45 then
    select min(entry.request_at) into v_oldest
    from unnest(v_timestamps) as entry(request_at)
    where entry.request_at > v_now - interval '60 seconds';
    return jsonb_build_object('claimed', false, 'reason', 'MINUTE_BUDGET_EXHAUSTED',
      'retry_after_ms', greatest(1, ceil(extract(epoch from ((v_oldest + interval '60 seconds') - v_now)) * 1000)::bigint),
      'remaining_minute', 0, 'remaining_day', greatest(0, 4500 - v_day_count));
  end if;

  if v_day_count >= 4500 then
    select min(entry.request_at) into v_oldest from unnest(v_timestamps) as entry(request_at);
    return jsonb_build_object('claimed', false, 'reason', 'DAY_BUDGET_EXHAUSTED',
      'retry_after_ms', greatest(1, ceil(extract(epoch from ((v_oldest + interval '24 hours') - v_now)) * 1000)::bigint),
      'remaining_minute', greatest(0, 45 - v_minute_count), 'remaining_day', 0);
  end if;

  v_timestamps := array_append(v_timestamps, v_now);
  update public.mightpulse_api_key_budget
  set request_timestamps = v_timestamps, updated_at = v_now
  where key_id = p_key_id;

  return jsonb_build_object('claimed', true, 'key_id', p_key_id,
    'remaining_minute', greatest(0, least(44 - v_minute_count, coalesce(v_effective_minute_remaining, 45) - 1)),
    'remaining_day', greatest(0, least(4499 - v_day_count, coalesce(v_effective_day_remaining, 4500) - 1)));
end
$function$;

revoke all on function public.record_mightpulse_api_key_usage(text, timestamptz, integer, timestamptz, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_mightpulse_api_key_request(text, integer) from public, anon, authenticated;
grant execute on function public.record_mightpulse_api_key_usage(text, timestamptz, integer, timestamptz, integer, timestamptz) to service_role;
grant execute on function public.claim_mightpulse_api_key_request(text, integer) to service_role;

commit;
