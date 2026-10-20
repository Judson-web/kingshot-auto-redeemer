import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const cutoff = "20261030";

test("new public tables created on or after the Supabase Data API grant change have explicit ACL decisions", () => {
  const files = fs.readdirSync(migrationsDir)
    .filter(name => name.endsWith(".sql") && /^\d{8}/.test(name) && name.slice(0, 8) >= cutoff)
    .sort();
  const violations = [];

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const creates = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:public)\s*\.\s*)?([a-z_][a-z0-9_]*)/ig)];
    for (const match of creates) {
      // Unqualified CREATE TABLE is treated as public for this check because
      // public is the common migration search_path. Prefer schema qualification.
      const table = match[1];
      const qualifiedAcl = new RegExp(
        String.raw`(?:grant\s+[\s\S]*?\s+on\s+(?:table\s+)?public\s*\.\s*${table}\b|revoke\s+[\s\S]*?\s+on\s+(?:table\s+)?public\s*\.\s*${table}\b)`,
        "i"
      );
      const tableAcl = new RegExp(
        String.raw`(?:grant\s+[\s\S]*?\s+on\s+(?:table\s+)?${table}\b|revoke\s+[\s\S]*?\s+on\s+(?:table\s+)?${table}\b)`,
        "i"
      );
      if (!qualifiedAcl.test(sql) && !tableAcl.test(sql)) {
        violations.push(`${file}: public.${table} has no explicit GRANT/REVOKE decision`);
      }
    }
  }

  assert.deepEqual(violations, [], violations.join("\n"));
});
