-- Behavioral assertions for the database advisor hygiene migration.
do $test$
declare
  v_policy record;
  v_rls boolean;
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'private'
      and tablename = 'kingshot_developer_account_sessions'
      and indexname = 'kingshot_developer_account_sessions_user_id_idx'
  ) then
    raise exception 'missing supporting developer-session user_id index';
  end if;

  select permissive, roles::text as roles, cmd, qual, with_check
  into v_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
    and policyname = 'Public profiles are readable';

  if not found
    or v_policy.permissive <> 'PERMISSIVE'
    or v_policy.roles <> '{anon,authenticated}'
    or v_policy.cmd <> 'SELECT'
    or coalesce(v_policy.qual, '') <> 'true'
    or v_policy.with_check is not null then
    raise exception 'broad public profile read policy changed unexpectedly: %', row_to_json(v_policy);
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Users can view their own profile'
  ) then
    raise exception 'redundant own-profile policy was not removed';
  end if;

  select relrowsecurity into v_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relname = 'kingshot_developer_account_sessions';
  if coalesce(v_rls, false) is not true then
    raise exception 'RLS was disabled on developer sessions';
  end if;

  if has_table_privilege('anon', 'private.kingshot_developer_account_sessions', 'select')
    or has_table_privilege('authenticated', 'private.kingshot_developer_account_sessions', 'select') then
    raise exception 'client role gained SELECT privilege on developer sessions';
  end if;

  if exists (select 1 from pg_policies where schemaname = 'private' and tablename = 'kingshot_developer_account_sessions')
    or exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('mightpulse_api_key_budget', 'mightpulse_api_request_budget')) then
    raise exception 'unexpected client-facing policy was added to a private/budget table';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'mightpulse_api_key_budget' and c.relrowsecurity
  ) or not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'mightpulse_api_request_budget' and c.relrowsecurity
  ) then
    raise exception 'RLS was disabled on a MightPulse budget table';
  end if;
end;
$test$;

select 'database advisor hygiene migration integration assertions passed' as result;
