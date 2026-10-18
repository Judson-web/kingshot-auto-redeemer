-- Coordinate all serverless instances against one conservative MightPulse API budget.
begin;

create table if not exists public.mightpulse_api_request_budget (
  budget_id boolean primary key default true check (budget_id),
  request_timestamps timestamptz[] not null default '{}'::timestamptz[],
  cooldown_until timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.mightpulse_api_request_budget (budget_id)
values (true)
on conflict (budget_id) do nothing;

alter table public.mightpulse_api_request_budget enable row level security;
revoke all on table public.mightpulse_api_request_budget from public, anon, authenticated, service_role;

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
  v_retry_after_ms bigint;
  v_cooldown_seconds integer;
begin
  -- Serialize reservations across every Vercel instance and worker shard.
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

  -- Stay below MightPulse's standard 60/minute and 5,000/day limits,
  -- leaving headroom for other uses of the same API key.
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
    'remaining_minute', greatest(0, 44 - v_minute_count),
    'remaining_day', greatest(0, 4499 - v_day_count)
  );
end
$function$;

revoke all on function public.claim_mightpulse_api_request(integer) from public, anon, authenticated;
grant execute on function public.claim_mightpulse_api_request(integer) to service_role;

commit;
