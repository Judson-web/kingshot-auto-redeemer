-- Exercise the actual migrated PostgreSQL functions and security boundaries.
do $$
declare
  v_key uuid := '11111111-1111-4111-8111-111111111111';
  v_hash text := repeat('a', 64);
  v_request text := repeat('b', 64);
  v_other_request text := repeat('c', 64);
  v_result jsonb;
  v_delivery record;
  v_id uuid;
  v_token uuid;
  i integer;
begin
  insert into private.kingshot_developer_api_keys(id) values (v_key);

  v_result := public.kingshot_developer_v4_begin_redemption(v_key, v_hash, v_request);
  if v_result->>'state' <> 'started' then raise exception 'expected started, got %', v_result; end if;

  v_result := public.kingshot_developer_v4_begin_redemption(v_key, v_hash, v_other_request);
  if v_result->>'state' <> 'conflict' then raise exception 'expected conflict, got %', v_result; end if;

  if not public.kingshot_developer_v4_finish_redemption(v_key, v_hash, 200, '{"success":true}'::jsonb, false) then
    raise exception 'expected idempotency completion';
  end if;
  v_result := public.kingshot_developer_v4_begin_redemption(v_key, v_hash, v_request);
  if v_result->>'state' <> 'replay' or (v_result->>'response_status')::integer <> 200 then
    raise exception 'expected completed replay, got %', v_result;
  end if;

  v_hash := repeat('d', 64);
  v_result := public.kingshot_developer_v4_begin_redemption(v_key, v_hash, v_request);
  if v_result->>'state' <> 'started' then raise exception 'expected second claim'; end if;
  if not public.kingshot_developer_v4_release_redemption(v_key, v_hash) then raise exception 'expected safe release'; end if;
  v_result := public.kingshot_developer_v4_begin_redemption(v_key, v_hash, v_request);
  if v_result->>'state' <> 'started' then raise exception 'released claim was not reusable'; end if;

  update private.kingshot_developer_v4_redemption_idempotency
    set started_at = now() - interval '3 minutes'
    where key_id = v_key and key_hash = v_hash;
  v_result := public.kingshot_developer_v4_begin_redemption(v_key, v_hash, v_request);
  if v_result->>'state' <> 'unknown' then raise exception 'stale claim must become unknown, got %', v_result; end if;
  v_result := public.kingshot_developer_v4_begin_redemption(v_key, v_hash, v_request);
  if v_result->>'state' <> 'unknown' then raise exception 'unknown outcome must remain quarantined'; end if;

  if has_function_privilege('anon', 'public.kingshot_developer_v4_begin_redemption(uuid,text,text)', 'EXECUTE') then
    raise exception 'anon must not execute idempotency RPC';
  end if;
  if not has_function_privilege('service_role', 'public.kingshot_developer_v4_begin_redemption(uuid,text,text)', 'EXECUTE') then
    raise exception 'service_role must execute idempotency RPC';
  end if;

  insert into public.kingshot_developer_webhook_deliveries
    (webhook_id, event_id, event_type, payload)
  values (gen_random_uuid(), gen_random_uuid(), 'redemption.completed', '{"ok":true}')
  returning id into v_id;

  select * into v_delivery
  from public.kingshot_developer_webhook_claim_deliveries(1, 90);
  if v_delivery.id is distinct from v_id or v_delivery.attempt_count <> 1 or v_delivery.lease_token is null then
    raise exception 'webhook claim did not issue first lease: %', row_to_json(v_delivery);
  end if;
  if public.kingshot_developer_webhook_finish_delivery(v_id, gen_random_uuid(), true, false, 200, null, null) then
    raise exception 'wrong lease token must not finish delivery';
  end if;
  if not public.kingshot_developer_webhook_finish_delivery(v_id, v_delivery.lease_token, true, false, 200, null, null) then
    raise exception 'valid lease token must finish delivery';
  end if;

  insert into public.kingshot_developer_webhook_deliveries
    (webhook_id, event_id, event_type, payload)
  values (gen_random_uuid(), gen_random_uuid(), 'redemption.unknown', '{"ok":false}')
  returning id into v_id;

  for i in 1..8 loop
    select * into v_delivery
    from public.kingshot_developer_webhook_claim_deliveries(1, 90);
    if v_delivery.id is distinct from v_id then
      raise exception 'retry % claimed unexpected delivery %', i, v_delivery.id;
    end if;
    if v_delivery.attempt_count <> i then
      raise exception 'attempt count mismatch: expected %, got %', i, v_delivery.attempt_count;
    end if;
    if not public.kingshot_developer_webhook_finish_delivery(
      v_id, v_delivery.lease_token, false, false, 503, 'test retry', now() - interval '1 second'
    ) then raise exception 'could not finish retry attempt %', i; end if;
  end loop;

  if not exists (
    select 1 from public.kingshot_developer_webhook_deliveries
    where id = v_id and attempt_count = 8 and delivered_at is not null
  ) then raise exception 'delivery must become terminal exactly at attempt eight'; end if;

  if has_function_privilege('anon', 'public.kingshot_developer_webhook_claim_deliveries(integer,integer)', 'EXECUTE') then
    raise exception 'anon must not execute webhook claim RPC';
  end if;
  if not has_function_privilege('service_role', 'public.kingshot_developer_webhook_claim_deliveries(integer,integer)', 'EXECUTE') then
    raise exception 'service_role must execute webhook claim RPC';
  end if;
end $$;

select 'native V4 migration integration assertions passed' as result;
