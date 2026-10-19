# Supabase Hygiene and DEP0169 Investigation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply two narrowly evidence-backed Supabase hygiene fixes without changing effective access semantics, and trace the recurring Node `DEP0169` warning before deciding whether a code change is justified.

**Architecture:** Keep database changes in a separate additive migration, guarded by explicit catalog checks, and verify policy/grant behavior in an isolated Supabase development branch. Investigate the runtime warning independently; replace a deprecated call only if its actual caller is attributable and a safe equivalent exists.

**Tech Stack:** Supabase PostgreSQL/RLS, migration SQL, Node.js 24, npm dependency tree, Vercel runtime logs, existing security-regression checks.

**Spec:** `docs/superpowers/specs/2026-10-19-v4-kingdom-check-reliability-design.md`

## Global Constraints

- Do not change production database state directly while implementing or testing.
- Do not widen/narrow effective profile visibility as a side effect of removing a duplicate policy.
- Keep `private.kingshot_developer_account_sessions` private and keep service-role-only access intact.
- Do not remove indexes classified as unused without workload evidence.
- Do not enable paid dashboard features, alter Neon, change DNS for the shared `vercel.app` hostname, suppress Node warnings, or perform broad dependency upgrades.
- Fix `DEP0169` only after tracing the precise first-party or dependency call site; if attribution/safe repair is not possible, report the evidence and leave runtime behavior unchanged.
- Ensure all security-definer routines touched by this work keep explicit, pinned `search_path` and least-privilege EXECUTE grants.

## Review Focus

- Profile policy names/roles/predicates differ between environments — use catalog preconditions and abort cleanup instead of guessing.
- Duplicate policy removal changes anonymous or authenticated access — assert the broad-read policy remains unchanged and compare effective role visibility before/after.
- Foreign-key index changes inadvertently grant data access — verify the session table retains RLS and no client policies/grants are added.
- Warning originates in Vercel/runtime instrumentation rather than app code — make no speculative application change.
- Warning originates in a transitive dependency — verify exact dependency path and patch/minor compatibility before changing only that dependency.

---

### Task 1: Apply evidence-backed Supabase hygiene

**Files:**
- Create: `supabase/migrations/20261019103000_database_advisor_hygiene.sql`
- Create: `tests/database-advisor-hygiene-migration.test.js`
- Modify: `scripts/security-regression.mjs` only if the migration tests are not sufficient to assert the relevant grants/search paths.

**SQL changes:**
- Create index `kingshot_developer_account_sessions_user_id_idx` on `private.kingshot_developer_account_sessions(user_id)`.
- Remove `public.profiles` policy `Users can view their own profile` only if the exact expected policy is present and the broad `Public profiles are readable` policy still exists as a permissive SELECT policy for both `anon` and `authenticated` with predicate `true`.
- Before removal, compare catalog roles, command, permissiveness, and predicate against the audited definitions. If they differ, raise an exception and abort the migration instead of guessing. If the own-profile policy is absent, no cleanup is required; if the broad-read policy is absent or changed, do not remove anything.
- Preserve RLS on private session and MightPulse budget tables. Do not add policies, client grants, or unrelated index changes.

- [ ] **Step 1: Write failing migration tests** that assert the index is additive, the policy deletion is guarded by catalog checks for the broad policy and the own-profile policy, differing definitions abort cleanup, and no access grants/policies are added to the private session or key-budget tables.
- [ ] **Step 2: Run** `node --test tests/database-advisor-hygiene-migration.test.js` and confirm it fails because the migration is absent.
- [ ] **Step 3: Add the migration** in a transaction. Use stable index naming and an idempotent index creation. Place the role/predicate preconditions immediately before any policy drop.
- [ ] **Step 4: Run focused static tests** and extend `scripts/security-regression.mjs` if the test suite does not already protect the RLS/grant/search-path invariants.
- [ ] **Step 5: Verify in an isolated Supabase development branch**: query `pg_policies`, `pg_indexes`, role grants, and RLS flags before and after; assert the broad policy is unchanged, effective profile visibility is unchanged, and the session table remains client-inaccessible. Do not apply this migration to production during this task. If the tool cannot provide an isolated branch, stop before any write and report the limitation rather than substituting production.
- [ ] **Step 6: Run the full security regression and commit** as `fix: add developer session user index safely`.

