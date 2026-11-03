-- Durable, lease-based V4 webhook delivery claims for the native Cloudflare dispatcher.
alter table public.kingshot_developer_webhook_deliveries
  add column if not exists lease_token uuid,
  add column if not exists locked_until timestamptz;

create index if not exists kingshot_developer_webhook_claim_idx
  on public.kingshot_developer_webhook_deliveries(next_attempt_at, created_at)
  where delivered_at is null;

create or replace function public.kingshot_developer_webhook_claim_deliveries(
  p_limit integer default 10,
  p_lease_seconds integer default 90
)
returns table (
  id uuid,
  webhook_id uuid,
  event_id uuid,
  event_type text,
  payload jsonb,
  attempt_count integer,
  lease_token uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, private, extensions
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 25
     or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception using errcode = '22023', message = 'Invalid webhook delivery claim bounds';
  end if;

  return query
  with due as (
    select d.id
    from public.kingshot_developer_webhook_deliveries d
    where d.delivered_at is null
      and d.next_attempt_at <= clock_timestamp()
      and (d.locked_until is null or d.locked_until < clock_timestamp())
    order by d.next_attempt_at asc, d.created_at asc
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.kingshot_developer_webhook_deliveries d
    set attempt_count = d.attempt_count + 1,
        lease_token = gen_random_uuid(),
        locked_until = clock_timestamp() + make_interval(secs => p_lease_seconds)
    from due
    where d.id = due.id
    returning d.id, d.webhook_id, d.event_id, d.event_type, d.payload, d.attempt_count, d.lease_token, d.created_at
  )
  select claimed.id, claimed.webhook_id, claimed.event_id, claimed.event_type,
         claimed.payload, claimed.attempt_count, claimed.lease_token, claimed.created_at
  from claimed;
end;
$$;

create or replace function public.kingshot_developer_webhook_finish_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_delivered boolean,
  p_terminal boolean,
  p_status integer,
  p_error text,
  p_retry_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, private, extensions
as $$
begin
  if p_delivery_id is null or p_lease_token is null
     or p_status is not null and p_status not between 100 and 599
     or p_delivered is null or p_terminal is null then
    raise exception using errcode = '22023', message = 'Invalid webhook delivery outcome';
  end if;

  update public.kingshot_developer_webhook_deliveries d
  set attempt_count = d.attempt_count + 1,
      delivered_at = case
        when p_delivered or p_terminal or d.attempt_count + 1 >= 8 then clock_timestamp()
        else null
      end,
      last_status = p_status,
      last_error = case when p_delivered then null else left(coalesce(p_error, 'delivery failed'), 300) end,
      next_attempt_at = coalesce(p_retry_at, d.next_attempt_at),
      lease_token = null,
      locked_until = null
  where d.id = p_delivery_id
    and d.lease_token = p_lease_token
    and d.delivered_at is null;

  return found;
end;
$$;

revoke all on function public.kingshot_developer_webhook_claim_deliveries(integer, integer) from public, anon, authenticated;
revoke all on function public.kingshot_developer_webhook_finish_delivery(uuid, uuid, boolean, boolean, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.kingshot_developer_webhook_claim_deliveries(integer, integer) to service_role;
grant execute on function public.kingshot_developer_webhook_finish_delivery(uuid, uuid, boolean, boolean, integer, text, timestamptz) to service_role;
