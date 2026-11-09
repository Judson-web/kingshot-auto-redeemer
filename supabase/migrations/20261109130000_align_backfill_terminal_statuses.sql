-- Keep the secondary backfill enqueue policy aligned with the Edge worker's
-- terminal-status set. These outcomes must not be retried as ordinary failures.
-- Only explicit TIMEOUT_RETRY rows (subject to the existing two-attempt cap),
-- plus genuinely missing/unattempted pairs, remain eligible.
do $$
declare
  v_definition text;
  v_terminal text := '''SUCCESS'',''RECEIVED'',''SAME TYPE EXCHANGE'',
    ''TIME ERROR'',''TIME_ERROR'',''USER INFO ERROR'',''ROLE NOT EXIST'',
    ''CDK NOT FOUND'',''CDK_NOT_FOUND'',''USAGE LIMIT'',''USAGE_LIMIT'',
    ''SIGN ERROR'',''SIGN_ERROR'',''STATE MISMATCH'',''STATE_MISMATCH'',
    ''LOGIN EXPIRED MID PROCESS'',''STOVE LV ERROR'',''RECHARGE MONEY ERROR''';
begin
  v_definition := pg_get_functiondef('public.redemption_enqueue_backfill(integer)'::regprocedure);
  v_definition := replace(
    v_definition,
    '''SUCCESS'',''RECEIVED'',''SAME TYPE EXCHANGE''',
    v_terminal
  );
  if v_definition = pg_get_functiondef('public.redemption_enqueue_backfill(integer)'::regprocedure) then
    raise exception 'Expected backfill terminal-status guard was not found';
  end if;
  execute v_definition;
end
$$;
