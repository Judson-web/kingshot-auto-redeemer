-- Discord-owner bridge for legacy admin RPCs. The application first verifies the
-- HttpOnly owner session and then calls this function; the function independently
-- verifies the Discord identity before creating the short-lived legacy RPC session.
create or replace function public.kingshot_admin_create_discord_session(
  p_token_hash text,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, private, auth
as $function$
declare
  v_email text;
  v_discord_id text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  select u.email,
         coalesce(i.identity_data->>'provider_id', i.identity_data->>'sub',
                  i.identity_data->>'id', i.identity_data->>'user_id',
                  u.raw_user_meta_data->>'provider_id', u.raw_user_meta_data->>'sub',
                  u.raw_user_meta_data->>'id')
    into v_email, v_discord_id
    from auth.users u
    join auth.identities i on i.user_id = u.id and i.provider = 'discord'
   where u.id = p_user_id
   limit 1;

  if v_email is null or v_discord_id is distinct from '871756466900598815' then
    return false;
  end if;

  delete from private.kingshot_admin_sessions where expires_at < now();
  insert into private.kingshot_admin_sessions(token_hash, email, expires_at)
  values(p_token_hash, lower(v_email), now() + interval '2 minutes')
  on conflict(token_hash) do update
    set email = excluded.email, expires_at = excluded.expires_at;
  return true;
end
$function$;

revoke all on function public.kingshot_admin_create_discord_session(text, uuid) from public, anon, authenticated;
grant execute on function public.kingshot_admin_create_discord_session(text, uuid) to service_role;

-- Prevent client roles from creating legacy password/passkey sessions.
revoke all on function public.kingshot_admin_create_session(text, text, text) from public, anon, authenticated;
