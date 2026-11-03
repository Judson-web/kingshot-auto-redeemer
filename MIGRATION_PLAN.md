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
- Ambiguous timeout, non-JSON, upstream gateway, or journal persistence outcomes are quarantined as `needs_review` in both Neon and Supabase; the route never automatically replays the upstream request.
- Preview remains read-only: `SUPABASE_WRITE_MODE` stays disabled and smoke tests assert the route refuses writes.
- No production redemption, deployment, DNS change, or cutover was performed.
- Latest validation includes a follow-up syntax fix for synchronized Neon/Supabase uncertainty markers; rerun the full non-deploying CI before treating this revision as green.


## Native V4 redemption checkpoint

- Added `POST /api/v4/redemptions` to the native Worker router with the existing V4 response envelope and `redemptions:write` scope enforcement.
- Reuses the native redemption adapter so provider pacing, Neon intent journaling, atomic Supabase claims, confirmed-result recording, and uncertain-outcome quarantine remain one shared implementation.
- V4 accepts the documented 1–64 character gift-code format; the public manual redemption route retains its existing 6–32 character validation and per-IP limiter.
- Added a separate V4 idempotency ledger and RPCs. Keys are namespaced and hashed, request bodies are fingerprinted, replay responses receive fresh request IDs, and mismatched bodies are rejected.
- Unknown V4 idempotency outcomes never expire or reopen automatically. Stale processing claims transition to an explicit unknown state; only provably pre-submission failures may release a claim.
- V4 idempotency is optional per the existing OpenAPI contract. Neon/Supabase redemption recovery remains the independent protection against duplicate player/code submissions.
- Tests mock Supabase authorization and idempotency RPCs. Wrangler preview remains write-disabled; the V4 redemption route now checks this before quota authorization or idempotency RPCs, and Worker smoke tests assert the early rejection.
- This checkpoint is a code change only. The new Supabase migration has not been applied to production, no live redemption has been attempted, and no deployment or DNS cutover has occurred.


## Native Discord developer account checkpoint

- Added native Worker routes for the existing `account-auth` and `account-keys` application paths.
- Discord access tokens are verified against Supabase Auth before server-side sessions are created. Developer and profile sessions retain the existing two-month lifetime and use separate HttpOnly, Secure, host-only cookies.
- Session lookup, enrollment, logout, key listing, key creation, scope/expiry updates, and key revocation use the existing account RPCs. API-key issuance hashes the trusted Cloudflare `CF-Connecting-IP`; forwarded client-IP headers are not trusted.
- Preview account mutations are blocked before session or key RPC writes unless `SUPABASE_WRITE_MODE=enabled`. The checked-in Wrangler preview remains write-disabled.
- Native V4 webhook subscription management now supports authenticated listing, creation, and revocation using the existing Supabase webhook tables; no schema migration was required.
- Signing secrets are generated with Workers Web Crypto, encrypted with AES-256-GCM using `V4_WEBHOOK_ENCRYPTION_KEY`, and stored in the existing compatible `iv.tag.ciphertext` format. The raw secret is returned only once; list responses never expose ciphertext or secret hashes.
- Registration rejects non-HTTPS URLs, embedded credentials, nonstandard ports, IP literals, localhost and local/internal hostnames. This is syntax screening only, not a claim that the hostname resolves to a public IP.
- Webhook delivery remains paused. A safe connection-time egress control is still required to prevent DNS rebinding and private-address access; the Worker does not fetch subscription destinations, follow redirects, or dispatch queued deliveries.
- Webhook POST and DELETE check `SUPABASE_WRITE_MODE` before API-key authorization/quota RPCs. The checked-in Wrangler preview remains write-disabled.
- This is a code-only checkpoint. No database migration, production write, deployment, or DNS change was made.


## Native V4 webhook delivery implementation checkpoint

- Added an internal POST dispatcher at `/api/internal/v4/webhooks/dispatch`. It is not part of the public V4 API and requires a constant-time checked Bearer secret.
- The dispatcher checks `SUPABASE_WRITE_MODE=enabled` before database access and refuses to run unless the Cloudflare VPC `EGRESS` binding and delivery secrets are present. It has no global-fetch fallback for subscriber-controlled destinations.
- Added the `EGRESS` binding using Cloudflare Workers VPC `cf1:network`, so destination DNS and connections pass through Cloudflare Gateway. Gateway policy enforcement is a hard prerequisite: block non-public IPv4 and IPv6 destination ranges for Mesh-origin traffic before enabling delivery.
- Delivery uses the existing webhook subscription and delivery tables, a new atomic `FOR UPDATE SKIP LOCKED` claim RPC, 90-second leases, lease-token guarded completion, bounded retries (maximum eight attempts), exponential backoff, and terminal handling for permanent failures.
- Payloads are signed with the existing HMAC-SHA256 hexadecimal format and the existing encrypted secret format. Event IDs and creation timestamps remain stable across retries. Redirects are manual and never followed; only HTTPS, standard-port, hostname destinations pass application validation.
- Delivery requests are limited to 64 KiB and eight seconds. Retryable destination statuses are 408, 425, 429 and 5xx; other non-2xx statuses are terminal. Consumers should deduplicate on the stable event ID because an upstream success followed by a failed database acknowledgement can cause at-least-once redelivery.
- The SQL migration is committed but unapplied. The Cloudflare Gateway private-address block policies are configured as described below. The Supabase `pg_cron` dispatch schedule, secret configuration, staging integration tests, deployment, and cutover are not performed by this code-only change. Until those prerequisites are complete, the dispatcher remains fail-closed and webhook delivery is not operational.

- Cloudflare account Gateway network policies were created and verified for Mesh-origin traffic: IPv4 non-public/special-use destinations (rule `7bebf2de-1a4f-48b1-93bf-6ef8b2967c59`) and IPv6 loopback/translation/discard/documentation/6to4/ULA/link-local/multicast/special-use destinations (rule `56428058-d8d6-4b2d-9a53-5d5572c7dc19`). Both are enabled block rules at precedence 1 and 2. The account had no prior Gateway rules, lists, or Cloudflare Tunnels when checked. An initial combined IPv4/IPv6 expression was immediately deleted after Cloudflare normalized an IPv4-mapped IPv6 CIDR unexpectedly; the final separate rules were read back and contain no catch-all IPv4 range.
- No production database migration/write, live redemption, DNS change, deployment, or domain cutover was performed.
