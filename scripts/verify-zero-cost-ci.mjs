import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/cloudflare-migration-ci.yml", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

assert.match(workflow, /supabase\/setup-cli@v1/, "CI must use the local Supabase CLI");
assert.match(workflow, /supabase start --exclude/, "CI must start disposable local Supabase services");
assert.match(workflow, /PGHOST: 127\.0\.0\.1/, "PostgreSQL tests must use loopback");
assert.match(workflow, /PGPORT: 54322/, "Supabase integration must use the local database port");
assert.doesNotMatch(workflow, /supabase\s+link\b|--linked\b/, "CI must not link to a remote Supabase project");
assert.doesNotMatch(workflow, /supabase\s+(?:branches|branch)\s+(?:create|new)\b/i, "CI must not create paid Supabase branches");
assert.doesNotMatch(workflow, /secrets\.(?:SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|SUPABASE_SERVICE_ROLE_KEY)\b/, "CI must not consume production Supabase credentials");

const deployCommands = workflow.match(/(?:wrangler(?:@\d+)?\s+deploy)[^\n]*/g) || [];
assert.ok(deployCommands.length > 0, "Expected an explicit Worker dry-run build");
for (const command of deployCommands) {
  assert.match(command, /--dry-run/, "Worker deploy commands in CI must be dry runs only");
}

assert.match(workflow, /timeout-minutes:/, "Every CI job should have a bounded timeout");
assert.equal(packageJson.scripts?.test, "node --experimental-strip-types --test", "Node tests must run with TypeScript stripping enabled");

console.log("Zero-cost migration CI guard passed: local-only Supabase, disposable PostgreSQL, no paid branches, no production secrets, no deployment.");
