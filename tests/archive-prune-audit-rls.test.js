import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("archive prune audit RLS migration preserves server-only access", () => {
  const sql = fs.readFileSync(
    new URL("../supabase/migrations/20261020110000_enable_rls_archive_prune_audit.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /ALTER\s+TABLE\s+private\.archive_prune_audit\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.match(sql, /REVOKE\s+ALL\s+ON\s+TABLE\s+private\.archive_prune_audit\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.doesNotMatch(sql, /FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
});
