-- Expose the complete authoritative roster for secondary execution-plane refreshes.
-- Keep disabled and stale records so the mirror can deactivate them instead of leaving stale work eligible.
create or replace function public.list_kingshot_autoredeem_roster()
returns table(player_id text, kingdom_id text, enabled boolean, stale boolean, updated_at timestamptz)
language sql security definer set search_path=public
as $$
 select k.player_id,k.kingdom_id,k.enabled,k.stale,k.updated_at
 from public.kingshot_autoredeem k
 order by k.created_at asc
$$;
revoke all on function public.list_kingshot_autoredeem_roster() from public,anon,authenticated;
grant execute on function public.list_kingshot_autoredeem_roster() to service_role;
