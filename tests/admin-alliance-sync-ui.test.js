import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const component = await readFile(new URL("../src/AdminAllianceSyncApp.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/admin-alliance-sync.css", import.meta.url), "utf8");

test("admin alliance page aborts and ignores stale roster responses", () => {
  assert.match(component, /rosterAbort\.current\?\.abort\(\)/);
  assert.match(component, /requestId!==rosterRequest\.current/);
  assert.match(component, /controller\.signal/);
  assert.match(component, /mounted\.current&&requestId===rosterRequest\.current/);
});

test("roster refresh preserves only selected IDs still eligible for registration", () => {
  assert.match(component, /const valid=new Set\(next\.filter\(m=>!m\.alreadyRegistered\)\.map\(m=>m\.playerId\)\)/);
  assert.match(component, /setSelected\(current=>current\.filter\(id=>valid\.has\(id\)\)\)/);
});

test("roster errors are recoverable and isolated from configuration loading", () => {
  assert.match(component, /rosterError&&<div className="aas-alert aas-alert-error aas-roster-alert"/);
  assert.match(component, /onClick=\{\(\)=>void openRoster\(c,\{refresh:true\}\)\}/);
  assert.match(component, /Could not load the live roster/);
});

test("manual registration displays results after refreshing the roster", () => {
  assert.match(component, /await openRoster\(target,\{refresh:true\}\);setResult\(summary\);setNotice\(summary\.failed/);
  assert.match(component, /Review failed registrations/);
});

test("selection controls operate on visible eligible members and report accurate counts", () => {
  assert.match(component, /const visibleEligible=useMemo/);
  assert.match(component, /const allVisibleSelected=visibleEligible\.length>0/);
  assert.match(component, /toggleVisible/);
  assert.match(component, /players need registration/);
});

test("unregister uses an accessible confirmation dialog instead of a browser-native prompt", () => {
  assert.match(component, /role="dialog" aria-modal="true"/);
  assert.match(component, /aria-labelledby="aas-confirm-title"/);
  assert.doesNotMatch(component, /window\.confirm/);
});

test("admin layout supports small screens, keyboard focus, and reduced motion", () => {
  assert.match(styles, /@media\(max-width:650px\)/);
  assert.match(styles, /@media\(max-width:380px\)/);
  assert.match(styles, /focus-visible/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
});

test("admin UI clearly distinguishes registered members, failures, and disabled syncs", () => {
  assert.match(component, /is-registered/);
  assert.match(component, /aas-result-warning/);
  assert.match(component, /aas-enabled.*is-disabled/);
  assert.match(component, /Last sync error/);
});
