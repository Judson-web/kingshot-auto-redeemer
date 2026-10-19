# V4 Design: Kingdom Check Reliability and Database Hygiene

**Status:** Draft for review  
**Date:** 2026-10-19  
**Repository:** `Judson-web/kingshot-auto-redeemer`  
**Base:** `main` at `131e64d2ee4a43ee5f5a8da9f941d8f112a6452e`

## 1. Summary

V4 is a reliability-focused backend hardening change, not a platform rewrite. Production health was green during the audit: all four worker shards completed, all four known gift-code sources were healthy, and the latest health payload showed no worker errors, stale shards, or deadline skips. The work should therefore preserve the current architecture and make the Kingdom Check path safer when MightPulse has not yet produced a trustworthy post-reset snapshot.

The key correctness rule is: **do not change a player's kingdom, mark a player stale, suppress auto-redemption, or send a kingdom-change/deletion notification based on an upstream response that cannot be proven to represent the current reset cycle.** Defer the check instead, and persist the next eligible attempt so multiple serverless instances cannot retry it every minute.

This design is based on the code and production signals reviewed on 2026-10-19. The provider's `fresh` field is documented but its precise semantics are not formally specified, so this design intentionally fails closed when metadata is missing or inconsistent.

## 2. Problems and evidence

### 2.1 Freshness metadata is discarded

The Kingdom Check client calls MightPulse `GET /v1/players/{id}?include=base`, then reduces the response to `data.player || data`. This discards wrapper metadata including `fresh`, `cached_at`, and `age_seconds`. MightPulse documents that player data may be cached for up to 60 minutes and that a refresh may wait up to 90 seconds before falling back to the last stored copy.

A cache entry from before the daily reset can therefore look like a valid player record while still describing yesterday's kingdom state.

### 2.2 A single 404 is treated as deletion

MightPulse documents HTTP 404 for an unknown queried ID. A single upstream 404 does not establish that a registered player deleted or abandoned their game account. Treating it as definitive currently risks marking a valid player stale and excluding them from normal processing.

### 2.3 Deferred work is not durably delayed

The current job releases a claim on thrown errors and can classify quota/cooldown problems as deferred, but there is no persisted per-player retry-after timestamp. Since serverless invocations and module memory are not globally shared, local cooldowns alone cannot prevent repeated attempts from other instances.

### 2.4 Small database hygiene improvements are supported by advisor evidence

The Supabase advisor reports an unindexed foreign key at `private.kingshot_developer_account_sessions.user_id` and a redundant authenticated SELECT policy on `public.profiles`. The broad `Public profiles are readable` policy already permits authenticated SELECT, making `Users can view their own profile` redundant under the current policy set. The change must preserve the existing effective access model; it must not accidentally narrow or widen public/anonymous access.

### 2.5 Node URL deprecation warning needs attribution

The production runtime reports Node's `DEP0169` legacy `url.parse()` deprecation on `/api/discord-tools/[...path]` and `/api/kingshot-player`. The source has not yet been attributed to a specific first-party call or dependency. V4 must identify the originating stack/package before changing code. Suppressing the warning or applying a broad dependency upgrade without attribution is out of scope.

## 3. Goals

1. Preserve and use the complete MightPulse response envelope until freshness has been validated.
2. Validate only snapshots that are explicitly fresh, have trustworthy timestamps, and belong to the current daily reset cycle.
3. Persist retry-after scheduling in Postgres and have the atomic claim operation respect it.
4. Treat upstream 404 as inconclusive rather than proof of player deletion.
5. Preserve current claim/release safety, worker sharding, API-key quotas, and service-role-only database boundaries.
6. Add deterministic unit/integration regression tests for freshness, deferral, and side-effect suppression.
7. Apply two evidence-backed database hygiene changes and add regression coverage for relevant grants/policies.
8. Attribute the `DEP0169` warning without broad or speculative runtime/dependency changes.

## 4. Non-goals

- Replacing Vercel Functions, Supabase, Neon, the existing worker architecture, or the scraping system.
- Increasing provider quotas, rotating around limits, or weakening shared cooldowns.
- Changing the Neon recovery database or its compute settings.
- Changing production database state directly outside a versioned, reviewable migration.
- Attempting DNS/mail-record fixes on the shared `vercel.app` hostname.
- Enabling paid Supabase Auth leaked-password protection or changing unrelated dashboard settings.
- Broad dependency upgrades, warning suppression, or unrelated UI/PWA changes.
- Changing the established daily reset time or the meaning of a verified kingdom-change event.

## 5. Proposed design

### 5.1 Preserve the upstream envelope

Refactor the Kingdom Check provider adapter to retain a typed envelope containing at least:

- `player`: the parsed player payload.
- `fresh`: the provider-declared freshness indicator.
- `cached_at`: provider timestamp for the underlying cache record.
- `age_seconds`: provider-reported age.
- The upstream HTTP status and rate-limit/retry metadata needed for classification, where available.

