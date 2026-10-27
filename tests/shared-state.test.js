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
  const developerPanel = await readFile(new URL("../src/DeveloperAccountPanel.tsx", import.meta.url), "utf8");
  assert.match(developerPanel, /useAccountState\(\)/);
  assert.doesNotMatch(developerPanel, /request\("\/api\/kingshot-player\?developer=account-auth"\)/);
  assert.match(developerPanel, /developer=account-keys/);
});


test("profile dashboard access stays restricted while the signed-in header chip is available to all accounts", async () => {
  const { readFile } = await import("node:fs/promises");
  const chip = await readFile(new URL("../src/components/PublicAccountChip.jsx", import.meta.url), "utf8");
  const drawer = await readFile(new URL("../src/components/MobileNavDrawer.jsx", import.meta.url), "utf8");
  const profile = await readFile(new URL("../src/ProfileApp.tsx", import.meta.url), "utf8");
  const legal = await readFile(new URL("../src/LegalApp.jsx", import.meta.url), "utf8");

  assert.match(chip, /if\(!account\)return null;/,
    "the profile shortcut must appear for any signed-in account, regardless of first API-key generation");
  assert.match(chip, /dev=account\.role==="developer"\|\|account\.kind==="developer"/,
    "developer styling must still reflect verified developer status rather than ordinary sign-in");
  assert.match(profile, /if\(user&&!hasProfileAccess\)/,
    "a Discord session without developer/admin access must hit the restricted profile gate");
  assert.match(profile, /Open Developer API/,
    "the restricted profile gate must direct users to the API-key panel");
  assert.match(drawer, /id:"profile",href:"\/profile",label:"Profile",description:"Developer and admin account"/,
    "profile stays available in the navigation drawer");
  assert.match(legal, /at least one active developer API key/);
  assert.match(legal, /A successful Discord sign-in by itself verifies an identity but does not grant developer permissions/);
});

test("language selector supports English and Korean with a persistent selection", async () => {
  const { readFile } = await import("node:fs/promises");
  const header = await readFile(new URL("../src/components/PublicSiteHeader.jsx", import.meta.url), "utf8");
  const language = await readFile(new URL("../src/shared/site-language.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/public-site-header.css", import.meta.url), "utf8");
  assert.match(language, /flag:"🇺🇸".*label:"English"/s);
  assert.match(header, /ko:"자동 교환"/);
  assert.match(header, /role="listbox"/);
  assert.match(language, /localStorage\.setItem\(KEY,next\)/);
  assert.match(language, /document\.documentElement\.lang=next/);
  assert.match(styles, /\.ks-language-menu/);
});

test("account subscription and refresh requests share the same in-flight promise", async () => {
  const store = await import("../src/shared/account-state.js?account-reentrant-refresh");
  const calls = [];
  let release;
  const pendingResponse = new Promise(resolve => { release = resolve; });
  const mockFetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    return pendingResponse;
  };
  let reentrantPromise = null;
  const unsubscribe = store.subscribeAccountState(() => {
    if (!reentrantPromise) reentrantPromise = store.refreshAccount({ fetchImpl: mockFetch });
  }, { fetchImpl: mockFetch });
  await Promise.resolve();
  assert.ok(reentrantPromise, "the subscriber should observe the initial store update");
  release({ ok: true, json: async () => ({ authenticated: true, role: "admin", kind: "admin", user: { username: "Judson" } }) });
  await reentrantPromise;
  assert.equal(calls.length, 1, "a re-entrant subscriber must not launch a second profile-check");
  unsubscribe();
});


test("support topic picker and developer contact/code examples meet accessible-name and keyboard-scroll rules", async () => {
  const { readFile } = await import("node:fs/promises");
  const support = await readFile(new URL("../src/components/SupportWidget.tsx", import.meta.url), "utf8");
  const developer = await readFile(new URL("../src/DeveloperApp.tsx", import.meta.url), "utf8");
  const topicButtonStart = support.indexOf('className={"support-topic-trigger"');
  const topicButtonEnd = support.indexOf("</button>", topicButtonStart);
  const topicButton = topicButtonStart >= 0 && topicButtonEnd > topicButtonStart ? support.slice(topicButtonStart, topicButtonEnd) : "";
  assert.ok(topicButton, "support topic picker button exists");
  assert.doesNotMatch(topicButton, /aria-label=|aria-labelledby=/, "topic picker name must come from visible content");
  assert.match(topicButton, /<b id="support-topic-selected-value">\{topic\}<\/b>/);
  assert.match(support, /id="support-topic-selected-label">REQUEST CATEGORY/);
  assert.match(support, /id="support-topic-selected-value">\{topic\}/);
  assert.match(developer, /aria-label=\{"Open Discord profile for " \+ DEVELOPER_NAME/);
  const keyboardCodeExamples = developer.match(/<pre className="dev-code" tabIndex=\{0\} aria-label=/g) || [];
  assert.equal(keyboardCodeExamples.length, 5, "all five horizontally scrollable code examples should be keyboard-focusable, including the V4 redemption response");
});

test("language dictionaries are separate, persistent, and used by public navigation", async () => {
  const { readFile } = await import("node:fs/promises");
  const root = new URL("../src/", import.meta.url);
  const language = await readFile(new URL("shared/site-language.js", root), "utf8");
  const english = await readFile(new URL("shared/translations/en.js", root), "utf8");
  const korean = await readFile(new URL("shared/translations/ko.js", root), "utf8");
  const header = await readFile(new URL("components/PublicSiteHeader.jsx", root), "utf8");
  const drawer = await readFile(new URL("components/MobileNavDrawer.jsx", root), "utf8");
  assert.match(language, /localStorage\.setItem\(KEY,next\)/);
  assert.match(language, /import en from "\.\/translations\/en\.js"/);
  assert.match(language, /import ko from "\.\/translations\/ko\.js"/);
  assert.match(english, /"nav.auto":"Auto Redeem"/);
  assert.match(korean, /"nav.auto":"자동 교환"/);
  assert.match(header, /t\(link\.key,link\.label\)/);
  assert.match(drawer, /useSiteLanguage/);
});
