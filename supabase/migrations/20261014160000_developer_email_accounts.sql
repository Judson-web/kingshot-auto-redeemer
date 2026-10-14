-- Email-authenticated developer accounts and account-owned API keys.
-- Legacy passkey sessions remain valid for the separate admin console; this migration
-- does not grant developer accounts administrative privileges.
create schema if not exists private;

create table if not exists private.kingshot_developer_account_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table private.kingshot_developer_account_sessions enable row level security;
revoke all on private.kingshot_developer_account_sessions from public, anon, authenticated;
grant all on private.kingshot_developer_account_sessions to service_role;

alter table private.kingshot_developer_api_keys
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
create index if not exists kingshot_developer_api_keys_owner_idx
  on private.kingshot_developer_api_keys(owner_user_id, created_at desc)
  where owner_user_id is not null;

create or replace function public.kingshot_developer_account_session_create(
  p_token_hash text, p_user_id uuid
) returns boolean
language plpgsql security definer set search_path = public, private, auth, extensions
as $function$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_user_id is null then return false; end if;
  if not exists (select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then return false; end if;
  insert into private.kingshot_developer_account_sessions(token_hash,user_id,expires_at)
  values(p_token_hash,p_user_id,now()+interval '12 hours')
  on conflict(token_hash) do update set user_id=excluded.user_id,expires_at=excluded.expires_at;
  return true;
end $function$;

create or replace function public.kingshot_developer_account_session_get(p_token_hash text)
returns uuid
language plpgsql security definer set search_path = public, private, auth, extensions
as $function$
declare v_user_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select s.user_id into v_user_id from private.kingshot_developer_account_sessions s
  join auth.users u on u.id=s.user_id
  where s.token_hash=p_token_hash and s.expires_at>now() and u.email_confirmed_at is not null;
  return v_user_id;
end $function$;

create or replace function public.kingshot_developer_account_session_delete(p_token_hash text)
returns boolean
language plpgsql security definer set search_path = public, private, extensions
as $function$
begin
  delete from private.kingshot_developer_account_sessions where token_hash=p_token_hash;
  return found;
end $function$;

create or replace function public.kingshot_developer_account_create_key(
  p_session_hash text, p_ip_hash text, p_key_hash text, p_key_prefix text, p_label text
) returns jsonb
language plpgsql security definer set search_path = public, private, auth, extensions
as $function$
declare v_user_id uuid; v_id uuid; v_created_at timestamptz; v_label text:=left(trim(coalesce(p_label,'Developer key')),80); v_count integer;
begin
  v_user_id:=public.kingshot_developer_account_session_get(p_session_hash);
  if v_user_id is null then raise exception using errcode='28000',message='Unauthorized'; end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' or p_key_prefix is null or p_key_prefix !~ '^ks_live_[0-9a-f]{8}$' then raise exception using errcode='22023',message='Invalid key request'; end if;
  if char_length(v_label)<1 then v_label:='Developer key'; end if;
  perform pg_advisory_xact_lock(hashtext(p_ip_hash));
  select count(*) into v_count from private.kingshot_developer_api_key_issuance where ip_hash=p_ip_hash;
  if v_count>=2 then raise exception using errcode='P0001',message='This IP address has reached the lifetime limit of two API keys.'; end if;
  perform pg_advisory_xact_lock(hashtext(v_user_id::text));
  if (select count(*) from private.kingshot_developer_api_keys where owner_user_id=v_user_id and revoked_at is null)>=3 then
    raise exception using errcode='P0001',message='You have reached the limit of three active API keys.';
  end if;
  insert into private.kingshot_developer_api_keys(key_hash,key_prefix,label,created_ip_hash,owner_user_id)
  values(p_key_hash,p_key_prefix,v_label,p_ip_hash,v_user_id) returning id,created_at into v_id,v_created_at;
  insert into private.kingshot_developer_api_key_issuance(ip_hash,key_id) values(p_ip_hash,v_id);
  return jsonb_build_object('id',v_id,'key_prefix',p_key_prefix,'label',v_label,'created_at',v_created_at);
end $function$;

create or replace function public.kingshot_developer_account_list_keys(p_session_hash text)
returns jsonb
language plpgsql security definer set search_path = public, private, extensions
as $function$
declare v_user_id uuid; v_result jsonb;
begin
  v_user_id:=public.kingshot_developer_account_session_get(p_session_hash);
  if v_user_id is null then raise exception using errcode='28000',message='Unauthorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'key_prefix',key_prefix,'label',label,'created_at',created_at,'last_used_at',last_used_at,'revoked_at',revoked_at,'minute_requests',minute_requests,'day_requests',day_requests) order by created_at desc),'[]'::jsonb)
  into v_result from private.kingshot_developer_api_keys where owner_user_id=v_user_id;
  return v_result;
end $function$;

create or replace function public.kingshot_developer_account_revoke_key(p_session_hash text,p_key_id uuid)
returns boolean
language plpgsql security definer set search_path = public, private, extensions
as $function$
declare v_user_id uuid;
begin
  v_user_id:=public.kingshot_developer_account_session_get(p_session_hash);
  if v_user_id is null then raise exception using errcode='28000',message='Unauthorized'; end if;
  update private.kingshot_developer_api_keys set revoked_at=coalesce(revoked_at,now())
  where id=p_key_id and owner_user_id=v_user_id;
  return found;
end $function$;

revoke all on function public.kingshot_developer_account_session_create(text,uuid) from public,anon,authenticated;
revoke all on function public.kingshot_developer_account_session_get(text) from public,anon,authenticated;
revoke all on function public.kingshot_developer_account_session_delete(text) from public,anon,authenticated;
revoke all on function public.kingshot_developer_account_create_key(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.kingshot_developer_account_list_keys(text) from public,anon,authenticated;
revoke all on function public.kingshot_developer_account_revoke_key(text,uuid) from public,anon,authenticated;
grant execute on function public.kingshot_developer_account_session_create(text,uuid) to service_role;
grant execute on function public.kingshot_developer_account_session_get(text) to service_role;
grant execute on function public.kingshot_developer_account_session_delete(text) to service_role;
grant execute on function public.kingshot_developer_account_create_key(text,text,text,text,text) to service_role;
grant execute on function public.kingshot_developer_account_list_keys(text) to service_role;
grant execute on function public.kingshot_developer_account_revoke_key(text,uuid) to service_role;
