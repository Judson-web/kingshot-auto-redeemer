import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/health.js", import.meta.url), "utf8");

test("worker diagnostics infer the handled-code count from shard telemetry", () => {
  assert.match(source, /const codeCounts=summary\.codeCounts&&typeof summary\.codeCounts==="object"/);
  assert.match(source, /Object\.keys\(codeCounts\)\.filter\(code=>!code\.includes\("_status_"\)\)\.length/);
  assert.match(source, /codes:codeCount/);
});
