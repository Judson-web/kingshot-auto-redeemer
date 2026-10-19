# Kingdom Check Freshness and Durable Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stale or ambiguous MightPulse responses from changing kingdom/player state, and persist retry timing so all worker instances respect provider freshness and quotas.

**Architecture:** Add a pure freshness/reset-cycle module; keep the MightPulse envelope intact in the provider adapter; route scheduled and manual checks through an atomic claim/defer/release lifecycle; and store eligibility backoff in Supabase. Keep the existing Vercel worker/shard architecture, shared key-pool limiter, and successful kingdom-change recording path.

**Tech Stack:** Node.js 24 ESM, TypeScript, built-in `node:test`, Supabase PostgreSQL migrations/RPCs, existing MightPulse key pool, GitHub Actions and Vercel verification.

**Spec:** `docs/superpowers/specs/2026-10-19-v4-kingdom-check-reliability-design.md`

## Global Constraints

- Accept a snapshot only when `fresh === true`, `cached_at` is valid and at/after the active reset boundary, and `age_seconds` is finite, non-negative, and consistent within a five-minute clock/serialization tolerance.
- The active reset boundary is the existing 05:30 Asia/Kolkata cycle; 05:30 IST is 00:00 UTC. Reuse one canonical helper and cover the inclusive boundary.
- If freshness cannot be established, do not mutate kingdom/player state, mark stale, suppress redemption, or send kingdom-change/deletion notifications.
- Honor existing shared key-pool cooldowns and provider quota limits; never increase limits or bypass them for a forced/manual check.
- A single upstream 404 defers for six hours; it does not mean the player was deleted.
- Persist retry-after in `public.kingshot_autoredeem`; the database claim remains atomic across serverless instances.
- Service-only RPCs revoke execution from `public`, `anon`, and `authenticated`, grant only `service_role`, and retain explicit `search_path`.
- Do not make production database writes or alter Neon during implementation testing; verify SQL with isolated tests/development branch and use versioned migrations for rollout.
- Do not perform a broad dependency upgrade or suppress `DEP0169` without identifying its source.

## Review Focus

- Reset date/time rollover, including an exact 05:30 IST timestamp and a pre-reset manual check — freshness/reset unit tests.
- Missing, contradictory, malformed, future, or non-finite provider metadata — validation helper tests.
- Retry timing when cache age is just below, at, or above the 60-minute + 90-second refresh threshold — retry-calculation tests.
- A player with no current kingdom, a forced/manual check, or two concurrent checks — claim lifecycle tests.
- Failure while persisting a defer result — do not immediately release the claim into a hot retry loop; allow lease expiry and log a bounded reason only.

---

### Task 1: Add deterministic reset and snapshot freshness rules

**Files:**
- Create: `internal/kingshot/kingdom-freshness.js`
- Create: `tests/kingdom-freshness.test.js`
- Modify: `internal/kingshot/kingdom-validation.ts` only to replace its duplicated reset-cycle calculation with the new helper, if needed.

**Interfaces:**
- Produce `getResetCycle(nowMs = Date.now())`, returning the local date key, whether current local time is at/after 05:30 IST, and the active reset boundary as epoch milliseconds.
- Produce `needsKingdomResetCheck(lastCheckedAt, nowMs = Date.now())` with the current function's existing eligibility semantics.
- Produce `evaluateMightPulseSnapshot(snapshot, nowMs = Date.now())`, returning either `{ valid: true, player, cachedAtMs, ageSeconds }` or `{ valid: false, reason }`.
- Produce `getKingdomRetryAfterAtMs({ reason, snapshot, status, retryAfterMs, nowMs })`, returning an absolute epoch timestamp.

- [ ] **Step 1: Write failing tests** for valid post-reset data; timestamp exactly at and one millisecond before reset; pre-reset data; missing `fresh`/`cached_at`/`age_seconds`; `fresh !== true`; malformed/future timestamp; negative or non-finite age; age/cache-time mismatch greater than five minutes; and age beyond 3,690 seconds.
- [ ] **Step 2: Run the focused test** with `node --test tests/kingdom-freshness.test.js`. Confirm it fails because the module/contract is missing.
- [ ] **Step 3: Implement the pure helper** using the Asia/Kolkata local date/time parts and UTC epoch arithmetic; do not use the host machine's local timezone.
- [ ] **Step 4: Add retry calculation tests** for pre-reset cache age under 3,600 seconds (retry no earlier than `cached_at + 3,600,000 + 95,000` ms), cache age at/over 3,600 seconds (five-minute fallback), missing/inconsistent metadata (ten-minute fallback), HTTP 404 (six hours), 429 (honor positive Retry-After up to a documented 24-hour safety cap, without overriding longer shared key-pool cooldowns), and timeout/5xx (five minutes).
- [ ] **Step 5: Run the focused test** again and verify all cases pass.
- [ ] **Step 6: Commit** as `test: define kingdom freshness and retry rules` followed by `feat: add kingdom freshness helpers` if the project's commit flow supports separate red/green commits.

