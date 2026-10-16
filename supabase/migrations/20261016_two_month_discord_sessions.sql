-- Limit server-side Discord login sessions to two months.
-- Existing sessions are capped at two months from this migration; subsequent
-- session creation and refreshes use the same two-month lifetime.
create or replace function public.kingshot_developer_account_session_create(p_token_hash text, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private, auth, extensions
as $function$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_user_id is null then
    return false;
  end if;
  if not exists (
    select 1 from auth.users
    where id = p_user_id and email_confirmed_at is not null
  ) then
    return false;
  end if;

  insert into private.kingshot_developer_account_sessions(token_hash, user_id, expires_at)
  values (p_token_hash, p_user_id, now() + interval '2 months')
  on conflict (token_hash) do update
    set user_id = excluded.user_id,
        expires_at = excluded.expires_at;
  return true;
end
$function$;

update private.kingshot_developer_account_sessions
set expires_at = least(expires_at, now() + interval '2 months')
where expires_at > now() + interval '2 months';

revoke all on function public.kingshot_developer_account_session_create(text, uuid) from public, anon, authenticated;
grant execute on function public.kingshot_developer_account_session_create(text, uuid) to service_role;
