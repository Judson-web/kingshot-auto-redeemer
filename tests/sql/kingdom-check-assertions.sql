-- Behavioral assertions for the V4 kingdom-check migration.
do $test$
declare
  v_result jsonb;
  v_retry timestamptz;
  v_first_retry timestamptz;
  v_raised boolean := false;
begin
  insert into public.kingshot_autoredeem (
    player_id, enabled, stale, kingdom_id, last_kingdom_check_at,
    kingdom_check_claimed_at, updated_at, kingdom_check_retry_after_at
  ) values (
    'migration-integration-player', true, false, '100',
    clock_timestamp() - interval '2 days',
    null, clock_timestamp(), clock_timestamp() + interval '2 hours'
  );

  v_result := public.claim_kingshot_kingdom_reset_check('migration-integration-player');
  if coalesce((v_result ->> 'claimed')::boolean, false)
    or v_result ->> 'reason' <> 'RETRY_WINDOW' then
    raise exception 'scheduled claim did not respect retry-after: %', v_result;
  end if;

  v_result := public.claim_kingshot_kingdom_manual_check('migration-integration-player');
  if coalesce((v_result ->> 'claimed')::boolean, false)
    or v_result ->> 'reason' <> 'RETRY_WINDOW' then
    raise exception 'manual claim did not respect retry-after: %', v_result;
  end if;

  update public.kingshot_autoredeem
  set kingdom_check_retry_after_at = null,
      kingdom_check_claimed_at = null,
      last_kingdom_check_at = clock_timestamp() - interval '2 days'
  where player_id = 'migration-integration-player';

  v_result := public.claim_kingshot_kingdom_reset_check('migration-integration-player');
  if not coalesce((v_result ->> 'claimed')::boolean, false) then
    raise exception 'scheduled claim should succeed for an eligible player: %', v_result;
  end if;

  v_result := public.claim_kingshot_kingdom_manual_check('migration-integration-player');
  if coalesce((v_result ->> 'claimed')::boolean, false)
    or v_result ->> 'reason' <> 'ALREADY_CLAIMED' then
    raise exception 'manual claim did not respect the active lease: %', v_result;
  end if;

  v_first_retry := clock_timestamp() + interval '2 hours';
  v_result := public.defer_kingshot_kingdom_reset_check(
    'migration-integration-player', v_first_retry
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    raise exception 'defer RPC failed: %', v_result;
  end if;

  select kingdom_check_retry_after_at into v_retry
  from public.kingshot_autoredeem
  where player_id = 'migration-integration-player';

  if v_retry < v_first_retry then
    raise exception 'defer RPC did not persist the requested retry window';
  end if;

  perform public.defer_kingshot_kingdom_reset_check(
    'migration-integration-player', clock_timestamp() + interval '1 hour'
  );

  select kingdom_check_retry_after_at into v_retry
  from public.kingshot_autoredeem
  where player_id = 'migration-integration-player';

  if v_retry <> v_first_retry then
    raise exception 'a later retry window was overwritten: expected %, got %', v_first_retry, v_retry;
  end if;

  select kingdom_check_claimed_at into v_retry
  from public.kingshot_autoredeem
  where player_id = 'migration-integration-player';

  if v_retry is not null then
    raise exception 'defer RPC failed to release the claim';
  end if;

  v_raised := false;
  begin
    perform public.defer_kingshot_kingdom_reset_check(
      'migration-integration-player', clock_timestamp() - interval '1 minute'
    );
  exception when sqlstate '22023' then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'defer RPC accepted a retry timestamp in the past';
  end if;

  v_result := public.record_kingshot_kingdom_revalidation(
    'migration-integration-player', '101', 'Integration Test Player', null
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    raise exception 'successful revalidation failed: %', v_result;
  end if;

  if exists (
    select 1 from public.kingshot_autoredeem
    where player_id = 'migration-integration-player'
      and (kingdom_check_retry_after_at is not null
        or kingdom_check_claimed_at is not null
        or kingdom_id <> '101'
        or stale)
  ) then
    raise exception 'successful revalidation failed to clear retry/claim or update player state';
  end if;

  if not exists (
    select 1 from public.kingshot_player_events
    where player_id = 'migration-integration-player'
      and event_type = 'kingdom_changed'
      and old_kingdom_id = '100'
      and new_kingdom_id = '101'
  ) then
    raise exception 'successful revalidation did not record the kingdom change event';
  end if;

  if has_function_privilege('anon', 'public.claim_kingshot_kingdom_reset_check(text)', 'execute')
    or has_function_privilege('authenticated', 'public.claim_kingshot_kingdom_reset_check(text)', 'execute')
    or not has_function_privilege('service_role', 'public.claim_kingshot_kingdom_reset_check(text)', 'execute') then
    raise exception 'scheduled claim RPC grants are not service-role-only';
  end if;

  if has_function_privilege('anon', 'public.claim_kingshot_kingdom_manual_check(text)', 'execute')
    or has_function_privilege('authenticated', 'public.claim_kingshot_kingdom_manual_check(text)', 'execute')
    or not has_function_privilege('service_role', 'public.claim_kingshot_kingdom_manual_check(text)', 'execute') then
    raise exception 'manual claim RPC grants are not service-role-only';
  end if;

  if has_function_privilege('anon', 'public.defer_kingshot_kingdom_reset_check(text,timestamp with time zone)', 'execute')
    or has_function_privilege('authenticated', 'public.defer_kingshot_kingdom_reset_check(text,timestamp with time zone)', 'execute')
    or not has_function_privilege('service_role', 'public.defer_kingshot_kingdom_reset_check(text,timestamp with time zone)', 'execute') then
    raise exception 'defer RPC grants are not service-role-only';
  end if;
end;
$test$;

select 'V4 kingdom-check migration integration assertions passed' as result;
