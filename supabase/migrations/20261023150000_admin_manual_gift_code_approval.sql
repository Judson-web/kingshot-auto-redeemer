-- Admin-confirmed manual approvals bypass the player canary, but only override
-- older invalid/expired responses. Any new TIME_ERROR/CDK_NOT_FOUND after the
-- approval is still treated as expired; an explicit expires_at is always honored.
create or replace function public.list_kingshot_expired_gift_codes()
returns table(gift_code text)
language sql
security definer
set search_path to public
as $function$
  select distinct g.code as gift_code
  from public.kingshot_gift_codes g
  where g.expires_at is not null
    and g.expires_at <= now()
  union
  select distinct r.gift_code
  from public.kingshot_redemptions r
  where (
       upper(r.status) = 'TIME_ERROR'
       or r.err_code = 40007
       or upper(r.status) = 'CDK_NOT_FOUND'
       or r.err_code = 40014
    )
    and not exists (
      select 1
      from public.kingshot_gift_codes g
      where upper(g.code) = upper(r.gift_code)
        and g.admin_added is true
        and g.active is true
        and g.suppressed is false
        and g.validation_status = 'verified'
        and g.validation_message like 'Manual approval:%'
        and g.validated_at > r.attempted_at
    );
$function$;

revoke execute on function public.list_kingshot_expired_gift_codes() from public, anon, authenticated;
grant execute on function public.list_kingshot_expired_gift_codes() to service_role;
