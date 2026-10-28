import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../internal/kingshot/alliance-sync-worker.ts", import.meta.url), "utf8");
const handler = await readFile(new URL("../internal/kingshot/alliance-sync-handler.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../neon/migrations/20261029_alliance_departed_members.sql", import.meta.url), "utf8");

test("scheduled and manual sync mark absent members departed only after validating the roster", () => {
  for (const source of [worker, handler]) {
    const rosterRead = source.indexOf("const roster=");
    const markDeparted = source.indexOf("set registration_status='departed'");
    assert.ok(rosterRead >= 0 && markDeparted > rosterRead, "departure reconciliation follows roster validation");
    assert.match(source, /seen\.registration_status<>'departed'/);
    assert.match(source, /not \(seen\.player_id = any\(\$\{currentMemberIds\}::text\[\]\)\)/);
  }
});

test("a departed member who rejoins is made eligible for reconciliation again", () => {
  for (const source of [worker, handler]) {
    assert.match(source, /when alliance_sync_seen_players\.registration_status='departed' then 'pending'/);
  }
});

test("departed status is retained as history and never deletes global player registrations", () => {
  for (const source of [worker, handler]) {
    assert.match(source, /normal redemption cycle|normal auto-redemption cycle/i);
    assert.doesNotMatch(source, /delete\s+from\s+public\.kingshot_autoredeem/i);
  }
  assert.match(migration, /'departed'::text/);
  assert.match(migration, /alliance_sync_seen_players_registration_status_check/);
});

test("departures are not inferred from an empty or incomplete roster", () => {
  assert.match(worker, /Incomplete roster rejected/);
  assert.match(handler, /if\(!raw\|\|raw\.length===0\)/);
  assert.match(handler, /Roster validation failed; no members were registered/);
});
