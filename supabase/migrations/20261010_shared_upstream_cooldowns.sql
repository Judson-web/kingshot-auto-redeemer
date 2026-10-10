-- Shared upstream cooldowns across Vercel instances without introducing another database.
create table if not exists public.kingshot_source_cooldowns (
  source_url text primary key,
  cooldown_until timestamptz not null,
  updated_at timestamptz not null default now(),
  last_http_status integer not null default 429
);
alter table public.kingshot_source_cooldowns enable row level security;
revoke all on public.kingshot_source_cooldowns from public, anon, authenticated;

create or replace function public.kingshot_get_source_cooldown(p_source_url text)
returns timestamptz
language sql
security definer
set search_path = public
as $function$
  select cooldown_until
  from public.kingshot_source_cooldowns
  where source_url = p_source_url
    and cooldown_until > now()
  limit 1;
$function$;

create or replace function public.kingshot_set_source_cooldown(
  p_source_url text,
  p_cooldown_seconds integer,
  p_http_status integer default 429
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_until timestamptz;
begin
  if p_source_url is null or length(trim(p_source_url)) = 0 then
    raise exception 'source URL is required';
  end if;
  -- Bound corrupted/malicious values while preserving long Retry-After windows.
  v_until := now() + make_interval(secs => greatest(1, least(coalesce(p_cooldown_seconds, 60), 604800)));
  insert into public.kingshot_source_cooldowns(source_url, cooldown_until, updated_at, last_http_status)
  values (p_source_url, v_until, now(), coalesce(p_http_status, 429))
  on conflict (source_url) do update
    set cooldown_until = greatest(public.kingshot_source_cooldowns.cooldown_until, excluded.cooldown_until),
        updated_at = now(),
        last_http_status = excluded.last_http_status
  returning cooldown_until into v_until;
  return v_until;
end;
$function$;

revoke all on function public.kingshot_get_source_cooldown(text) from public, anon, authenticated;
grant execute on function public.kingshot_get_source_cooldown(text) to service_role;
revoke all on function public.kingshot_set_source_cooldown(text, integer, integer) from public, anon, authenticated;
grant execute on function public.kingshot_set_source_cooldown(text, integer, integer) to service_role;
