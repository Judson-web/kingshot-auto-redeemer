-- Developer API v2: private key storage, atomic per-IP issuance cap, and durable quotas.
create schema if not exists private;

create table if not exists private.kingshot_developer_api_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  key_prefix text not null check (char_length(key_prefix) between 8 and 32),
  label text not null default 'Developer key' check (char_length(label) between 1 and 80),
  created_ip_hash text not null check (created_ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  minute_window_start timestamptz not null default date_trunc('minute', now()),
  minute_requests integer not null default 0 check (minute_requests >= 0),
  day_window date not null default current_date,
  day_requests integer not null default 0 check (day_requests >= 0)
);
create index if not exists kingshot_developer_api_keys_created_at_idx
  on private.kingshot_developer_api_keys (created_at desc);

create table if not exists private.kingshot_developer_api_key_issuance (
  id bigint generated always as identity primary key,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  key_id uuid not null unique references private.kingshot_developer_api_keys(id),
  created_at timestamptz not null default now()
);
create index if not exists kingshot_developer_key_issuance_ip_idx
  on private.kingshot_developer_api_key_issuance (ip_hash, created_at);

create table if not exists private.kingshot_developer_ip_rate_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null default date_trunc('minute', now()),
  request_count integer not null default 0 check (request_count >= 0)
);

alter table private.kingshot_developer_api_keys enable row level security;
alter table private.kingshot_developer_api_key_issuance enable row level security;
alter table private.kingshot_developer_ip_rate_limits enable row level security;
revoke all on private.kingshot_developer_api_keys from public, anon, authenticated;
revoke all on private.kingshot_developer_api_key_issuance from public, anon, authenticated;
revoke all on private.kingshot_developer_ip_rate_limits from public, anon, authenticated;
grant all on private.kingshot_developer_api_keys to service_role;
grant all on private.kingshot_developer_api_key_issuance to service_role;
grant all on private.kingshot_developer_ip_rate_limits to service_role;
grant usage, select on sequence private.kingshot_developer_api_key_issuance_id_seq to service_role;

create or replace function public.kingshot_developer_create_key(
  p_admin_token_hash text, p_ip_hash text, p_key_hash text, p_key_prefix text, p_label text
) returns jsonb
language plpgsql security definer
set search_path = public, private, extensions
as $function$
declare
  v_id uuid;
  v_created_at timestamptz;
  v_label text := left(trim(coalesce(p_label, 'Developer key')), 80);
  v_count integer;
begin
  if p_admin_token_hash is null or not exists (
    select 1 from private.kingshot_admin_sessions
    where token_hash = p_admin_token_hash and expires_at > now()
  ) then raise exception using errcode='28000', message='Unauthorized'; end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$'
     or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$'
     or p_key_prefix is null or p_key_prefix !~ '^ks_live_[0-9a-f]{8}$' then
    raise exception using errcode='22023', message='Invalid key request';
  end if;
  if char_length(v_label) < 1 then v_label := 'Developer key'; end if;

  perform pg_advisory_xact_lock(hashtext(p_ip_hash));
  select count(*) into v_count
    from private.kingshot_developer_api_key_issuance where ip_hash = p_ip_hash;
  if v_count >= 2 then
    raise exception using errcode='P0001', message='This IP address has reached the lifetime limit of two API keys.';
  end if;

  insert into private.kingshot_developer_api_keys(key_hash, key_prefix, label, created_ip_hash)
  values(p_key_hash, p_key_prefix, v_label, p_ip_hash)
  returning id, created_at into v_id, v_created_at;
  insert into private.kingshot_developer_api_key_issuance(ip_hash, key_id) values(p_ip_hash, v_id);
  return jsonb_build_object('id', v_id, 'key_prefix', p_key_prefix, 'label', v_label, 'created_at', v_created_at);
end
$function$;

create or replace function public.kingshot_developer_list_keys(p_admin_token_hash text)
returns jsonb
language plpgsql security definer
set search_path = public, private, extensions
as $function$
declare v_result jsonb;
begin
  if p_admin_token_hash is null or not exists (
    select 1 from private.kingshot_admin_sessions
    where token_hash = p_admin_token_hash and expires_at > now()
  ) then raise exception using errcode='28000', message='Unauthorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'key_prefix', key_prefix, 'label', label, 'created_at', created_at,
    'last_used_at', last_used_at, 'revoked_at', revoked_at,
    'requests_today', day_requests, 'daily_limit', 1000, 'minute_limit', 60
  ) order by created_at desc), '[]'::jsonb)
  into v_result from private.kingshot_developer_api_keys;
  return v_result;
