-- Native V4 redemption idempotency. Unlike the legacy V3 table, this ledger
-- never expires or reopens an unknown outcome automatically.
create table if not exists private.kingshot_developer_v4_redemption_idempotency (
  key_id uuid not null references private.kingshot_developer_api_keys(id) on delete cascade,
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'processing'
    check (state in ('processing', 'completed', 'unknown')),
  response_status integer,
  response_body jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (key_id, key_hash),
  check (
    (state = 'processing' and response_status is null and response_body is null)
    or
    (state in ('completed', 'unknown')
      and response_status between 100 and 599
      and response_body is not null)
  )
);

create index if not exists kingshot_developer_v4_redemption_idempotency_updated_idx
  on private.kingshot_developer_v4_redemption_idempotency(updated_at);

alter table private.kingshot_developer_v4_redemption_idempotency enable row level security;
revoke all on private.kingshot_developer_v4_redemption_idempotency from public, anon, authenticated;
grant all on private.kingshot_developer_v4_redemption_idempotency to service_role;

create or replace function public.kingshot_developer_v4_begin_redemption(
  p_key_id uuid, p_key_hash text, p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v private.kingshot_developer_v4_redemption_idempotency%rowtype;
  v_inserted integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$'
     or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
     or not exists (
       select 1 from private.kingshot_developer_api_keys
       where id = p_key_id and revoked_at is null
         and (expires_at is null or expires_at > now())
     ) then
    raise exception using errcode = '28000', message = 'Unauthorized or invalid key';
  end if;

  insert into private.kingshot_developer_v4_redemption_idempotency(key_id, key_hash, request_hash)
  values (p_key_id, p_key_hash, p_request_hash)
  on conflict (key_id, key_hash) do nothing;
  get diagnostics v_inserted = row_count;

  select * into v
  from private.kingshot_developer_v4_redemption_idempotency
  where key_id = p_key_id and key_hash = p_key_hash
  for update;

  if v_inserted = 1 then
    return jsonb_build_object('state', 'started');
  end if;

  if v.request_hash <> p_request_hash then
    return jsonb_build_object('state', 'conflict');
  end if;

  if v.state = 'completed' then
    return jsonb_build_object('state', 'replay',
      'response_status', v.response_status, 'response_body', v.response_body);
  end if;

  if v.state = 'unknown' then
    return jsonb_build_object('state', 'unknown',
      'response_status', v.response_status, 'response_body', v.response_body);
  end if;

  if v.started_at < now() - interval '2 minutes' then
    update private.kingshot_developer_v4_redemption_idempotency
    set state = 'unknown',
        response_status = 503,
        response_body = jsonb_build_object(
          'success', false,
          'data', null,
          'error', jsonb_build_object(
            'code', 'redemption_outcome_unknown',
            'message', 'A prior request has no definitive recorded outcome. Do not submit a new attempt.',
            'retryable', true,
            'retryHint', 'same_idempotency_key'
          ),
          'meta', jsonb_build_object(
            'apiVersion', '4',
            'requestId', 'recovered-unknown',
            'timestamp', now()
          )
        ),
        updated_at = now()
    where key_id = p_key_id and key_hash = p_key_hash
    returning * into v;

    return jsonb_build_object('state', 'unknown',
      'response_status', v.response_status, 'response_body', v.response_body);
  end if;

  return jsonb_build_object('state', 'in_progress');
end;
$$;

create or replace function public.kingshot_developer_v4_finish_redemption(
  p_key_id uuid, p_key_hash text, p_response_status integer,
  p_response_body jsonb, p_outcome_unknown boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public, private, extensions
as $$
begin
  if p_response_status not between 100 and 599
     or p_response_body is null
     or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid redemption outcome';
  end if;

  update private.kingshot_developer_v4_redemption_idempotency
  set state = case when p_outcome_unknown then 'unknown' else 'completed' end,
      response_status = p_response_status,
      response_body = p_response_body,
      updated_at = now()
  where key_id = p_key_id and key_hash = p_key_hash and state = 'processing';
  return found;
end;
$$;

-- Only release an idempotency claim when the redemption adapter proves that
-- no upstream submission was made. Unknown outcomes are never released.
create or replace function public.kingshot_developer_v4_release_redemption(
  p_key_id uuid, p_key_hash text
) returns boolean
language plpgsql
security definer
set search_path = public, private, extensions
as $$
begin
  delete from private.kingshot_developer_v4_redemption_idempotency
  where key_id = p_key_id and key_hash = p_key_hash and state = 'processing';
  return found;
end;
$$;

revoke all on function public.kingshot_developer_v4_begin_redemption(uuid, text, text) from public, anon, authenticated;
revoke all on function public.kingshot_developer_v4_finish_redemption(uuid, text, integer, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.kingshot_developer_v4_release_redemption(uuid, text) from public, anon, authenticated;
grant execute on function public.kingshot_developer_v4_begin_redemption(uuid, text, text) to service_role;
grant execute on function public.kingshot_developer_v4_finish_redemption(uuid, text, integer, jsonb, boolean) to service_role;
grant execute on function public.kingshot_developer_v4_release_redemption(uuid, text) to service_role;
