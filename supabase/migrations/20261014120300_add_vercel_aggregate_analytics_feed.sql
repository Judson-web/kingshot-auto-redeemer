-- Daily aggregate-only Vercel Web Analytics snapshots for the private analytics dashboard.
create table if not exists public.kingshot_vercel_analytics_daily (
  date_utc date primary key,
  collected_at timestamptz not null,
  snapshot_sha256 text not null,
  data jsonb not null,
  inserted_at timestamptz not null default now()
);
alter table public.kingshot_vercel_analytics_daily enable row level security;
revoke all on table public.kingshot_vercel_analytics_daily from anon, authenticated;
grant select, insert, update on table public.kingshot_vercel_analytics_daily to service_role;
comment on table public.kingshot_vercel_analytics_daily is
  'Daily aggregate-only Vercel Web Analytics snapshots. Contains no raw IP addresses or per-visitor records.';

create or replace function public.kingshot_visitor_analytics(p_days integer default 7)
returns jsonb language sql stable security definer set search_path = public
as $$
  with bounds as (
    select date_trunc('day', now()) - (greatest(1, least(coalesce(p_days, 7), 30) - 1) || ' days')::interval as start_at
  ),
  filtered as (
    select e.* from public.kingshot_visitor_events e, bounds b
    where e.occurred_at >= b.start_at and e.occurred_at < now()
  ),
  daily as (
    select date_trunc('day', occurred_at)::date as day, count(*)::bigint as views,
           count(distinct ip_address)::bigint as visitors from filtered group by 1 order by 1
  ),
  countries as (
    select coalesce(nullif(country_code,''),'Unknown') as name, count(*)::bigint as value from filtered group by 1 order by value desc limit 12
  ),
  pages as (
    select path as name, count(*)::bigint as value from filtered group by path order by value desc limit 12
  ),
  referrers as (
    select coalesce(nullif(referrer_host,''),'Direct / unknown') as name, count(*)::bigint as value from filtered group by 1 order by value desc limit 12
  ),
  devices as (
    select coalesce(nullif(device_type,''),'unknown') as name, count(*)::bigint as value from filtered group by 1 order by value desc
  ),
  browsers as (
    select coalesce(nullif(browser,''),'Other') as name, count(*)::bigint as value from filtered group by 1 order by value desc limit 10
  ),
  recent as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'occurredAt', occurred_at, 'ipAddress', host(ip_address), 'country', country_code,
      'region', region, 'city', city, 'path', path, 'referrerHost', referrer_host,
      'browser', browser, 'operatingSystem', operating_system, 'deviceType', device_type,
      'userAgent', user_agent) order by occurred_at desc), '[]'::jsonb) as rows
    from (select * from filtered order by occurred_at desc limit 100) r
  ),
  vercel as (
    select coalesce(jsonb_agg(jsonb_build_object('dateUtc', date_utc, 'collectedAt', collected_at,
      'sha256', snapshot_sha256, 'data', data) order by date_utc desc), '[]'::jsonb) as rows
    from public.kingshot_vercel_analytics_daily, bounds b where date_utc >= b.start_at::date
  )
  select jsonb_build_object(
    'periodDays', greatest(1, least(coalesce(p_days, 7), 30)), 'generatedAt', now(),
    'views', (select count(*) from filtered), 'uniqueIps', (select count(distinct ip_address) from filtered),
    'countriesCount', (select count(distinct country_code) from filtered where country_code is not null),
    'pagesCount', (select count(distinct path) from filtered),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day',day,'views',views,'visitors',visitors) order by day) from daily),'[]'::jsonb),
    'countries', coalesce((select jsonb_agg(jsonb_build_object('name',name,'value',value)) from countries),'[]'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('name',name,'value',value)) from pages),'[]'::jsonb),
    'referrers', coalesce((select jsonb_agg(jsonb_build_object('name',name,'value',value)) from referrers),'[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('name',name,'value',value)) from devices),'[]'::jsonb),
    'browsers', coalesce((select jsonb_agg(jsonb_build_object('name',name,'value',value)) from browsers),'[]'::jsonb),
    'recent', (select rows from recent), 'vercelDaily', (select rows from vercel)
  );
$$;
revoke all on function public.kingshot_visitor_analytics(integer) from public, anon, authenticated;
grant execute on function public.kingshot_visitor_analytics(integer) to service_role;
