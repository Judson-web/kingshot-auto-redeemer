import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
// Start the guard before the platform's October 30, 2026 Data API change.
const cutoff = "20261026";

test("new public tables have explicit ACL decisions and RLS enabled", () => {
  const files = fs.readdirSync(migrationsDir)
    .filter(name => name.endsWith(".sql") && /^\d{8}/.test(name) && name.slice(0, 8) >= cutoff)
    .sort();
  const violations = [];

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const creates = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\s*\.\s*)?([a-z_][a-z0-9_]*)/ig)];
    for (const match of creates) {
      // Unqualified CREATE TABLE is treated as public because public is the
      // common migration search_path. Qualified non-public schemas are skipped.
      const schema = (match[1] || "public").toLowerCase();
      if (schema !== "public") continue;
      const table = match[2];
      const aclPattern = new RegExp(
        String.raw`(?:grant|revoke)\s+[\s\S]*?\s+on\s+(?:table\s+)?(?:public\s*\.\s*)?${table}\b`,
        "i"
      );
      if (!aclPattern.test(sql)) {
        violations.push(`${file}: public.${table} has no explicit GRANT/REVOKE decision`);
      }
      const rlsPattern = new RegExp(
        String.raw`alter\s+table\s+(?:only\s+)?(?:public\s*\.\s*)?${table}\s+enable\s+row\s+level\s+security`,
        "i"
      );
      if (!rlsPattern.test(sql)) {
        violations.push(`${file}: public.${table} does not explicitly enable RLS`);
      }
    }
  }

  assert.deepEqual(violations, [], violations.join("\n"));
});
