-- Discord read-only view of validated active gift codes and recent success counts.
-- Keep aggregation in Postgres so large redemption histories are not truncated by REST row limits.
create or replace function public.discord_list_verified_gift_codes(p_since timestamptz default now() - interval '7 days')
returns table(code text, recent_successes bigint, validated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $function$
  select
    g.code,
    count(r.id)::bigint as recent_successes,
    g.validated_at
  from public.kingshot_gift_codes g
  left join public.kingshot_redemptions r
    on upper(r.gift_code) = upper(g.code)
   and r.status = 'SUCCESS'
   and r.attempted_at >= coalesce(p_since, now() - interval '7 days')
  where g.active = true
    and g.suppressed = false
    and g.validation_status = 'verified'
    and (g.expires_at is null or g.expires_at > now())
  group by g.code, g.validated_at
  order by recent_successes desc, g.validated_at desc nulls last, g.code asc;
$function$;

revoke all on function public.discord_list_verified_gift_codes(timestamptz) from public, anon, authenticated;
grant execute on function public.discord_list_verified_gift_codes(timestamptz) to service_role;
