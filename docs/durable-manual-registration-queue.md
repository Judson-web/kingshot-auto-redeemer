# Durable manual alliance registration queue

The optional durable mode stores selected player IDs and per-player outcomes in Neon. The existing five-minute GitHub Actions scheduler invokes `/api/kingshot-alliance-manual-registration-worker`, so queued jobs continue after the admin page is closed.

The worker accepts POST requests only and requires the same `ALLIANCE_SYNC_CRON_SECRET` (or fallback `CRON_SECRET`) as the existing scheduler. It claims jobs with an optimistic timestamp compare-and-swap, revalidates the current MightPulse roster, registers only players still present in the configured kingdom/alliance, persists each result, and limits work per invocation. Interrupted jobs become eligible for recovery after the shared 120-second stale-job window.

Browser-driven registration remains the default and processes selected players in the browser while that page stays open. The background worker is used only when the administrator explicitly selects durable queue mode. It does not change automatic alliance sync configurations or schedules.
