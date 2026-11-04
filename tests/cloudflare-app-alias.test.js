import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("canonical app alias forwards to the production Worker with same-zone fetch enabled", async () => {
  const worker = await readFile(new URL("../cloudflare/app-alias.js", import.meta.url), "utf8");
  const config = await readFile(new URL("../wrangler.app-alias.jsonc", import.meta.url), "utf8");

  assert.ok(worker.includes('https://kingshot-autoredeemer-edge.ks-redeemer.workers.dev'));
  assert.ok(worker.includes('x-forwarded-host'));
  assert.ok(worker.includes('x-forwarded-proto'));
  assert.ok(config.includes('"name": "app"'));
  assert.ok(config.includes('"workers_dev": true'));
  assert.ok(config.includes('"global_fetch_strictly_public"'));
});
