import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../internal/kingshot/alliance-sync-worker.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261104120000_recover_stale_alliance_sync_runs.sql", import.meta.url), "utf8");

test("automatic alliance worker runs stale-run recovery before claiming new work", () => {
  assert.ok(worker.indexOf("recover_stale_alliance_sync_runs") < worker.indexOf("claim_due_alliance_sync_config"));
});

test("stale alliance runs require age and an expired or missing config lease", () => {
  assert.ok(migration.includes("r.started_at < now() - interval '10 minutes'"));
  assert.ok(migration.includes("c.lease_expires_at <= now()"));
  assert.ok(migration.includes("for update of r skip locked"));
  assert.ok(migration.includes("worker_lease_expired"));
});

test("recovery preserves disabled configurations and durable player outcomes", () => {
  assert.ok(migration.includes("case when c.enabled then 'pending' else 'paused' end"));
  assert.ok(!migration.toLowerCase().includes("delete from public.alliance_sync_seen_players"));
  assert.ok(migration.includes("grant execute on function public.recover_stale_alliance_sync_runs() to service_role"));
});
