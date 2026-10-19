import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../supabase/migrations/20261019103000_database_advisor_hygiene.sql", import.meta.url);
const sql = await readFile(migrationPath, "utf8");

test("advisor hygiene migration only adds the missing developer-session foreign-key index", () => {
  assert.match(sql, /create index if not exists kingshot_developer_account_sessions_user_id_idx\s+on private\.kingshot_developer_account_sessions\s*\(user_id\)/i);
});

test("profile policy cleanup verifies the exact broad policy before considering removal", () => {
  assert.match(sql, /Public profiles are readable/i);
  assert.match(sql, /v_public_policy\.roles::text\s*<>\s*'\{anon,authenticated\}'/i);
  assert.match(sql, /v_public_policy\.cmd\s*<>\s*'SELECT'/i);
  assert.match(sql, /coalesce\(v_public_policy\.qual, ''\)\s*<>\s*'true'/i);
  assert.match(sql, /raise exception/i);
});

test("own-profile policy is removed only when its known definition matches the audited predicate", () => {
  assert.match(sql, /Users can view their own profile/i);
  assert.match(sql, /v_own_policy\.roles::text\s*<>\s*'\{authenticated\}'/i);
  assert.match(sql, /v_own_policy\.cmd\s*<>\s*'SELECT'/i);
  assert.match(sql, /lower\s*\(\s*regexp_replace\s*\(/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /drop policy/i);
});

test("migration never grants client access or adds policies to private session/key-budget tables", () => {
  assert.doesNotMatch(sql, /grant\s+[^;]*\s+to\s+(?:anon|authenticated|public)/i);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /alter table\s+private\.kingshot_developer_account_sessions\s+disable row level security/i);
  assert.doesNotMatch(sql, /alter table\s+public\.mightpulse_api_(?:key|request)_budget\s+disable row level security/i);
});