end
$function$;

create or replace function public.kingshot_developer_revoke_key(p_admin_token_hash text, p_key_id uuid)
returns boolean
language plpgsql security definer
set search_path = public, private, extensions
as $function$
begin
  if p_admin_token_hash is null or not exists (
    select 1 from private.kingshot_admin_sessions
    where token_hash = p_admin_token_hash and expires_at > now()
  ) then raise exception using errcode='28000', message='Unauthorized'; end if;
  update private.kingshot_developer_api_keys set revoked_at = coalesce(revoked_at, now()) where id = p_key_id;
  return found;
end
$function$;

create or replace function public.kingshot_developer_authorize_key(p_key_hash text, p_ip_hash text)
returns jsonb
language plpgsql security definer
set search_path = public, private, extensions
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_ip_count integer;
  v_key private.kingshot_developer_api_keys%rowtype;
  v_minute_start timestamptz := date_trunc('minute', clock_timestamp());
  v_today date := (clock_timestamp() at time zone 'UTC')::date;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('allowed', false, 'reason', 'client_ip_unavailable');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_ip_hash));
  insert into private.kingshot_developer_ip_rate_limits(ip_hash, window_start, request_count)
  values(p_ip_hash, v_minute_start, 1)
  on conflict(ip_hash) do update set
    window_start = case when private.kingshot_developer_ip_rate_limits.window_start < v_minute_start then v_minute_start else private.kingshot_developer_ip_rate_limits.window_start end,
    request_count = case when private.kingshot_developer_ip_rate_limits.window_start < v_minute_start then 1 else private.kingshot_developer_ip_rate_limits.request_count + 1 end
  returning request_count into v_ip_count;
  if v_ip_count > 120 then
    return jsonb_build_object('allowed', false, 'reason', 'ip_rate_limit', 'limit', 120, 'remaining', 0, 'reset_at', v_minute_start + interval '1 minute');
  end if;

  select * into v_key from private.kingshot_developer_api_keys
  where key_hash = p_key_hash and revoked_at is null for update;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'invalid_api_key'); end if;

  if v_key.minute_window_start < v_minute_start then
    v_key.minute_window_start := v_minute_start; v_key.minute_requests := 0;
  end if;
  if v_key.day_window <> v_today then
    v_key.day_window := v_today; v_key.day_requests := 0;
  end if;
  if v_key.minute_requests >= 60 then
    return jsonb_build_object('allowed', false, 'reason', 'minute_rate_limit', 'limit', 60, 'remaining', 0, 'reset_at', v_minute_start + interval '1 minute');
  end if;
  if v_key.day_requests >= 1000 then
    return jsonb_build_object('allowed', false, 'reason', 'daily_quota_exceeded', 'limit', 1000, 'remaining', 0, 'reset_at', ((v_today + 1)::timestamp at time zone 'UTC'));
  end if;

  update private.kingshot_developer_api_keys set
    minute_window_start = v_key.minute_window_start,
    minute_requests = v_key.minute_requests + 1,
    day_window = v_key.day_window,
    day_requests = v_key.day_requests + 1,
    last_used_at = v_now
  where id = v_key.id;
  return jsonb_build_object('allowed', true, 'key_id', v_key.id, 'limit', 60,
    'remaining', greatest(0, 59 - v_key.minute_requests),
    'reset_at', v_minute_start + interval '1 minute',
    'daily_remaining', greatest(0, 999 - v_key.day_requests));
end
$function$;

revoke all on function public.kingshot_developer_create_key(text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.kingshot_developer_list_keys(text) from public, anon, authenticated;
revoke all on function public.kingshot_developer_revoke_key(text,uuid) from public, anon, authenticated;
revoke all on function public.kingshot_developer_authorize_key(text,text) from public, anon, authenticated;
grant execute on function public.kingshot_developer_create_key(text,text,text,text,text) to service_role;
grant execute on function public.kingshot_developer_list_keys(text) to service_role;
grant execute on function public.kingshot_developer_revoke_key(text,uuid) to service_role;
grant execute on function public.kingshot_developer_authorize_key(text,text) to service_role;
