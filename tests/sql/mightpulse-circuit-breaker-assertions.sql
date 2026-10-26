-- Validate privilege boundaries and circuit state transitions.
do $assert$
declare
  v_result jsonb;
begin
  if has_table_privilege('anon', 'private.mightpulse_provider_circuit_breaker', 'SELECT')
     or has_table_privilege('authenticated', 'private.mightpulse_provider_circuit_breaker', 'SELECT')
     or has_table_privilege('service_role', 'private.mightpulse_provider_circuit_breaker', 'SELECT') then
    raise exception 'Circuit state table is directly accessible to an API role';
  end if;

  if has_function_privilege('anon', 'public.check_mightpulse_provider_circuit_breaker()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.check_mightpulse_provider_circuit_breaker()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.check_mightpulse_provider_circuit_breaker()', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_mightpulse_provider_block_sweep()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_mightpulse_provider_block_sweep()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.record_mightpulse_provider_block_sweep()', 'EXECUTE')
     or has_function_privilege('anon', 'public.reset_mightpulse_provider_circuit_breaker()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.reset_mightpulse_provider_circuit_breaker()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.reset_mightpulse_provider_circuit_breaker()', 'EXECUTE') then
    raise exception 'Circuit RPC privileges are not least-privilege';
  end if;

  if not (select relrowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'private'
            and c.relname = 'mightpulse_provider_circuit_breaker') then
    raise exception 'Circuit table RLS is not enabled';
  end if;

  v_result := public.check_mightpulse_provider_circuit_breaker();
  if v_result->>'open' <> 'false' or (v_result->>'failureCount')::integer <> 0 then
    raise exception 'Circuit should start closed';
  end if;

  v_result := public.record_mightpulse_provider_block_sweep();
  if v_result->>'open' <> 'false' or (v_result->>'failureCount')::integer <> 1 then
    raise exception 'First provider-wide failure should not open the circuit';
  end if;
  v_result := public.record_mightpulse_provider_block_sweep();
  if v_result->>'open' <> 'false' or (v_result->>'failureCount')::integer <> 2 then
    raise exception 'Second provider-wide failure should not open the circuit';
  end if;
  v_result := public.record_mightpulse_provider_block_sweep();
  if v_result->>'open' <> 'true' or (v_result->>'failureCount')::integer <> 3 then
    raise exception 'Third provider-wide failure should open the circuit';
  end if;

  v_result := public.check_mightpulse_provider_circuit_breaker();
  if v_result->>'open' <> 'true' or (v_result->>'retryAfterMs')::bigint <= 0 then
    raise exception 'Open circuit should return positive retry guidance';
  end if;

  v_result := public.reset_mightpulse_provider_circuit_breaker();
  if v_result->>'reset' <> 'true' then
    raise exception 'Reset RPC did not confirm reset';
  end if;
  v_result := public.check_mightpulse_provider_circuit_breaker();
  if v_result->>'open' <> 'false' or (v_result->>'failureCount')::integer <> 0 then
    raise exception 'Reset should close the circuit';
  end if;
end
$assert$;
