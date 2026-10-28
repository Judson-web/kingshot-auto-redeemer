import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ui = await readFile(new URL("../src/AllianceRegistration.tsx", import.meta.url), "utf8");
const handler = await readFile(new URL("../internal/kingshot/alliance-sync-handler.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../src/alliance-registration.css", import.meta.url), "utf8");
const en = await readFile(new URL("../src/shared/translations/en.js", import.meta.url), "utf8");
const ko = await readFile(new URL("../src/shared/translations/ko.js", import.meta.url), "utf8");

test("alliance page shows roster freshness and an inline read-only sync history", () => {
  assert.match(ui, /alliance\.rosterStaleTitle/);
  assert.match(ui, /alliance\.lastFetched/);
  assert.match(ui, /action:"history"/);
  assert.match(ui, /alliance\.syncHistoryTitle/);
  assert.match(ui, /alliance\.historyRetryHint/);
  assert.match(ui, /alliance\.departedMembersCurrent/);
  assert.match(handler, /if\(action==="history"\)/);
  assert.match(handler, /order by created_at desc limit 10/);
  assert.match(handler, /registration_status='departed'/);
  assert.match(handler, /departed_count/);
  assert.match(handler, /returning seen\.player_id/);
});

test("history is read-only and does not expose pause, resume, or deletion controls", () => {
  assert.match(ui, /alliance\.refreshHistory/);
  assert.doesNotMatch(ui, /alliance\.pauseSync|alliance\.resumeSync|action:"delete"/);
  const historyStart = handler.indexOf('if(action==="history")');
  const historyEnd = handler.indexOf('if(action==="capacity")');
  assert.ok(historyStart >= 0 && historyEnd > historyStart);
  const historyHandler = handler.slice(historyStart, historyEnd);
  assert.doesNotMatch(historyHandler, /insert into|update public\.|delete from/i);
});

test("English and Korean have matching keys for the new history and freshness UI", () => {
  const keys = [
    "alliance.rosterStaleTitle", "alliance.rosterFreshTitle", "alliance.lastFetched",
    "alliance.capacityRemaining", "alliance.capacityFullNote", "alliance.syncHistoryTitle",
    "alliance.refreshHistory", "alliance.historyLoading", "alliance.historyEmpty",
    "alliance.historyRetryHint", "alliance.historyDeparted", "alliance.runStatus.success", "alliance.runStatus.partial",
    "alliance.runStatus.error", "alliance.runStatus.running"
  ];
  for (const key of keys) {
    assert.ok(en.includes(JSON.stringify(key)), "English missing " + key);
    assert.ok(ko.includes(JSON.stringify(key)), "Korean missing " + key);
  }
});

test("freshness and history styles include narrow mobile layouts", () => {
  assert.match(css, /\.ks-alliance-freshness/);
  assert.match(css, /\.ks-alliance-history/);
  assert.match(css, /@media\s*\(max-width:\s*620px\)/);
});
