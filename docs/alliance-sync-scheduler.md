# Automatic Alliance Sync Scheduler

Alliance sync configurations, run history, leases, and seen-player state are stored in Supabase PostgreSQL. Each enabled configuration is due when `next_run_at <= now()`. The worker claims configurations through the Supabase lease RPC, validates a fresh MightPulse roster, skips players already registered in Supabase, and schedules the next normal run 24 hours later. Failed manual runs are scheduled for retry after five minutes; the five-minute GitHub schedule wakes the worker to process them.

## Why this scheduler exists

Vercel Hobby cron is limited to daily schedules, which is too infrequent for five-minute retry/backoff. The GitHub Actions workflow `.github/workflows/alliance-sync-scheduler.yml` wakes the existing server-side worker every five minutes for due alliance syncs and drains the durable manual-registration queue. It does not perform roster validation or registration in GitHub; all processing remains in the existing server-side worker.

The existing Supabase daily cron remains as a backup wake-up. Both paths use the same database lease RPC, so an alliance cannot be processed concurrently by overlapping invocations. The GitHub worker processes one alliance configuration and at most 10 not-yet-completed roster members (with up to three registrations in parallel) per invocation. Player outcomes are persisted in `alliance_sync_seen_players`; if more members remain, the configuration is released with a five-minute continuation time and the next wake-up resumes from those outcomes. Departure reconciliation runs only after the entire fresh roster has been traversed. A completed sync advances its next run by 24 hours.

## One-time secret configuration

In GitHub, open **Settings → Secrets and variables → Actions → New repository secret** and add:

- Name: `ALLIANCE_SYNC_CRON_SECRET`
- Value: the same secret configured on the Vercel production project as `ALLIANCE_SYNC_CRON_SECRET` or `CRON_SECRET`.

The workflow supports either GitHub secret name, `ALLIANCE_SYNC_CRON_SECRET` or `CRON_SECRET`. The production worker accepts a bearer token matching either configured Vercel variable, `ALLIANCE_SYNC_CRON_SECRET` or `CRON_SECRET`, so projects using both aliases do not accidentally authenticate against only the first one. Keep both values private and do not commit them to the repository. The worker rejects requests without a matching bearer token.

## Verify

1. Open **Actions → Alliance Sync Scheduler → Run workflow** to test the connection.
2. A successful run returns JSON from the worker with `ok: true` and a `results` array. A run with no due configurations is healthy and expected.
3. In the Admin Alliance Sync page, confirm each enabled alliance has a recent attempt and an updated next-run time.
4. The workflow is serialized with a concurrency group, and the database's per-alliance lease prevents overlapping work across invocations.

GitHub scheduled workflows are best-effort and can be delayed by GitHub. They are not a hard real-time scheduler. The existing Supabase daily cron remains a backup wake-up. No Neon `pg_cron` HTTP extension is required.
