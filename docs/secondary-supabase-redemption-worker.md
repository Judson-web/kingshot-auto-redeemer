# Secondary Supabase redemption Edge worker

The production redemption executor runs on the secondary Supabase project. Deploy the
function from `supabase/functions/redemption-worker` to that project, not the
primary roster project.

## Required configuration

- Supabase project URL and server-side service key are provided by the Supabase
  Edge runtime.
- The database Vault must contain `secondary_redemption_sync_secret`.
- The Edge Function is deployed with JWT verification disabled because the
  scheduler sends the shared secret in the JSON body. The function validates it
  through `redemption_check_worker_secret`; do not expose that secret to clients.

## Scheduling

Production uses one pg_cron job invoking
`/functions/v1/redemption-worker` with a maximum of 50 queue items per run.
The Edge Function has a 100-second soft execution budget and stops claiming
new work before the scheduler's 120-second HTTP timeout. Queue claims remain
atomic and upstream requests remain globally paced at 500 ms. This single
scheduler entry avoids simultaneous pg_cron worker startup contention.
The cron request body obtains the shared secret from Vault at execution time.
Never commit the secret or any service key.

The previous SQL executor cron must remain disabled while these Edge worker
schedules are active. Do not enable both execution paths simultaneously.

## Safety properties

- Queue ownership is obtained through the existing atomic claim RPC.
- Request pacing is reserved through the shared `century-gift-code` pacing row.
- The pacing reservation is committed before the upstream HTTP request.
- HTTP 429 and application-level throttles set a shared cooldown.
- Transport failures and unclassified responses are finalized as uncertain;
  they must not be automatically replayed.
- Finalization checks queue ID and lease owner before writing the journal.
- Result and Discord outboxes remain the downstream delivery mechanism.

## Operational verification

Check `cron.job` and `cron.job_run_details` for the single active Edge worker job. Inspect Edge Function summary logs for claimed/completed/uncertain counts and per-status totals.
Inspect `redemption.journal`, `redemption.queue`, and
`redemption.source_pacing` together. A successful cron invocation only proves
the Edge request returned successfully; it does not prove every claimed item
was redeemed. Track upstream statuses and game-side reward confirmation
separately.
