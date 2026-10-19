begin;

create index if not exists kingshot_developer_account_sessions_user_id_idx
  on private.kingshot_developer_account_sessions(user_id);

do $migration$
declare
  v_public_policy record;
  v_own_policy record;
  v_own_found boolean := false;
begin
  select permissive, roles, cmd, qual, with_check
  into v_public_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
    and policyname = 'Public profiles are readable';

  if not found then
    raise exception 'Expected public profiles read policy is absent; refusing profile policy cleanup';
  end if;

  if v_public_policy.permissive <> 'PERMISSIVE'
    or v_public_policy.roles::text <> '{anon,authenticated}'
    or v_public_policy.cmd <> 'SELECT'
    or coalesce(v_public_policy.qual, '') <> 'true'
    or v_public_policy.with_check is not null then
    raise exception 'Public profiles read policy differs from audited definition; refusing profile policy cleanup';
  end if;

  select permissive, roles, cmd, qual, with_check
  into v_own_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
    and policyname = 'Users can view their own profile';
  v_own_found := found;

  -- Absence of the redundant policy needs no cleanup. If present, only drop
  -- it when every material attribute matches the audited definition.
  if v_own_found then
    if v_own_policy.permissive <> 'PERMISSIVE'
      or v_own_policy.roles::text <> '{authenticated}'
      or v_own_policy.cmd <> 'SELECT'
      or lower(regexp_replace(coalesce(v_own_policy.qual, ''), '\s+', '', 'g')) <> '((selectauth.uid()asuid)=id)'
      or v_own_policy.with_check is not null then
      raise exception 'Own-profile read policy differs from audited definition; refusing profile policy cleanup';
    end if;

    execute 'drop policy "Users can view their own profile" on public.profiles';
  end if;
end;
$migration$;

commit;
