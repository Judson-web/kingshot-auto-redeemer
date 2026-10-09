-- Keep the legacy two-argument overload suppression-aware as well.
create or replace function public.upsert_kingshot_gift_code(
  p_code text,
  p_source_date date default null
)
returns public.kingshot_gift_codes
language sql
security definer
set search_path to public
as $function$
  select public.upsert_kingshot_gift_code(p_code, p_source_date, null::timestamptz);
$function$;

revoke execute on function public.upsert_kingshot_gift_code(text,date) from public, anon, authenticated;
grant execute on function public.upsert_kingshot_gift_code(text,date) to service_role;
