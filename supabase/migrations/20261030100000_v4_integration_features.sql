-- V4 scopes, usage RPC, webhook subscriptions and durable delivery queue.
alter table private.kingshot_developer_api_keys
 add column if not exists scopes text[] not null default array['players:read','alliances:read','redemptions:write','redemptions:read','webhooks:manage','usage:read']::text[],
 add column if not exists expires_at timestamptz;
create table if not exists public.kingshot_developer_webhooks(
 id uuid primary key default gen_random_uuid(),key_id uuid not null references private.kingshot_developer_api_keys(id) on delete cascade,
 url text not null check(url ~ '^https://'),events text[] not null check(cardinality(events) between 1 and 2),
 secret_hash text not null check(secret_hash ~ '^[0-9a-f]{64}$'),secret_ciphertext text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),disabled_at timestamptz);
create index if not exists kingshot_developer_webhooks_key_idx on public.kingshot_developer_webhooks(key_id,created_at desc);
create table if not exists public.kingshot_developer_webhook_deliveries(
 id uuid primary key default gen_random_uuid(),webhook_id uuid not null references public.kingshot_developer_webhooks(id) on delete cascade,
 event_id uuid not null default gen_random_uuid(),event_type text not null,payload jsonb not null,attempt_count integer not null default 0 check(attempt_count>=0),
 next_attempt_at timestamptz not null default now(),delivered_at timestamptz,last_status integer,last_error text,created_at timestamptz not null default now(),unique(webhook_id,event_id));
create index if not exists kingshot_developer_webhook_due_idx on public.kingshot_developer_webhook_deliveries(next_attempt_at) where delivered_at is null;
alter table public.kingshot_developer_webhooks enable row level security;alter table public.kingshot_developer_webhook_deliveries enable row level security;
revoke all on public.kingshot_developer_webhooks from public,anon,authenticated;revoke all on public.kingshot_developer_webhook_deliveries from public,anon,authenticated;
grant all on public.kingshot_developer_webhooks to service_role;grant all on public.kingshot_developer_webhook_deliveries to service_role;
create or replace function public.kingshot_developer_authorize_key(p_key_hash text,p_ip_hash text) returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v_now timestamptz:=clock_timestamp();v_ip_count integer;v_key private.kingshot_developer_api_keys%rowtype;v_minute_start timestamptz:=date_trunc('minute',clock_timestamp());v_today date:=(clock_timestamp() at time zone 'UTC')::date;
begin
 if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('allowed',false,'reason','client_ip_unavailable');end if;
 perform pg_advisory_xact_lock(hashtext(p_ip_hash));
 insert into private.kingshot_developer_ip_rate_limits(ip_hash,window_start,request_count) values(p_ip_hash,v_minute_start,1) on conflict(ip_hash) do update set window_start=case when private.kingshot_developer_ip_rate_limits.window_start<v_minute_start then v_minute_start else private.kingshot_developer_ip_rate_limits.window_start end,request_count=case when private.kingshot_developer_ip_rate_limits.window_start<v_minute_start then 1 else private.kingshot_developer_ip_rate_limits.request_count+1 end returning request_count into v_ip_count;
 if v_ip_count>120 then return jsonb_build_object('allowed',false,'reason','ip_rate_limit','limit',120,'remaining',0,'reset_at',v_minute_start+interval '1 minute');end if;
 select * into v_key from private.kingshot_developer_api_keys where key_hash=p_key_hash and revoked_at is null and (expires_at is null or expires_at>v_now) for update;
 if not found then return jsonb_build_object('allowed',false,'reason','invalid_api_key');end if;
 if v_key.minute_window_start<v_minute_start then v_key.minute_window_start:=v_minute_start;v_key.minute_requests:=0;end if;
 if v_key.day_window<>v_today then v_key.day_window:=v_today;v_key.day_requests:=0;end if;
 if v_key.minute_requests>=60 then return jsonb_build_object('allowed',false,'reason','minute_rate_limit','limit',60,'remaining',0,'reset_at',v_minute_start+interval '1 minute');end if;
 if v_key.day_requests>=1000 then return jsonb_build_object('allowed',false,'reason','daily_quota_exceeded','limit',1000,'remaining',0,'reset_at',((v_today+1)::timestamp at time zone 'UTC'));end if;
 update private.kingshot_developer_api_keys set minute_window_start=v_key.minute_window_start,minute_requests=v_key.minute_requests+1,day_window=v_key.day_window,day_requests=v_key.day_requests+1,last_used_at=v_now where id=v_key.id;
 return jsonb_build_object('allowed',true,'key_id',v_key.id,'scopes',to_jsonb(v_key.scopes),'expires_at',v_key.expires_at,'limit',60,'remaining',greatest(0,59-v_key.minute_requests),'reset_at',v_minute_start+interval '1 minute','daily_remaining',greatest(0,999-v_key.day_requests));