### Task 2: Preserve MightPulse metadata and make the revalidation path testable

**Files:**
- Modify: `internal/kingshot/kingdom-validation.ts`
- Create: `tests/kingdom-validation.test.js`
- Reuse: `internal/kingshot/kingdom-validation-errors.js`, `lib/mightpulse-key-pool.js`

**Interfaces:**
- Expand the internal fetch result to retain `player`, `fresh`, `cached_at`, `age_seconds`, HTTP status, and parsed retry metadata; do not collapse it to `data.player || data` before validating the wrapper.
- Add an optional injectable `fetchPlayer` dependency to `revalidatePlayer` for deterministic tests; production defaults to the existing key-pool-backed request function.
- Keep logging to short reason codes/statuses; never log raw provider bodies, credentials, or unnecessary player identifiers.

- [ ] **Step 1: Write failing revalidation tests** with injected provider responses for a valid post-reset snapshot, stale pre-reset snapshot, missing metadata, contradictory metadata, malformed player payload, 404, 429, timeout, and 5xx. Assert only validated snapshots call `record_kingshot_kingdom_revalidation`.
- [ ] **Step 2: Run** `node --test tests/kingdom-validation.test.js` and confirm the new cases fail against current behavior.
- [ ] **Step 3: Preserve the response envelope** in `fetchCurrentPlayer`; map HTTP statuses into explicit, typed outcomes without treating 404 as stale/deleted.
- [ ] **Step 4: Apply freshness validation before extracting/using kingdom fields**. Return a deferred result for all invalid/ambiguous snapshots. No invalid response may call `record_kingshot_kingdom_revalidation`, `mark_kingshot_player_stale`, or `notify`.
- [ ] **Step 5: Add tests proving a single 404 defers without a stale RPC or notification**, including the path where the existing player record has no `kingdom_id`.
- [ ] **Step 6: Run focused tests, typecheck, and commit** as `fix: validate MightPulse snapshot freshness`.

### Task 3: Persist retry-after and make claims respect the durable window

**Files:**
- Create: `supabase/migrations/20261019100000_kingdom_check_durable_retry.sql`
- Create: `tests/kingdom-check-retry-migration.test.js`
- Modify: `scripts/security-regression.mjs` if needed to add assertions for the new RPC.

**Database interface:**
- Add nullable `public.kingshot_autoredeem.kingdom_check_retry_after_at timestamptz`.
- Update `public.claim_kingshot_kingdom_reset_check(text)` so it checks the retry timestamp inside its existing row lock and refuses a claim while it is in the future.
- Add `public.claim_kingshot_kingdom_manual_check(text)` as a separate atomic claim for forced/manual checks. It must use the same row lock and claim lease, honor retry-after, and omit only the normal “already checked this reset cycle” restriction. Do not let manual force create concurrent claims or ignore shared provider quota.
- Add `public.defer_kingshot_kingdom_reset_check(text, timestamptz)` (or an equivalently narrow signature) to persist the retry window and clear the active claim atomically. Validate the target row and bound the accepted timestamp to `now()` through `now() + interval '24 hours'`. Preserve any later already-stored retry window using `greatest`.
- On successful `record_kingshot_kingdom_revalidation`, clear `kingdom_check_retry_after_at`.
- All three new/changed routines retain explicit, pinned `search_path` and service-role-only execute grants; keep the current claim/release function behavior and 10-minute abandoned-claim expiry unless tests show a necessary adjustment.

