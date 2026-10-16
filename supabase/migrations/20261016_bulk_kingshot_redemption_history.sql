-- Batch worker history reads to reduce per-player PostgREST RPC fan-out.
-- The caller uses service_role only; this function is not exposed to end users.
create or replace function public.list_kingshot_player_redemptions_bulk(p_player_ids text[])
returns table(
  player_id text,
  gift_code text,
  status text,
  err_code integer,
  message text,
  attempted_at timestamptz
)
language sql
security definer
set search_path = public
as $function$
  select r.player_id, r.gift_code, r.status, r.err_code, r.message, r.attempted_at
  from public.kingshot_redemptions r
  where r.player_id = any(coalesce(p_player_ids, array[]::text[]))
  order by r.player_id, r.attempted_at desc;
$function$;

revoke all on function public.list_kingshot_player_redemptions_bulk(text[]) from public, anon, authenticated;
grant execute on function public.list_kingshot_player_redemptions_bulk(text[]) to service_role;