end $$;
revoke all on function public.kingshot_developer_authorize_key(text,text) from public,anon,authenticated;grant execute on function public.kingshot_developer_authorize_key(text,text) to service_role;
create or replace function public.kingshot_developer_get_usage(p_key_id uuid) returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare k private.kingshot_developer_api_keys%rowtype;
begin select * into k from private.kingshot_developer_api_keys where id=p_key_id and revoked_at is null; if not found then raise exception using errcode='28000',message='Unauthorized';end if;
 return jsonb_build_object('keyPrefix',k.key_prefix,'label',k.label,'lastUsedAt',k.last_used_at,'minute',jsonb_build_object('used',k.minute_requests,'limit',60,'resetsAt',k.minute_window_start+interval '1 minute'),'day',jsonb_build_object('used',k.day_requests,'limit',1000,'resetsAt',((k.day_window+1)::timestamp at time zone 'UTC')));
end $$;
revoke all on function public.kingshot_developer_get_usage(uuid) from public,anon,authenticated;grant execute on function public.kingshot_developer_get_usage(uuid) to service_role;

create or replace function public.kingshot_developer_account_list_keys(p_session_hash text)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v_user_id uuid; v_result jsonb;
begin v_user_id:=public.kingshot_developer_account_session_get(p_session_hash);if v_user_id is null then raise exception using errcode='28000',message='Unauthorized';end if;
select coalesce(jsonb_agg(jsonb_build_object('id',id,'key_prefix',key_prefix,'label',label,'created_at',created_at,'last_used_at',last_used_at,'revoked_at',revoked_at,'minute_requests',minute_requests,'day_requests',day_requests,'scopes',scopes,'expires_at',expires_at) order by created_at desc),'[]'::jsonb) into v_result from private.kingshot_developer_api_keys where owner_user_id=v_user_id;return v_result;end $$;
create or replace function public.kingshot_developer_account_update_key_settings(p_session_hash text,p_key_id uuid,p_scopes text[],p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path=public,private,extensions as $$
declare v_user_id uuid;v_allowed text[]:=array['players:read','alliances:read','redemptions:write','redemptions:read','webhooks:manage','usage:read'];
begin v_user_id:=public.kingshot_developer_account_session_get(p_session_hash);if v_user_id is null then raise exception using errcode='28000',message='Unauthorized';end if;
if p_scopes is null or cardinality(p_scopes)<1 or cardinality(p_scopes)>6 or exists(select 1 from unnest(p_scopes) s where not(s=any(v_allowed))) then raise exception using errcode='22023',message='Invalid API scopes';end if;
if p_expires_at is not null and (p_expires_at<=now() or p_expires_at>now()+interval '1 year') then raise exception using errcode='22023',message='Expiry must be in the next year';end if;
update private.kingshot_developer_api_keys set scopes=p_scopes,expires_at=p_expires_at where id=p_key_id and owner_user_id=v_user_id and revoked_at is null;return found;end $$;
revoke all on function public.kingshot_developer_account_update_key_settings(text,uuid,text[],timestamptz) from public,anon,authenticated;grant execute on function public.kingshot_developer_account_update_key_settings(text,uuid,text[],timestamptz) to service_role;
