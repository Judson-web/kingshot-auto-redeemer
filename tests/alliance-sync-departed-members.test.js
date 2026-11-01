import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const worker = await readFile(new URL('../internal/kingshot/alliance-sync-worker.ts', import.meta.url), 'utf8');
const handler = await readFile(new URL('../internal/kingshot/alliance-sync-handler.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../neon/migrations/20261029_alliance_departed_members.sql', import.meta.url), 'utf8');

test('scheduled and manual sync reconcile departures only after validating a fresh roster', () => {
  assert.ok(worker.indexOf('const roster=await loadRoster') < worker.indexOf("registration_status:'departed'"));
  assert.ok(handler.indexOf('roster=await readAlliance') < handler.indexOf("registration_status:'departed'"));
  assert.match(worker, /Incomplete roster rejected/);
  assert.match(handler, /Roster validation failed; no members were registered/);
});

test('a departed member who rejoins becomes eligible for reconciliation again', () => {
  assert.match(worker, /priorById.get\(member.id\)==='departed'\?'pending'/);
  assert.match(handler, /prior==='departed'\?'pending'/);
});

test('departed status is retained as history and never deletes global player registrations', () => {
  assert.match(worker, /Global player registrations are never removed/);
  assert.doesNotMatch(worker + handler, /delete\s+from\s+public\.kingshot_autoredeem/i);
  assert.match(migration, /'departed'::text/);
  assert.match(migration, /alliance_sync_seen_players_registration_status_check/);
});

test('departures are not inferred from empty or incomplete rosters', () => {
  assert.match(worker, /Incomplete roster rejected/);
  assert.match(handler, /if\(!raw\|\|raw\.length===0\)/);
  assert.match(handler, /Roster validation failed; no members were registered/);
});

test('invalid provider member counts fail closed in scheduled and manual sync', () => {
  for (const source of [worker, handler]) {
    assert.match(source, /Number\.isFinite\(count\)/);
    assert.match(source, /count<1/);
    assert.match(source, /rawCount==null\?/);
  }
});


test('automatic roster sync resumes bounded batches and schedules completed alliances for daily 11:00 UTC', () => {
  assert.match(worker, /function nextDailySyncAt\(\)/);
  assert.match(worker, /next\.setUTCHours\(11,0,0,0\)/);
  assert.match(worker, /p_next_run_at:nextRunAt/);
  assert.match(worker, /:nextDailySyncAt\(\)/);\n  assert.match(worker, /continuation\?new Date\(Date.now\(\)\+5\*60000\)/);
  assert.match(worker, /registerWithRetry\(input\)/);
  assert.match(worker, /registration_status:'departed'/);
});
