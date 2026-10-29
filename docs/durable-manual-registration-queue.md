# Durable manual alliance registration queue

The optional durable mode stores selected player IDs and per-player outcomes in Neon. The existing five-minute GitHub Actions scheduler invokes the already-deployed `/api/kingshot-alliance-sync-worker?mode=manual-registration` route, so queued jobs continue after the admin page is closed without adding another Vercel serverless function.

The worker requires the same `ALLIANCE_SYNC_CRON_SECRET` (or fallback `CRON_SECRET`) as the existing scheduler. It claims jobs using a timestamp compare-and-swap, revalidates the current MightPulse roster, registers only players still present in the configured kingdom/alliance, retries transient registration errors through the established registration helper, and persists per-player outcomes. Interrupted jobs become eligible for recovery after the shared 120-second stale-job window.

Browser-driven registration remains the default and processes selected players in the browser while that page stays open. The background worker is used only when the administrator explicitly selects durable queue mode. It does not change automatic alliance sync configurations or schedules.