Do not log the raw response, player identifiers, API keys, or user data merely to debug freshness. Diagnostics should use bounded reason codes such as `pre_reset_snapshot`, `freshness_metadata_missing`, `freshness_metadata_conflict`, `upstream_not_found`, `upstream_rate_limited`, and `upstream_timeout`.

### 5.2 Current-reset freshness gate

Before any kingdom comparison or player-state mutation, compute the current reset boundary using the existing canonical application timezone/reset definition. For the current deployment, the scheduled Kingdom Check aligns with the 05:30 Asia/Kolkata boundary (00:00 UTC); centralize/reuse the established reset helper rather than introducing a second independent clock definition.

Accept a snapshot only when all checks pass:

1. The response has a player payload of the expected shape.
2. `fresh === true` (missing, false, or non-boolean values are not accepted).
3. `cached_at` parses as a valid timestamp and is not materially in the future.
4. `cached_at` is at or after the current reset boundary.
5. `age_seconds` is a finite, non-negative number and is consistent with local time minus `cached_at` within a documented tolerance for clock skew/serialization. A provider age indicating the cache is older than its documented 60-minute refresh threshold plus the documented 90-second wait window is treated as inconsistent for this check.

If any check fails, **defer without comparing kingdom values and without applying player-state side effects**. In particular, do not set stale status, change the stored kingdom, suppress redemption, or emit kingdom-change/deletion notifications. A valid post-reset snapshot continues through the existing comparison and mutation path unchanged.

A future timestamp beyond the small agreed clock-skew tolerance, a malformed timestamp, negative age, or contradictory freshness fields must be treated as invalid metadata, not auto-corrected.

### 5.3 Durable retry-after state

Add nullable `kingdom_check_retry_after_at timestamptz` to `public.kingshot_autoredeem` (or the canonical row/table currently used by the Kingdom Check claim path, after reconciling the final migration with the current schema).

Update the existing atomic claim RPC so a player is not claimable while `kingdom_check_retry_after_at > now()`. Do not replace the claim with a client-side pre-check: eligibility must remain atomic inside the database operation.

Add a narrowly scoped service-role-only deferral operation, or extend the current claim/release RPC contract where that is demonstrably safer, to atomically persist the retry-after timestamp and release the active claim. It must:
- be safe under repeated calls;
- validate player identity and the timestamp;
- avoid accepting an arbitrary unbounded far-future timestamp;
- be executable by the server/service role only, never `anon` or `authenticated`;
- retain a pinned, explicit `search_path` consistent with existing security-definer routines;
- not expose service-only state through client-facing policies.

A successful, validated recheck clears the retry-after field. Claim release on crashes/timeouts must continue to work even when no freshness result was obtained. The migration must be reversible where practical and must not rewrite existing player rows beyond adding the nullable column.

#### Retry policy

Use provider metadata and rate-limit signals to avoid repeatedly hammering the same stale result:

| Condition | Proposed next attempt |
|---|---|
| Snapshot is pre-reset and provider cache is still under 60 minutes old | No earlier than `cached_at + 60 minutes + 95 seconds` |
| Provider waited for refresh but returned a still-old snapshot after its documented 90-second wait | Five-minute bounded retry, with jitter if existing utilities support it |
| Freshness metadata missing or inconsistent | 10–15 minute bounded retry; no player mutation |
| HTTP 429 / provider quota cooldown | Honor valid `Retry-After` / existing key-pool `retryAfterMs`; apply a bounded fallback only when absent |
| Timeout or transient 5xx | Five-minute bounded retry with jitter, respecting existing shared cooldowns |
| Single HTTP 404 / unknown ID | Defer for six hours and retry; do not mark stale from this response alone |
| Valid post-reset snapshot | Clear retry-after and continue existing comparison logic |

Clamp provider-controlled retry inputs to a safe, documented maximum. Never shorten a longer shared quota cooldown. If exact cache age cannot be established, use the bounded metadata-missing fallback rather than guessing. Retry values above are design defaults to validate against current scheduler behavior and tests before implementation; adjust only if evidence shows they conflict with a provider contract.

Forced/manual checks must still obey provider rate limits and shared cooldowns. Force must not mean “ignore upstream quota” or allow two concurrent claims for the same player.

### 5.4 Database hygiene migration

In the same or a separate small migration, depending on code-review clarity:

- Add an index on `private.kingshot_developer_account_sessions(user_id)` to support the existing foreign key and user-associated cleanup/access patterns.
- Drop only the redundant `Users can view their own profile` authenticated SELECT policy on `public.profiles`, after verifying the exact policy definitions at implementation time. Keep `Public profiles are readable` and do not change its roles or predicate. If the production definitions differ from the audited ones, stop and revise the migration instead of proceeding with assumptions.
- Keep `public.mightpulse_api_key_budget` and `public.mightpulse_api_request_budget` without client-access policies; their current no-policy state is intentionally deny-by-default.
- Do not drop “unused” indexes without workload evidence.
- Add security-regression assertions for client privileges on the retry RPC, the new/changed functions' search paths, and the expected profile policy set.

