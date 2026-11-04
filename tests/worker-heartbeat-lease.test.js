import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("worker heartbeat renews only a bounded five-minute lease", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20261104010000_bound_worker_heartbeat_lease.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /create or replace function public\.heartbeat_kingshot_worker_run\(p_token uuid\)/i);
  assert.match(sql, /lock_until\s*=\s*now\(\)\s*\+\s*interval '5 minutes'/i);
  assert.match(sql, /where id\s*=\s*true\s+and lock_token\s*=\s*p_token/i);
  assert.match(sql, /revoke all on function public\.heartbeat_kingshot_worker_run\(uuid\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.heartbeat_kingshot_worker_run\(uuid\) to service_role/i);
  assert.doesNotMatch(sql, /interval '30 minutes'/i);
});
