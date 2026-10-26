import test from "node:test";
import assert from "node:assert/strict";

test("service status normalizes maintenance and health through shared refresh functions", async () => {
  const store = await import("../src/shared/service-status.js?service-happy");
  const calls = [];
  const mockFetch = async (url) => {
    calls.push(url);
    if (url.includes("public=maintenance")) {
      return { ok: true, json: async () => ({ maintenanceEnabled: true, message: "Planned update", endsAt: "2026-10-26T20:00:00Z" }) };
    }
    return { ok: true, json: async () => ({ healthy: true, status: "COMPLETED", lastCompletedAt: "2026-10-26T17:00:00Z", locked: false }) };
  };
  await Promise.all([
    store.refreshMaintenanceStatus(mockFetch),
    store.refreshHealthStatus(mockFetch)
  ]);
  const state = store.getServiceStatusSnapshot();
  assert.equal(state.maintenance.verified, true);
  assert.equal(state.maintenance.maintenanceEnabled, true);
  assert.equal(state.maintenance.message, "Planned update");
  assert.equal(state.health.kind, "online");
  assert.equal(state.health.status, "COMPLETED");
  assert.equal(calls.length, 2);
});

test("maintenance verification fails closed and preserves the last verified state on a transient error", async () => {
  const store = await import("../src/shared/service-status.js?service-fail-closed");
  const good = async () => ({ ok: true, json: async () => ({ maintenanceEnabled: false }) });
  await store.refreshMaintenanceStatus(good);
  assert.equal(store.getServiceStatusSnapshot().maintenance.verified, true);
  assert.equal(store.getServiceStatusSnapshot().maintenance.maintenanceEnabled, false);
  await assert.rejects(() => store.refreshMaintenanceStatus(async () => ({ ok: false, json: async () => ({ error: "offline" }) })));
  const next = store.getServiceStatusSnapshot().maintenance;
  assert.equal(next.verified, true);
  assert.equal(next.maintenanceEnabled, false);
  assert.equal(next.error, true);
});

test("account state shares one profile-check request and falls back to a developer session only when needed", async () => {
  const store = await import("../src/shared/account-state.js?account-shared");
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const mockFetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    await gate;
    return { ok: true, json: async () => ({ authenticated: true, role: "admin", kind: "admin", user: { username: "Judson", avatar_url: "https://cdn.discordapp.com/test.png" } }) };
  };
  const first = store.refreshAccount({ fetchImpl: mockFetch });
  const second = store.refreshAccount({ fetchImpl: mockFetch });
  assert.equal(first, second);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body.action, "profile-check");
  assert.equal(a.username, "Judson");
  assert.equal(b.role, "admin");
  assert.equal(store.getAccountStateSnapshot().account.username, "Judson");
});

test("a late auth response cannot restore the account after a logout mutation", async () => {
  const store = await import("../src/shared/account-state.js?account-logout-race");
  let resolveFetch;
  const deferred = new Promise(resolve => { resolveFetch = resolve; });
  const pending = store.refreshAccount({ fetchImpl: async () => deferred });
  store.setAccountState(null);
  resolveFetch({ ok: true, json: async () => ({ authenticated: true, role: "admin", kind: "admin", user: { username: "Judson" } }) });
  await pending;
  assert.equal(store.getAccountStateSnapshot().account, null);
  assert.equal(store.getAccountStateSnapshot().status, "anonymous");
});

test("maintenance gate, profile status and shared header consume common state stores", async () => {
  const { readFile } = await import("node:fs/promises");
  const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  const profile = await readFile(new URL("../src/ProfileApp.tsx", import.meta.url), "utf8");
  const chip = await readFile(new URL("../src/components/PublicAccountChip.jsx", import.meta.url), "utf8");
  assert.match(main, /useServiceStatus\(\{criticalMaintenance:true\}\)/);
  assert.doesNotMatch(main, /const timer=setInterval\(load,5000\)/);
  assert.doesNotMatch(main, /function SiteStatus\(\)/);
  assert.doesNotMatch(main, /function PublicMaintenance\(\)/);
  assert.match(profile, /useServiceStatus\(\{includeHealth:true\}\)/);
  assert.match(profile, /useAccountState\(\)/);
  assert.doesNotMatch(profile, /const roleTimer=window\.setInterval\(refreshRole,30000\)/);
  assert.match(chip, /useAccountState\(\)/);
  assert.doesNotMatch(chip, /window\.setInterval\(load,30000\)/);
});
