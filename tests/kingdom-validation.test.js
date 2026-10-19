import test from "node:test";
import assert from "node:assert/strict";
import { revalidatePlayer } from "../internal/kingshot/kingdom-validation.ts";

const NOW = Date.parse("2026-10-19T00:01:00.000Z");
const snapshot = (overrides = {}) => ({
  fresh: true,
  cached_at: "2026-10-19T00:00:00.000Z",
  age_seconds: 60,
  player: { kid: "1143", nick_name: "Test Player", avatar_url: null },
  ...overrides
});
const currentPlayer = (overrides = {}) => ({
  player_id: "123456789",
  kingdom_id: "1125",
  last_kingdom_check_at: "2026-10-18T22:00:00.000Z",
  enabled: true,
  stale: false,
  ...overrides
});

function harness({ fetchPlayer = async () => ({ status: 200, snapshot: snapshot() }), claim = { claimed: true } } = {}) {
  const calls = [];
  const notifications = [];
  const rpc = async (name, body) => {
    calls.push({ name, body });
    if (name === "claim_kingshot_kingdom_reset_check" || name === "claim_kingshot_kingdom_manual_check") return claim;
    if (name === "defer_kingshot_kingdom_reset_check") return { ok: true };
    if (name === "record_kingshot_kingdom_revalidation") {
      return {
        ok: true,
        kingdom_changed: body.p_kingdom_id !== "1125",
        old_kingdom_id: "1125",
        new_kingdom_id: body.p_kingdom_id,
        player: currentPlayer({ kingdom_id: body.p_kingdom_id, last_kingdom_check_at: new Date(NOW).toISOString() })
      };
    }
    if (name === "release_kingshot_kingdom_reset_check") return true;
    if (name === "mark_kingshot_player_stale") throw new Error("stale mutation must not occur for a single 404");
    return [];
  };
  return {
    calls,
    notifications,
    dependencies: { rpc, notify: async event => notifications.push(event), fetchPlayer, nowMs: () => NOW }
  };
}

test("valid fresh post-reset snapshot records the verified kingdom", async () => {
  const h = harness();
  const result = await revalidatePlayer(currentPlayer(), h.dependencies);
  assert.equal(result.revalidated, true);
  assert.equal(result.player.kingdom_id, "1143");
  assert.equal(h.calls.filter(call => call.name === "record_kingshot_kingdom_revalidation").length, 1);
  assert.equal(h.calls.some(call => call.name === "defer_kingshot_kingdom_reset_check"), false);
});

test("scheduled validation claims the player before any provider fetch", async () => {
  const order = [];
  const h = harness({ fetchPlayer: async () => { order.push("fetch"); return { status: 200, snapshot: snapshot() }; } });
  const rpc = h.dependencies.rpc;
  h.dependencies.rpc = async (name, body) => { if (name.startsWith("claim_kingshot_")) order.push("claim"); return rpc(name, body); };
  await revalidatePlayer(currentPlayer({ kingdom_id: null }), h.dependencies);
  assert.deepEqual(order.slice(0, 2), ["claim", "fetch"]);
});

test("freshness failure defers without recording kingdom, marking stale, or notifying", async () => {
  const h = harness({ fetchPlayer: async () => ({ status: 200, snapshot: snapshot({ fresh: false }) }) });
  const result = await revalidatePlayer(currentPlayer(), h.dependencies);
  assert.equal(result.deferred, true);
  assert.equal(result.player.kingdom_id, "1125");
  assert.equal(h.calls.some(call => call.name === "record_kingshot_kingdom_revalidation"), false);
  assert.equal(h.calls.some(call => call.name === "mark_kingshot_player_stale"), false);
  assert.equal(h.notifications.length, 0);
  assert.equal(h.calls.some(call => call.name === "defer_kingshot_kingdom_reset_check"), true);
});

test("missing wrapper metadata defers with no player-state side effects", async () => {
  const h = harness({ fetchPlayer: async () => ({ status: 200, snapshot: { player: { kid: "1143" } } }) });
  const result = await revalidatePlayer(currentPlayer(), h.dependencies);
  assert.equal(result.deferred, true);
  assert.equal(result.player.kingdom_id, "1125");
  assert.equal(h.calls.some(call => call.name === "record_kingshot_kingdom_revalidation"), false);
  assert.equal(h.notifications.length, 0);
});

test("a single upstream 404 defers six hours without staling or notifying", async () => {
  const h = harness({ fetchPlayer: async () => ({ status: 404 }) });
  const result = await revalidatePlayer(currentPlayer(), h.dependencies);
  assert.equal(result.deferred, true);
  assert.equal(result.stale, undefined);
  assert.equal(result.player.kingdom_id, "1125");
  assert.equal(h.calls.some(call => call.name === "mark_kingshot_player_stale"), false);
  assert.equal(h.calls.some(call => call.name === "record_kingshot_kingdom_revalidation"), false);
  assert.equal(h.notifications.length, 0);
  const defer = h.calls.find(call => call.name === "defer_kingshot_kingdom_reset_check");
  assert.equal(Date.parse(defer.body.p_retry_after_at), NOW + 21_600_000);
});

test("forced check takes the manual claim and cannot bypass a persisted retry window", async () => {
  const h = harness({ claim: { claimed: false, deferred: true, retry_after_at: new Date(NOW + 300_000).toISOString() } });
  const result = await revalidatePlayer(currentPlayer(), h.dependencies, { force: true });
  assert.equal(h.calls[0].name, "claim_kingshot_kingdom_manual_check");
  assert.equal(result.deferred, true);
  assert.equal(result.player.kingdom_id, "1125");
  assert.equal(h.calls.some(call => call.name === "record_kingshot_kingdom_revalidation"), false);
  assert.equal(h.calls.some(call => call.name === "fetchPlayer"), false);
});

test("HTTP 429 honors Retry-After and timeout/5xx produce bounded deferrals", async () => {
  for (const resultData of [
    { status: 429, retryAfterMs: 45_000 },
    { status: 503 },
    { status: 504, error: "MightPulse request timed out" }
  ]) {
    const h = harness({ fetchPlayer: async () => resultData });
    const result = await revalidatePlayer(currentPlayer(), h.dependencies);
    assert.equal(result.deferred, true);
    assert.equal(h.calls.some(call => call.name === "record_kingshot_kingdom_revalidation"), false);
    assert.equal(h.calls.some(call => call.name === "defer_kingshot_kingdom_reset_check"), true);
    assert.equal(h.notifications.length, 0);
  }
});

test("failed deferral persistence does not release the claim into a hot retry loop", async () => {
  const h = harness({ fetchPlayer: async () => ({ status: 404 }) });
  const rpc = h.dependencies.rpc;
  h.dependencies.rpc = async (name, body) => {
    if (name === "defer_kingshot_kingdom_reset_check") throw new Error("database unavailable");
    return rpc(name, body);
  };
  const result = await revalidatePlayer(currentPlayer(), h.dependencies);
  assert.equal(result.deferred, true);
  assert.equal(h.calls.some(call => call.name === "release_kingshot_kingdom_reset_check"), false);
});
