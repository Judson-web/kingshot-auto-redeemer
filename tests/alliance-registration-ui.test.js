import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const component = await readFile(new URL("../src/AllianceRegistration.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/alliance-registration.css", import.meta.url), "utf8");
const english = await readFile(new URL("../src/shared/translations/en.js", import.meta.url), "utf8");
const korean = await readFile(new URL("../src/shared/translations/ko.js", import.meta.url), "utf8");
const api = await readFile(new URL("../api/kingshot-player.ts", import.meta.url), "utf8");

test("alliance registration requires explicit member selection before registering", () => {
  assert.match(component, /setSelected\(\[\]\);/);
  assert.match(component, /disabled=\{registering \|\| !selected\.length\}/);
  assert.match(component, /const BATCH_LIMIT = 100/);
  assert.match(component, /if \(!batch\.length\) return/);
});

test("alliance lookup ignores stale responses after a newer search or roster request", () => {
  assert.match(component, /const searchRequestRef = useRef\(0\)/);
  assert.match(component, /const rosterRequestRef = useRef\(0\)/);
  assert.match(component, /requestId !== searchRequestRef\.current/);
  assert.match(component, /requestId !== rosterRequestRef\.current/);
});

test("refreshing the same alliance preserves attempt history and only reconciles current selection", () => {
  assert.match(component, /const sameAlliance = Boolean/);
  assert.match(component, /if \(sameAlliance\) \{[\s\S]*?setSelected\(current => current\.filter\(id => validIds\.has\(id\)\)\)/);
  assert.match(component, /if \(!sameAlliance\) \{/);
});

test("a new search clears a superseded roster loading state", () => {
  assert.match(component, /rosterRequestRef\.current\+\+/);
  assert.match(component, /setLoadingRoster\(false\);\s*setRoster\(null\);/);
  assert.match(component, /normalized\.ageSeconds > 3600/);
});

test("alliance search submits the entered name or tag to the server", () => {
  assert.match(component, /mode: "search", kingdomId: kingdomId\.trim\(\), \.\.\.\(query\.trim\(\) \? \{ q: query\.trim\(\) \} : \{\}\)/);
});

test("alliance roster edge cases have explicit empty, stale-data, and refresh UI", () => {
  assert.match(component, /alliance\.emptyRosterTitle/);
  assert.match(component, /alliance\.staleRoster/);
  assert.match(component, /alliance\.refreshRoster/);
  assert.match(component, /alliance\.clearFilterHint/);
});

test("alliance page has reduced-motion, focus, and small-screen interaction styling", () => {
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /focus-visible/);
  assert.match(styles, /max-width: 420px/);
  assert.match(styles, /ks-alliance-empty-state/);
});

test("new alliance UI copy exists in both English and Korean dictionaries", () => {
  for (const key of ["alliance.flowFind", "alliance.clearSelection", "alliance.staleRoster", "alliance.refreshRoster"]) {
    assert.ok(english.includes('"' + key + '"'), "missing English translation: " + key);
    assert.ok(korean.includes('"' + key + '"'), "missing Korean translation: " + key);
  }
});


test("all alliance results are rendered without a show-more cap or exact-tag fallback", () => {
  assert.match(component, /filteredAlliances\.map\(item =>/);
  assert.doesNotMatch(component, /showAllAlliances|setShowAllAlliances|exactTagToggle|loadExactTag|ks-alliance-exact/);
});

test("alliance flag images reveal a fallback icon if the upstream asset fails", () => {
  assert.match(component, /className="ks-alliance-flag"><Users size=\{18\}/);
  assert.match(component, /onError=\{event => \{ event\.currentTarget\.style\.display = "none"; \}\}/);
  assert.match(api, /row\.icon_url \?\? row\.iconUrl/);
});

test("registration results use compact scrollable cards and explicitly mark existing registrations", () => {
  assert.match(component, /alliance\.alreadyRegistered/);
  assert.match(component, /allianceSyncCapacity\?\.canRegister/);
  assert.match(component, /allianceAlreadyRegistered/);
  assert.match(component, /kingdomAllianceCapReached/);
  assert.match(component, /className="ks-alliance-outcome-list" role="list"/);
  assert.match(styles, /\.ks-alliance-outcome-list \{ max-height: 360px; overflow-y: auto/);
});


test("alliance roster returns to the cached search results until the page is refreshed", () => {
  assert.match(component, /alliance\.backToList/);
  assert.match(component, /onClick=\{\(\) => \{ if \(!registering\) setActiveAlliance\(null\); \}\}/);
  assert.match(component, /if \(!forceRefresh && roster && roster\.alliance\.kingdomId/);
  assert.match(component, /loadRoster\(activeAlliance, true\)/);
});

test("registered roster members show status without a selection checkbox", () => {
  assert.match(component, /!registeredIds\.includes\(member\.playerId\) && !outcomes\.some\(item => item\.id === member\.playerId && item\.kind === "existing"\) && <input type="checkbox"/);
});

test("automatic alliance sync is informational and scheduled after first registration", () => {
  assert.match(component, /action: "create", kingdomId: activeAlliance\.kingdomId/);
  assert.match(component, /interval_hours|Every 24 hours|alliance\.syncEvery24/);
  assert.doesNotMatch(component, /alliance\.enableAutoSync/);
  assert.doesNotMatch(component, /updateAutoSync\("sync"\)|alliance\.pauseSync/);
});

test("alliance flag is visible in the roster identity and retains a fallback icon", () => {
  assert.match(component, /ks-alliance-roster-flag/);
  assert.match(component, /ks-alliance-roster-flag"><Users size=\{18\}/);
});


test("alliance batch cancellation stops before submitting the next player", () => {
  assert.match(component, /cancelRequestedRef\.current = true/);
  assert.match(component, /if \(cancelRequestedRef\.current\) break/);
  assert.match(component, /alliance\.cancelRegistration/);
  assert.match(component, /window\.addEventListener\("pagehide", handlePageHide\)/);
});

test("automatic registration cancellation preserves completed outcomes and skips unstarted IDs", async () => {
  const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  assert.match(main, /if\(cancelRequestedRef\.current\)break/);
  assert.match(main, /auto\.cancelRegistration/);
  assert.match(main, /auto\.cancelled/);
  assert.match(main, /window\.addEventListener\("pagehide",handlePageHide\)/);
});

test("manual redeem cancellation never automatically retries an uncertain redemption", async () => {
  const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  assert.match(main, /manualControllerRef\.current\?\.abort\(\)/);
  assert.match(main, /manual\.cancelledUnknown/);
  assert.match(main, /manualAbortReasonRef\.current==="user"/);
  assert.match(main, /if\(manualAbortReasonRef\.current==="user"\)throw/);
});

test("cancellation guidance is available in English and Korean", () => {
  for (const key of ["auto.cancelRegistration", "auto.cancelPending", "auto.cancelled", "manual.stopWaiting", "manual.cancelledUnknown", "alliance.cancelRegistration", "alliance.cancelled"]) {
    assert.ok(english.includes('"' + key + '"'), "missing English translation: " + key);
    assert.ok(korean.includes('"' + key + '"'), "missing Korean translation: " + key);
  }
});