### Task 2: Trace and, only if safe, remediate DEP0169

**Files:**
- Inspect: `api/discord-tools/[...path].js` or its actual route path as present in the repository, `api/kingshot-player.ts`, dependency lockfile and relevant transitive dependency files.
- Modify: only the proven first-party call site, or the one exact dependency that owns the call if a narrow compatible patch is available.
- Add/update tests only for the specific URL behavior being changed.

- [ ] **Step 1: Collect fresh Vercel runtime evidence** for `/api/discord-tools/[...path]` and `/api/kingshot-player` without requesting or printing secrets, query credentials, player IDs, or request bodies. Check whether logs contain a warning stack/caller location.
- [ ] **Step 2: Search first-party source and dependency sources** for the actual `url.parse()` caller; use `NODE_OPTIONS=--trace-deprecation` in a controlled local/test invocation and inspect the lockfile dependency path. Do not infer the caller from the route alone.
- [ ] **Step 3: If a first-party call is proven,** write a regression test for its existing URL parsing behavior first, run it red, replace the call with the WHATWG `URL` API while preserving edge-case semantics, then rerun it green.
- [ ] **Step 4: If a dependency is proven responsible,** confirm the smallest compatible patch/minor version that removes the legacy call and preserves Node 24 compatibility. Change no unrelated packages; run `npm audit --audit-level=high`, the full test/typecheck/build gates, and route-specific smoke tests.
- [ ] **Step 5: If the caller is outside the repository/runtime instrumentation or no safe narrow fix exists,** leave code/dependencies unchanged and record the observed evidence and reason it is not safely actionable in the implementation PR. Do not suppress warnings.
- [ ] **Step 6: Commit a focused fix only if justified**; otherwise close the investigation with a factual note in the PR and no speculative code diff.

### Task 3: Final verification and independent review

- [ ] **Step 1:** Run `npm test`, `npm run typecheck`, `npm run build`, `npm audit --audit-level=high`, `node scripts/security-regression.mjs`, and the repository's existing relevant smoke/CI workflows.
- [ ] **Step 2:** Request an independent review focused on access semantics, migration preconditions, RLS, private table access, and whether any URL-warning fix is supported by evidence.
- [ ] **Step 3:** Open/update a separate implementation PR for this work so a narrowly scoped database hygiene change does not block or obscure the Kingdom Check correctness change.
- [ ] **Step 4:** Keep it unmerged until CI/review passes; deploy through the normal versioned migration workflow and verify current policy/index state after authorized rollout.

## Completion Criteria

- The developer session foreign key has a supporting index.
- The redundant profile policy is removed only when the expected policy state proves that removal preserves effective access; otherwise it remains and the mismatch is reported.
- Private session/key-budget data remain inaccessible to untrusted roles.
- `DEP0169` has an evidence-backed attribution and a narrow fix, or a clear finding that no safe in-repository fix is justified.
- All required tests and security/CI gates pass.


## Investigation findings (2026-10-19)

- Vercel grouped runtime errors reported 493 `DEP0169` occurrences across 80 users over the available seven-day window, with the last reported occurrence at `2026-10-19T08:58:34Z`. The grouped cluster named `/api/discord-tools/[...path]` and `/api/kingshot-player`.
- A read of available recent raw logs showed the warning on `GET /api/v3/redemptions` at `2026-10-19T08:58:35Z`, but the only message was Node's deprecation notice and the generic instruction to run with `--trace-deprecation`; it did not contain an application stack.
- Inspected first-party route code and the shared handlers it dispatches to. The searched in-repository code uses the WHATWG `URL` API and did not reveal a call to `url.parse()`. GitHub code search did not locate a first-party call site.
- Attempted a recent Vercel runtime-log query, but the Hobby retention window returned a log-API error for a one-hour range; a 30-minute query returned only the generic warning event without an actionable stack. The current evidence cannot identify whether the warning originates in Vercel instrumentation or a transitive dependency.
- **Decision:** no source or dependency change was made. Do not suppress the warning or broadly upgrade dependencies. Revisit only when a trace stack or more detailed runtime log identifies the concrete caller and a narrow compatible repair can be verified.
