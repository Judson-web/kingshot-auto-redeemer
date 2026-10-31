-- Serialize all Kingshot redemption requests across serverless instances and
-- maintain a separate provider-wide circuit cooldown after HTTP 429 responses.
alter table public.kingshot_source_cooldowns
  add column if not exists next_request_at timestamptz not null default now();

create or replace function public.kingshot_reserve_redemption_request(
  p_source_url text,
  p_spacing_ms integer default 500
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_next timestamptz;
  v_start timestamptz;
begin
  if p_source_url is null or length(trim(p_source_url)) = 0 then
    raise exception 'source URL is required';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_source_url));

  insert into public.kingshot_source_cooldowns(source_url, cooldown_until, next_request_at, updated_at, last_http_status)
  values (p_source_url, now(), now(), now(), 0)
  on conflict (source_url) do nothing;

  select cooldown_until, next_request_at
    into v_next, v_start
    from public.kingshot_source_cooldowns
    where source_url = p_source_url
    for update;

  -- A provider-wide circuit cooldown blocks new submissions entirely.
  if v_next > now() then
    return null;
  end if;

  v_start := greatest(now(), coalesce(v_start, now()));
  update public.kingshot_source_cooldowns
    set next_request_at = v_start + make_interval(secs => greatest(100, least(coalesce(p_spacing_ms, 500), 5000))::numeric / 1000),
        updated_at = now()
    where source_url = p_source_url;

  return v_start;
end;
$function$;

revoke all on function public.kingshot_reserve_redemption_request(text, integer) from public, anon, authenticated;
grant execute on function public.kingshot_reserve_redemption_request(text, integer) to service_role;
