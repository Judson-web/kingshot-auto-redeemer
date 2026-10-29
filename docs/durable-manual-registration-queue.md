# Durable manual alliance registration queue

The optional durable mode stores selected player IDs and per-player outcomes in the existing Supabase project. Queue rows are protected by RLS and are accessible only to the server-side service role. The existing five-minute GitHub Actions scheduler invokes the already-deployed `/api/kingshot-alliance-sync-worker?mode=manual-registration` route, so queued jobs continue after the admin page is closed without adding another Vercel serverless function.

Supabase owns this queue's state, atomic job claims, and per-player progress. The worker requires the same `ALLIANCE_SYNC_CRON_SECRET` (or fallback `CRON_SECRET`) as the existing scheduler. It revalidates the current MightPulse roster, registers only players still present in the configured kingdom/alliance, retries transient registration errors through the established registration helper, and persists each outcome. Interrupted jobs become eligible for recovery after the 120-second stale-job window.

The existing Neon database continues to own automatic alliance-sync configurations and runs. The manual registration queue no longer uses Neon, so the two systems do not share queue rows or compete over the same table. Browser-driven registration remains the default and is separate from durable queue mode.
