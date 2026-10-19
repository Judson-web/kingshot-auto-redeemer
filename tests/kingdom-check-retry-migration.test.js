import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../supabase/migrations/20261019100000_kingdom_check_durable_retry.sql", import.meta.url);
const sql = await readFile(migrationPath, "utf8");

test("durable retry migration adds an idempotent retry timestamp column", () => {
  assert.match(sql, /add column if not exists kingdom_check_retry_after_at timestamptz/i);
});

test("scheduled claim checks retry-after inside the row-locked transaction", () => {
  const claimStart = sql.indexOf("create or replace function public.claim_kingshot_kingdom_reset_check");
  const claimEnd = sql.indexOf("$function$;", claimStart);
  const claimSql = sql.slice(claimStart, claimEnd);
  assert.match(claimSql, /for update/i);
  assert.match(claimSql, /kingdom_check_retry_after_at\s*>\s*v_now/i);
  assert.match(claimSql, /kingdom_id is not null/i);
  assert.match(claimSql, /claim_expired/i);
});

test("manual claim atomically respects retry-after and the active claim lease", () => {
  const claimStart = sql.indexOf("create or replace function public.claim_kingshot_kingdom_manual_check");
  assert.notEqual(claimStart, -1);
  const claimEnd = sql.indexOf("$function$;", claimStart);
  const claimSql = sql.slice(claimStart, claimEnd);
  assert.match(claimSql, /for update/i);
  assert.match(claimSql, /kingdom_check_retry_after_at\s*>\s*v_now/i);
  assert.match(claimSql, /kingdom_check_claimed_at/i);
  assert.doesNotMatch(claimSql, /last_kingdom_check_at/);
});

test("defer RPC bounds the timestamp, preserves later retry windows, and releases the claim atomically", () => {
  const start = sql.indexOf("create or replace function public.defer_kingshot_kingdom_reset_check");
  assert.notEqual(start, -1);
  const end = sql.indexOf("$function$;", start);
  const deferSql = sql.slice(start, end);
  assert.match(deferSql, /p_retry_after_at\s*>\s*v_now\s*\+\s*interval '24 hours'/i);
  assert.match(deferSql, /greatest\s*\(/i);
  assert.match(deferSql, /kingdom_check_claimed_at\s*=\s*null/i);
});

test("successful kingdom revalidation clears durable retry-after", () => {
  const start = sql.indexOf("create or replace function public.record_kingshot_kingdom_revalidation");
  assert.notEqual(start, -1);
  const end = sql.indexOf("$function$;", start);
  assert.match(sql.slice(start, end), /kingdom_check_retry_after_at\s*=\s*null/i);
});

test("privileged retry RPCs use a pinned search_path and service-role-only execution", () => {
  const signatures = [
    ["claim_kingshot_kingdom_reset_check(text)", "public.claim_kingshot_kingdom_reset_check(text)"],
    ["claim_kingshot_kingdom_manual_check(text)", "public.claim_kingshot_kingdom_manual_check(text)"],
    ["defer_kingshot_kingdom_reset_check(text,timestamptz)", "public.defer_kingshot_kingdom_reset_check(text,timestamptz)"]
  ];
  for (const [signature, sqlSignature] of signatures) {
    assert.ok(sql.includes("function " + sqlSignature), "missing function signature " + signature);
    assert.ok(sql.includes("revoke all on function " + sqlSignature + " from public, anon, authenticated"), "missing revoke for " + signature);
    assert.ok(sql.includes("grant execute on function " + sqlSignature + " to service_role"), "missing service_role grant for " + signature);
  }
  assert.match(sql, /set search_path\s*=\s*public/i);
});
