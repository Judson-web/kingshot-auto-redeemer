-- Optimize admin scraper comparison by selecting the latest row per source once.
-- Keep the existing session check and service-role-only grants unchanged.
create or replace function public.kingshot_admin_scraper_comparison(p_token_hash text)
returns table(
  source text,
  checked_at timestamptz,
  http_status integer,
  code_count integer,
  codes jsonb,
  parse_ok boolean,
  error_category text,
  error_message text
)
language plpgsql
volatile
security definer
set search_path = public, private
as $function$
begin
  if not exists (
    select 1
    from private.kingshot_admin_sessions
    where token_hash = p_token_hash
      and expires_at > now()
  ) then
    raise exception 'Unauthorized';
  end if;

  return query
  select latest.source,
         latest.checked_at,
         latest.http_status,
         latest.code_count,
         latest.codes,
         latest.parse_ok,
         latest.error_category,
         latest.error_message
  from (
    select distinct on (r.source)
           r.source,
           r.checked_at,
           r.id,
           r.http_status,
           r.code_count,
           r.codes,
           r.parse_ok,
           r.error_category,
           r.error_message
    from public.kingshot_scraper_runs r
    order by r.source, r.checked_at desc, r.id desc
  ) latest
  order by latest.source;
end;
$function$;

-- Preserve the existing privileged-only execution boundary.
revoke all on function public.kingshot_admin_scraper_comparison(text) from public, anon, authenticated;
grant execute on function public.kingshot_admin_scraper_comparison(text) to service_role;
