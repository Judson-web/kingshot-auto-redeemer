create schema if not exists private;

create table if not exists private.alliance_sync_scheduler_config (
  id boolean primary key default true check (id),
  token_plain text not null,
  created_at timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

revoke all on table private.alliance_sync_scheduler_config from public, anon, authenticated;

create or replace function public.verify_alliance_sync_scheduler_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select coalesce(
    p_token is not null
    and length(p_token) between 32 and 512
    and exists (
      select 1
      from private.alliance_sync_scheduler_config c
      where c.id = true
        and c.token_plain = p_token
    ),
    false
  );
$$;

revoke all on function public.verify_alliance_sync_scheduler_token(text) from public, anon, authenticated;
grant execute on function public.verify_alliance_sync_scheduler_token(text) to service_role;
