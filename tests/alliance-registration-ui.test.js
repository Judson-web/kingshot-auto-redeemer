import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const component = await readFile(new URL("../src/AllianceRegistration.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/alliance-registration.css", import.meta.url), "utf8");
const english = await readFile(new URL("../src/shared/translations/en.js", import.meta.url), "utf8");
const korean = await readFile(new URL("../src/shared/translations/ko.js", import.meta.url), "utf8");

test("alliance registration requires explicit member selection before registering", () => {
  assert.match(component, /setSelected\(\[\]\);/);
  assert.match(component, /disabled=\{registering \|\| !selected\.length\}/);
  assert.match(component, /const BATCH_LIMIT = 100/);
  assert.match(component, /if \(!batch\.length\) return/);
});;

test("alliance lookup ignores stale responses after a newer search or roster request", () => {
  assert.match(component, /const searchRequestRef = useRef\(0\)/);
  assert.match(component, /const rosterRequestRef = useRef\(0\)/);
  assert.match(component, /requestId !== searchRequestRef\.current/);
  assert.match(component, /requestId !== rosterRequestRef\.current/);
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
