-- Publish safe aggregate metrics from first-party visitor telemetry.
-- Only service_role may call this function. No event-level rows or direct identifiers are returned.
create or replace function public.kingshot_public_visitor_analytics()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select jsonb_build_object(
    'generated_at', now(),
    'source', 'first_party_visitor_tracker',
    'retention_days', 30,
    'metric_definition', 'pageviews are accepted first-party page-view events; they are not unique visitors or sessions',
    'totals', jsonb_build_object(
      'last_24h', (select count(*) from public.kingshot_visitor_events where occurred_at >= now() - interval '24 hours'),
      'last_7d', (select count(*) from public.kingshot_visitor_events where occurred_at >= now() - interval '7 days'),
      'last_30d', (select count(*) from public.kingshot_visitor_events where occurred_at >= now() - interval '30 days')
    ),
    'hourly', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'hour', to_char(b.bucket, 'YYYY-MM-DD"T"HH24:00:00"Z"'),
        'pageviews', coalesce(c.pageviews, 0)
      ) order by b.bucket), '[]'::jsonb)
      from generate_series(
        date_trunc('hour', now()) - interval '23 hours',
        date_trunc('hour', now()),
        interval '1 hour'
      ) as b(bucket)
      left join (
        select date_trunc('hour', occurred_at) as bucket, count(*) as pageviews
        from public.kingshot_visitor_events
        where occurred_at >= date_trunc('hour', now()) - interval '23 hours'
          and occurred_at < date_trunc('hour', now()) + interval '1 hour'
        group by 1
      ) c on c.bucket = b.bucket
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(d.day_utc, 'YYYY-MM-DD'),
        'pageviews', coalesce(c.pageviews, 0)
      ) order by d.day_utc), '[]'::jsonb)
      from generate_series(
        date_trunc('day', now() at time zone 'UTC') - interval '6 days',
        date_trunc('day', now() at time zone 'UTC'),
        interval '1 day'
      ) as d(day_utc)
      left join (
        select date_trunc('day', occurred_at at time zone 'UTC') as day_utc, count(*) as pageviews
        from public.kingshot_visitor_events
        where occurred_at >= (date_trunc('day', now() at time zone 'UTC') - interval '6 days') at time zone 'UTC'
          and occurred_at < (date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC'
        group by 1
      ) c on c.day_utc = d.day_utc
    ),
    'pages', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'pageviews', pageviews) order by pageviews desc, label), '[]'::jsonb)
      from (
        select left(path, 120) as label, count(*) as pageviews
        from public.kingshot_visitor_events
        where occurred_at >= now() - interval '7 days'
        group by left(path, 120)
        having count(*) >= 3
        order by count(*) desc, left(path, 120)
        limit 8
      ) grouped
    ),
    'countries', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'pageviews', pageviews) order by pageviews desc, label), '[]'::jsonb)
      from (
        select left(country_code, 40) as label, count(*) as pageviews
        from public.kingshot_visitor_events
        where occurred_at >= now() - interval '7 days' and country_code is not null
        group by left(country_code, 40)
        having count(*) >= 3
        order by count(*) desc, left(country_code, 40)
        limit 8
      ) grouped
    ),
    'referrers', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'pageviews', pageviews) order by pageviews desc, label), '[]'::jsonb)
      from (
        select left(referrer_host, 100) as label, count(*) as pageviews
        from public.kingshot_visitor_events
        where occurred_at >= now() - interval '7 days' and referrer_host is not null
        group by left(referrer_host, 100)
        having count(*) >= 3
        order by count(*) desc, left(referrer_host, 100)
        limit 8
      ) grouped
    ),
    'devices', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'pageviews', pageviews) order by pageviews desc, label), '[]'::jsonb)
      from (
        select left(coalesce(device_type, 'Unknown'), 40) as label, count(*) as pageviews
        from public.kingshot_visitor_events
        where occurred_at >= now() - interval '7 days'
        group by left(coalesce(device_type, 'Unknown'), 40)
        having count(*) >= 3
        order by count(*) desc, left(coalesce(device_type, 'Unknown'), 40)
        limit 8
      ) grouped
    ),
    'browsers', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'pageviews', pageviews) order by pageviews desc, label), '[]'::jsonb)
      from (
        select left(coalesce(browser, 'Unknown'), 60) as label, count(*) as pageviews
        from public.kingshot_visitor_events
        where occurred_at >= now() - interval '7 days'
        group by left(coalesce(browser, 'Unknown'), 60)
        having count(*) >= 3
        order by count(*) desc, left(coalesce(browser, 'Unknown'), 60)
        limit 8
      ) grouped
    )
  );
$function$;

revoke all on function public.kingshot_public_visitor_analytics() from public, anon, authenticated;
grant execute on function public.kingshot_public_visitor_analytics() to service_role;
