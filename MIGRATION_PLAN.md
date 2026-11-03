# Cloudflare-native migration

## Current checkpoint
- Branch: `migration/cloudflare-native-runtime`
- Baseline: `21814aa430ddcdfba2ca4cf08f43be6c3ee92105`
- Production is untouched. No DNS changes, domain cutover, or production deployment are authorized.
- Existing domain is redirect-only, not an application host, API origin, or runtime dependency.
- Vercel is excluded entirely: no bridge, fallback, runtime, or deployment dependency.

## Agreed architecture
- Cloudflare Workers: application/API runtime.
- Cloudflare Workers Assets: frontend/static assets.
- Supabase: primary application database and existing application services.
- Supabase `pg_cron`: default scheduler for database-led jobs and dispatches.
- Cloudflare Queues/Workflows: durable asynchronous execution where needed, not a second general-purpose scheduler.
- Neon: preserve historical records and the independent redemption recovery journal.
- Existing domain: redirect only to the selected Cloudflare destination.

## Safety constraints
- Preserve API paths and response contracts wherever possible.
- Preserve redemption idempotency, four-shard coordination, durable leases, shared MightPulse quota/cooldown handling, and recovery journaling.
- Preview must not write to production Supabase. Writes stay disabled until a dedicated staging database or equivalent isolation is configured.
- No production DNS/domain changes or cutover without explicit approval.
- Do not merge PR #341 as part of this work.

## Migration sequence
1. Native Worker router, shared runtime adapters, preview safety.
2. Read-only endpoints: health, Discord avatar/user, player lookup/profile, registration status.
3. Registration, account/Discord OAuth, developer V3/V4 APIs, keys, quotas, webhooks.
4. Redemption engine, Neon journal, Supabase RPCs, worker leases/shards, provider cooldowns.
5. Discord interactions, support, notifications, admin operations.
6. Supabase `pg_cron` schedules; secured Worker dispatch for jobs requiring Worker execution.
7. Contract/integration/security tests, preview validation, then separately approved cutover planning.

## Initial implementation checkpoint
- Removed the Vercel legacy API bridge from the Worker.
- Removed `LEGACY_API_ORIGIN` from Wrangler configuration.
- Unported API routes return explicit `501 route_not_migrated` responses instead of silently forwarding elsewhere.
- Existing native read-only endpoints remain available.
- Added native `/api/kingshot-player?milestone=count` using the existing `kingshot_public_registration_count` Supabase RPC, preserving its response contract and cache policy.
- Added a Worker-native MightPulse adapter with environment-bound key slots, atomic Supabase request reservations, per-key cooldowns, provider-block sweep accounting, fail-closed quota-store behavior, and key failover.
- Ported the base `/api/kingshot-player?id=...` read-only lookup route with ID validation, rate limiting, provider identity verification, and compatible response metadata. It performs no registered-profile writes.
- Ported `profile=detail` with hero, governor gear, ranks, kingdom context, board-rank extraction, alliance roster enrichment, in-flight deduplication, and a short in-memory cache. Optional enrichment failures preserve the public base profile.
- Supabase telemetry writes are disabled by default in preview.
- This is an intermediate migration checkpoint, not a production-ready replacement.

## Manual redemption migration

- Native Worker route: `POST /api/kingshot-redeem`.
- Preserves the Kingshot form payload and MD5 signature using Workers' supported `node:crypto` implementation.
- Requires Supabase write mode, Supabase service-role credentials, the Kingshot API secret, and the independent Neon recovery-journal connection.
- Reserves the shared Supabase redemption pacing slot before attempting a redemption.
- Writes a Neon `in_flight` intent before atomic Supabase redemption and recovery claims.
- Records the confirmed upstream result in Neon before completing Supabase recovery/history writes.
- Ambiguous timeout, non-JSON, upstream gateway, or journal persistence outcomes are quarantined as `needs_review`; the route never automatically replays the upstream request.
- Preview remains read-only: `SUPABASE_WRITE_MODE` stays disabled and smoke tests assert the route refuses writes.
- No production redemption, deployment, DNS change, or cutover was performed.
