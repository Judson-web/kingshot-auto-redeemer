# Security and architecture review: October 26, 2026

## Scope and confidence

This is a repository-based review of `main`, migrations, API routing, request limiting, and CI guardrails. It is not a certification and does not prove the live production database has exactly the schema or ACLs represented in Git. Production database state must be checked against the intended Supabase project before treating the RLS review as complete.

## Findings

### 1. V4 API routing is a contract adapter, not an isolated runtime

The `/api/v4/*` paths in `vercel.json` rewrite to `/api/kingshot-player` with a `developer=v4-*` query. `api/kingshot-player.ts` dispatches requests to `lib/developer-api-v4.ts`, which adapts the V3 authorization/quota/redemption implementation. Reuse is sensible for compatibility, but it does not create a separate function, database pool, or independent resource boundary. A traffic surge should not be described as isolated from other operations solely because it enters through a V4 path.

### 2. The browser-to-database risk claim is not substantiated by this source tree

No `@supabase/supabase-js` dependency or `createClient` call was found in the reviewed source. Operational database calls appear in server-side modules and use server credentials. The assessment's claim that the React UI completely bypasses the API layer is therefore unsupported by the repository evidence reviewed. This does not eliminate the need for strict grants and RLS: service-role code bypasses RLS, and any public-schema Data API permissions still need least privilege.

### 3. Database security controls already exist, but coverage is not universal

The migration history includes explicit deny policies for private tables, RLS hardening, service-role-only RPC grants, and targeted PostgreSQL integration tests. Those controls should be preserved. Existing tests cover selected migrations and invariants; they do not prove that every production table, policy, function, and grant matches the repository. The public-table ACL guard now begins on October 26, 2026, before the platform's October 30 default-grant change, and requires explicit RLS enablement for newly created public tables.

### 4. Application rate limiting is not a global edge limit

`lib/request-rate-limit.js` uses an in-process `globalThis` map. This is useful as per-instance abuse control, but its buckets are not shared across Vercel instances and do not provide a global ingress limit. Developer API account quotas are database-backed; the process-local limiter must not be treated as the only defense against distributed high-volume traffic. Vercel firewall/WAF rate limiting is a separate platform configuration, not something a response-header rule in `vercel.json` enables.

### 5. Upstream key safeguards needed a shared provider-wide breaker

The MightPulse key pool already uses atomic, database-backed per-key request reservations and shared 429 cooldowns. A 401/403 credential rejection, however, was cooled down only in the current warm instance. When every configured key was blocked or rejected, fresh instances could continue repeating the same provider-wide failure. The new circuit breaker counts full key-pool failure sweeps across serverless instances and, after three blocked sweeps within 60 seconds, pauses additional provider calls for 120 seconds. Individual key failures do not open the global circuit, and a successful non-blocking provider response resets accumulated failures.

## Operational follow-through

- Apply `20261026120000_mightpulse_provider_circuit_breaker.sql` to the intended production Supabase project before relying on the shared breaker. If the migration is absent or the breaker RPC is unavailable, the application fails open for this optional breaker RPC while preserving existing per-key quota and cooldown safeguards.
- Confirm Vercel firewall/WAF rules and rate limits in the project dashboard or API. This repository review did not change platform firewall state.
- Continue reviewing security-sensitive SQL migrations, especially RLS policies, `SECURITY DEFINER` search paths, function EXECUTE grants, and any `service_role` table privileges.
- Do not apply blanket policies copied from an assessment. Effective access depends on each table's intended public/private semantics and server-side authorization.