The index is additive and the policy removal is intended to preserve the current effective authenticated SELECT behavior. Review exact SQL and policy semantics before merge.

### 5.5 Deprecation warning investigation

Reproduce or isolate the `DEP0169` source by inspecting the deployed/current route dependency paths and using a stack-bearing local/test invocation or a narrowly scoped diagnostic run. Inspect dependency source and lockfile versions as needed. Make a code change only when the legacy call is attributable and a compatible WHATWG URL alternative is clear. If the originating behavior is outside this repository or no safe fix is found, document the attribution and leave behavior untouched rather than introducing a speculative workaround.

Avoid logs that include tokens, player IDs, request bodies, or URLs with credentials/query secrets.

## 6. Failure behavior and invariants

- Missing/ambiguous upstream freshness is a deferral, not success and not deletion.
- A deferral must not produce a kingdom-change notification, deleted-player notification, stale marker, or kingdom mutation.
- Every claim must eventually be released or expire under the existing lease safety model.
- A deferral must persist a future eligibility timestamp before/while releasing the claim; partial failure must not leave the player immediately claimable if the upstream condition is still unresolved.
- The claim RPC remains atomic and coordinates work across all serverless instances.
- Shared provider quota and cooldown enforcement remain authoritative.
- Valid current-cycle snapshots retain existing successful behavior.
- Client roles cannot execute service-only mutation routines or read private session/key-budget data.
- No production migration is applied by hand outside the reviewed migration/deployment workflow.

## 7. Testing strategy and acceptance criteria

### Freshness unit tests
- Fresh post-reset snapshot passes.
- Snapshot just before reset is deferred.
- Snapshot exactly at the reset boundary follows the explicit inclusive-boundary rule.
- Missing `fresh`, `cached_at`, or `age_seconds` is deferred.
- Invalid, future, negative, non-finite, or mutually inconsistent metadata is deferred.
- Provider age beyond the documented refresh/wait threshold is deferred.
- Local timezone/date rollover and UTC representation of the reset boundary are covered.

### Kingdom Check integration/regression tests
- Single 404 defers and does not mark player stale.
- 429 honors existing Retry-After/key-pool behavior.
- Timeout/5xx releases/defer claims correctly.
- Deferral persists retry-after and the next claim excludes that row until eligible.
- Concurrent claim attempts cannot process one player twice.
- Valid post-reset data clears retry-after and preserves existing kingdom-change event semantics.
- Deferred/stale/pre-reset cases produce no kingdom-change or deletion notification.
- Logs contain reason codes only, not secrets or unnecessary personal/player data.

### Migration/security tests
- Migration applies cleanly to a representative schema.
- Index exists on the developer session foreign key.
- The redundant profile SELECT policy is removed only if the exact existing policy state matches the reviewed assumption.
- Effective profile visibility is unchanged for relevant roles.
- Client roles cannot execute the deferral/claim mutation RPCs.
- Security-definer routines have expected explicit `search_path` settings.
- Private/session/key-budget tables remain inaccessible to untrusted roles.

### Required project gates
- Focused regression tests first (TDD).
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm audit --audit-level=high`
- `node scripts/security-regression.mjs`
- Existing worker watchdog/smoke checks.
- Existing OWASP ZAP baseline workflow.
- GitHub review and all required CI checks before merge.
- After merge/deploy, verify production health, worker shards/source health, kingdom-check deferral counts/reasons, error rates, and absence of false state/notification changes.

Any unavailable integration environment must be explicitly reported; production database state must not be changed as a substitute for tests.

## 8. Rollout and rollback

1. Implement on the dedicated non-production feature branch with tests.
2. Validate the migration against a Supabase development branch or isolated test database before production.
3. Open a PR; keep it unmerged until review and checks are green.
4. Merge through the project's normal workflow, allowing the existing deployment pipeline to deploy.
5. Verify health and logs after deployment, including a reset-cycle observation where practical.
6. If the change causes unexpected deferrals or worker backlog, disable the new freshness gate only through a reviewed feature flag/rollback mechanism if one exists; otherwise roll back the code and use a forward-only database-safe rollback strategy. Do not remove a column while running code still references it.
7. Review retry backlog and service-role permissions after rollback.

## 9. Open implementation checks

Before writing the implementation plan, confirm from the latest repository revision:
- the canonical reset-boundary helper and exact timezone semantics;
- the current claim/release RPC SQL and grants;
- the exact table/column used by the claim scheduler;
- the current profile policies and whether any callers rely on their names rather than effective permissions;
- whether retry/backoff utilities already exist and can be reused;
- a reproducible source location for `DEP0169`.

If any of those conflict with the audit assumptions, update this design before coding.
