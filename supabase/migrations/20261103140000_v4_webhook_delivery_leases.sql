-- Atomic webhook delivery leases and fenced completion/retry operations.
alter table public.kingshot_developer_webhook_deliveries
  add column if not exists lease_token uuid,
  add column if not exists lease_until timestamptz;

create index if not exists kingshot_developer_webhook_claim_idx
  on public.kingshot_developer_webhook_deliveries(next_attempt_at, lease_until, created_at)
  where delivered_at is null;

create or replace function public.kingshot_developer_claim_webhook_deliveries(
  p_limit integer default 20,
  p_lease_seconds integer default 90
)
returns table(
  id uuid,
  webhook_id uuid,
  event_id uuid,
  event_type text,
  payload jsonb,
  attempt_count integer,
  lease_token uuid
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  with picked as (
    select d.id
    from public.kingshot_developer_webhook_deliveries d
    where d.delivered_at is null
      and d.next_attempt_at <= clock_timestamp()
      and (d.lease_until is null or d.lease_until <= clock_timestamp())
    order by d.next_attempt_at asc, d.created_at asc
    for update skip locked
    limit least(greatest(coalesce(p_limit, 20), 1), 20)
  ),
  claimed as (
    update public.kingshot_developer_webhook_deliveries d
    set lease_token = gen_random_uuid(),
        lease_until = clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 90), 30), 300)),
        attempt_count = d.attempt_count + 1
    from picked
    where d.id = picked.id
    returning d.id, d.webhook_id, d.event_id, d.event_type, d.payload, d.attempt_count, d.lease_token
  )
  select c.id, c.webhook_id, c.event_id, c.event_type, c.payload, c.attempt_count, c.lease_token
  from claimed c;
end;
$$;

create or replace function public.kingshot_developer_finish_webhook_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_status integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kingshot_developer_webhook_deliveries
  set delivered_at = clock_timestamp(),
      last_status = p_status,
      last_error = null,
      lease_token = null,
      lease_until = null
  where id = p_delivery_id
    and lease_token = p_lease_token
    and delivered_at is null;
  return found;
end;
$$;

create or replace function public.kingshot_developer_retry_webhook_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_next_attempt_at timestamptz,
  p_status integer,
  p_error text,
  p_terminal boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kingshot_developer_webhook_deliveries
  set next_attempt_at = greatest(coalesce(p_next_attempt_at, clock_timestamp()), clock_timestamp()),
      delivered_at = case when coalesce(p_terminal, false) then clock_timestamp() else null end,
      last_status = p_status,
      last_error = left(coalesce(p_error, 'delivery failed'), 300),
      lease_token = null,
      lease_until = null
  where id = p_delivery_id
    and lease_token = p_lease_token
    and delivered_at is null;
  return found;
end;
$$;

revoke all on function public.kingshot_developer_claim_webhook_deliveries(integer, integer) from public, anon, authenticated;
revoke all on function public.kingshot_developer_finish_webhook_delivery(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.kingshot_developer_retry_webhook_delivery(uuid, uuid, timestamptz, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.kingshot_developer_claim_webhook_deliveries(integer, integer) to service_role;
grant execute on function public.kingshot_developer_finish_webhook_delivery(uuid, uuid, integer) to service_role;
grant execute on function public.kingshot_developer_retry_webhook_delivery(uuid, uuid, timestamptz, integer, text, boolean) to service_role;
