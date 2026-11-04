import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const handler = await readFile(new URL("../internal/kingshot/alliance-sync-handler.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../internal/kingshot/alliance-sync-worker.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261101150000_discord_alliance_registration_owner_bypass.sql", import.meta.url), "utf8");

test("browser alliance registration is queued for the bounded worker", () => {
  const start = handler.indexOf("if(action==='create'||action==='register-alliance')");
  const end = handler.indexOf("\n  const id=String(req.body?.id", start);
  const route = handler.slice(start, end);
  assert.ok(route.includes("scheduled:true"));
  assert.ok(route.includes("register_alliance_sync_config"));
  assert.ok(!route.includes("performSync("));
  assert.ok(worker.includes("MAX_AUTOMATIC_SYNC_MEMBERS_PER_INVOCATION=10"));
  assert.ok(worker.includes("claim_due_alliance_sync_config"));
});

test("Discord-native alliance registration also hands work to the worker", () => {
  const start = handler.indexOf("export async function registerAllianceFromDiscord");
  const end = handler.indexOf("\nexport default async function handler", start);
  const route = handler.slice(start, end);
  assert.ok(route.includes("scheduled:true"));
  assert.ok(!route.includes("performSync("));
  assert.ok(migration.includes("next_run_at"));
  assert.ok(migration.includes("p_owner_bypass is distinct from true and v_total >= 4"));
});

test("queued and running work remains visible to progress polling", () => {
  const start = handler.indexOf("if(action==='progress')");
  const end = handler.indexOf("if(action==='history')", start);
  const route = handler.slice(start, end);
  assert.ok(route.includes("c.last_status==='pending'"));
  assert.ok(route.includes("processedCount:0"));
  assert.ok(route.includes("run.status==='running'"));
});
