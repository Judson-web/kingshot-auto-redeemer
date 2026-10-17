-- Retire the legacy developer passkey/session subsystem.
-- API-key ownership and authentication now use the Discord-linked developer account session tables.
revoke all on function public.kingshot_developer_create_session_with_key(text,text) from public, anon, authenticated, service_role;
revoke all on function public.kingshot_developer_logout(text) from public, anon, authenticated, service_role;
revoke all on function public.kingshot_developer_create_key(text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.kingshot_developer_list_keys(text) from public, anon, authenticated, service_role;
revoke all on function public.kingshot_developer_revoke_key(text,uuid) from public, anon, authenticated, service_role;
drop function if exists public.kingshot_developer_create_session_with_key(text,text);
drop function if exists public.kingshot_developer_logout(text);
drop function if exists public.kingshot_developer_create_key(text,text,text,text,text);
drop function if exists public.kingshot_developer_list_keys(text);
drop function if exists public.kingshot_developer_revoke_key(text,uuid);
drop table if exists private.kingshot_developer_sessions;
drop table if exists private.kingshot_developer_access_keys;
