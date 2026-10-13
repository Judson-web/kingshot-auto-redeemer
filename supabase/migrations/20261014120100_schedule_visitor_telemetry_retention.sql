select cron.schedule(
  'purge-kingshot-visitor-telemetry',
  '17 3 * * *',
  $$delete from public.kingshot_visitor_events where expires_at <= now()$$
);
