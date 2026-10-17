-- Allow one browser endpoint to subscribe to public and administrator alerts independently.
alter table public.kingshot_push_subscriptions
  drop constraint if exists kingshot_push_subscriptions_endpoint_key;
create unique index if not exists kingshot_push_subscriptions_endpoint_audience_key
  on public.kingshot_push_subscriptions(endpoint,audience);