- [ ] **Step 1: Write migration-regression assertions** that require the column, retry check inside the row-locked claim, atomic deferral/release, successful-clear behavior, explicit search path, revoke from `public`/`anon`/`authenticated`, and grant to `service_role` only.
- [ ] **Step 2: Run** `node --test tests/kingdom-check-retry-migration.test.js` and confirm it fails before the migration exists.
- [ ] **Step 3: Write the additive migration**. Do not edit old migrations or write directly to production.
- [ ] **Step 4: Run focused static migration/security tests**. Create or use an isolated Supabase development branch for database-level verification only after plan approval; apply the migration there and query the column, function definitions, and role execution privileges. Do not apply it to production during this task.
- [ ] **Step 5: Test claim concurrency, due/future retry timestamps, the 24-hour bound, repeated deferrals, and successful retry clearing** against the isolated database when the environment supports concurrent SQL sessions. If not supported, report the limitation and retain static regression coverage; do not claim concurrency was proven.
- [ ] **Step 6: Commit** as `feat: persist kingdom validation retry windows`.

### Task 4: Route every fetch through the correct claim/defer lifecycle

**Files:**
- Modify: `internal/kingshot/kingdom-validation.ts`
- Modify: `api/kingshot-auto.js` only where retry/deferral summaries need updated aggregation.
- Modify: `tests/kingdom-validation.test.js`
- Modify: `tests/kingdom-check-flow.test.js`

**Interfaces:**
- Scheduled calls use `claim_kingshot_kingdom_reset_check`.
- Forced/manual calls use `claim_kingshot_kingdom_manual_check`.
- A failed freshness check or upstream 404 calls `defer_kingshot_kingdom_reset_check` with the absolute timestamp returned by the retry helper.
- On successful persistence, the revalidation RPC clears retry-after and the existing kingdom-change event/notification path remains unchanged.

- [ ] **Step 1: Add failing orchestration tests** that assert a claim is taken before any MightPulse request—including players without a kingdom—and both scheduled and force/manual paths honor durable retry windows.
- [ ] **Step 2: Add a regression test** that two invocations cannot fetch/process the same player while a claim is active.
- [ ] **Step 3: Integrate freshness deferral with the atomic defer RPC**. If the defer RPC fails, do not immediately release the claim and create a hot retry loop; let the existing claim expire and emit a bounded operational reason. For unrelated transient exceptions, preserve the ordinary release behavior.
- [ ] **Step 4: Verify 429 uses the key-pool's longer retry signal when present** and no retry calculation shortens an existing shared cooldown.
- [ ] **Step 5: Verify valid data clears retry-after**, updates `last_kingdom_check_at`, and preserves the existing kingdom-change notification only when the validated kingdom truly differs.
- [ ] **Step 6: Run** `node --test tests/kingdom-validation.test.js tests/kingdom-check-flow.test.js tests/kingdom-check-retry-migration.test.js` and commit as `fix: persist and enforce kingdom check deferrals`.

### Task 5: Full verification and production-readiness review

**Files:**
- Modify only if test failures require it: relevant kingdom-validation tests, `scripts/security-regression.mjs`, workflow/test files.

- [ ] **Step 1: Run the focused tests** for freshness, orchestration, SQL regression, and existing Kingdom Check batching.
- [ ] **Step 2: Run required project gates:** `npm test`, `npm run typecheck`, `npm run build`, `npm audit --audit-level=high`, `node scripts/security-regression.mjs`, and the existing worker smoke/watchdog checks.
- [ ] **Step 3: Confirm** the existing OWASP ZAP baseline workflow is green; investigate rather than ignore any new finding.
- [ ] **Step 4: Request an independent code review** focused on false kingdom changes, concurrent claim handling, retry-window bounds, service-role grants, and logging privacy. Resolve all blocking findings.
- [ ] **Step 5: Open/update the implementation PR** with a migration summary, test evidence, and a production rollout note. Keep it unmerged until checks and review are green.
- [ ] **Step 6: After authorized merge/deployment and versioned migration rollout,** check the health endpoint, worker shards/source health, deferral reason counts, runtime errors, and absence of stale/deletion/kingdom-change side effects for deferred responses. Never claim production validation without fresh evidence.

## Completion Criteria

- The freshness gate rejects pre-reset/stale/ambiguous provider snapshots without player-state side effects.
- Scheduled and manual requests cannot race or bypass durable retry eligibility.
- A 404 no longer marks the player stale from one lookup.
- Retry-after is persisted in Postgres, respected by atomic claims, and cleared by a successful validation.
- All existing project gates pass, and the migration's grants/search paths are verified on an isolated database before deployment.
