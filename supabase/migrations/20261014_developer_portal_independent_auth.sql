create table if not exists private.kingshot_developer_access_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  label text not null default 'Primary developer passkey',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create table if not exists private.kingshot_developer_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table private.kingshot_developer_access_keys enable row level security;
alter table private.kingshot_developer_sessions enable row level security;
revoke all on private.kingshot_developer_access_keys from anon, authenticated;
revoke all on private.kingshot_developer_sessions from anon, authenticated;
create or replace function public.kingshot_developer_create_session_with_key(p_key_hash text, p_token_hash text)
returns boolean language plpgsql security definer set search_path = public, private, extensions as $function$
declare v_key_id uuid;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  select id into v_key_id from private.kingshot_developer_access_keys where key_hash=p_key_hash and enabled=true for update;
  if v_key_id is null then return false; end if;
  update private.kingshot_developer_access_keys set last_used_at=now() where id=v_key_id;
  insert into private.kingshot_developer_sessions(token_hash, expires_at) values(p_token_hash, now() + interval '12 hours')
  on conflict(token_hash) do update set expires_at=excluded.expires_at;
  return true;
end $function$;
create or replace function public.kingshot_developer_logout(p_token_hash text)
returns boolean language plpgsql security definer set search_path = public, private, extensions as $function$
begin
  delete from private.kingshot_developer_sessions where token_hash=p_token_hash;
  return found;
end $function$;
revoke all on function public.kingshot_developer_create_session_with_key(text,text) from public, anon, authenticated;
revoke all on function public.kingshot_developer_logout(text) from public, anon, authenticated;
grant execute on function public.kingshot_developer_create_session_with_key(text,text) to service_role;
grant execute on function public.kingshot_developer_logout(text) to service_role;
create or replace function public.kingshot_developer_create_key(p_admin_token_hash text, p_ip_hash text, p_key_hash text, p_key_prefix text, p_label text)
returns jsonb language plpgsql security definer set search_path = public, private, extensions as $function$
declare v_id uuid; v_created_at timestamptz; v_label text := left(trim(coalesce(p_label, 'Developer key')), 80); v_count integer;
begin
  if p_admin_token_hash is null or not exists (select 1 from private.kingshot_developer_sessions where token_hash=p_admin_token_hash and expires_at>now()) then raise exception using errcode='28000', message='Unauthorized'; end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' or p_key_prefix is null or p_key_prefix !~ '^ks_live_[0-9a-f]{8}$' then raise exception using errcode='22023', message='Invalid key request'; end if;
  if char_length(v_label)<1 then v_label:='Developer key'; end if;
  perform pg_advisory_xact_lock(hashtext(p_ip_hash));
  select count(*) into v_count from private.kingshot_developer_api_key_issuance where ip_hash=p_ip_hash;
  if v_count>=2 then raise exception using errcode='P0001', message='This IP address has reached the lifetime limit of two API keys.'; end if;
  insert into private.kingshot_developer_api_keys(key_hash,key_prefix,label,created_ip_hash) values(p_key_hash,p_key_prefix,v_label,p_ip_hash) returning id,created_at into v_id,v_created_at;
  insert into private.kingshot_developer_api_key_issuance(ip_hash,key_id) values(p_ip_hash,v_id);
  return jsonb_build_object('id',v_id,'key_prefix',p_key_prefix,'label',v_label,'created_at',v_created_at);
end $function$;
create or replace function public.kingshot_developer_list_keys(p_admin_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, private, extensions as $function$
declare v_result jsonb;
begin
  if p_admin_token_hash is null or not exists (select 1 from private.kingshot_developer_sessions where token_hash=p_admin_token_hash and expires_at>now()) then raise exception using errcode='28000', message='Unauthorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'key_prefix',key_prefix,'label',label,'created_at',created_at,'last_used_at',last_used_at,'revoked_at',revoked_at,'requests_today',day_requests,'daily_limit',1000,'minute_limit',60) order by created_at desc),'[]'::jsonb) into v_result from private.kingshot_developer_api_keys;
  return v_result;
end $function$;
create or replace function public.kingshot_developer_revoke_key(p_admin_token_hash text, p_key_id uuid)
returns boolean language plpgsql security definer set search_path = public, private, extensions as $function$
begin
  if p_admin_token_hash is null or not exists (select 1 from private.kingshot_developer_sessions where token_hash=p_admin_token_hash and expires_at>now()) then raise exception using errcode='28000', message='Unauthorized'; end if;
  update private.kingshot_developer_api_keys set revoked_at=coalesce(revoked_at,now()) where id=p_key_id;
  return found;
end $function$;
revoke all on function public.kingshot_developer_create_key(text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.kingshot_developer_list_keys(text) from public, anon, authenticated;
revoke all on function public.kingshot_developer_revoke_key(text,uuid) from public, anon, authenticated;
grant execute on function public.kingshot_developer_create_key(text,text,text,text,text) to service_role;
grant execute on function public.kingshot_developer_list_keys(text) to service_role;
grant execute on function public.kingshot_developer_revoke_key(text,uuid) to service_role;
