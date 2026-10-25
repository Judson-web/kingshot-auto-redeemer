create or replace function public.kingshot_admin_delete_discord_session(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $function$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  delete from private.kingshot_admin_sessions where token_hash = p_token_hash;
  return found;
end;
$function$;

revoke all on function public.kingshot_admin_delete_discord_session(text) from public, anon, authenticated;
grant execute on function public.kingshot_admin_delete_discord_session(text) to service_role;
