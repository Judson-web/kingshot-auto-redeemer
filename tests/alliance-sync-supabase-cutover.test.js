import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const worker = await readFile(new URL('../internal/kingshot/alliance-sync-worker.ts', import.meta.url), 'utf8');
const handler = await readFile(new URL('../internal/kingshot/alliance-sync-handler.ts', import.meta.url), 'utf8');
const store = await readFile(new URL('../internal/kingshot/alliance-sync-store.ts', import.meta.url), 'utf8');
const admin = await readFile(new URL('../lib/admin-data.js', import.meta.url), 'utf8');
const rpcMigration = await readFile(new URL('../supabase/migrations/20261030200000_raise_exact_case_alliance_sync_cap_to_four.sql', import.meta.url), 'utf8');
test('live automatic alliance sync no longer connects to Neon', () => {
 for (const source of [worker,handler,admin]) assert.doesNotMatch(source, /@neondatabase\/serverless|ALLIANCE_SYNC_DATABASE_URL/);
 assert.match(worker,/claim_due_alliance_sync_config/); assert.match(handler,/register_alliance_sync_config/); assert.match(handler,/finish_alliance_sync_run/); assert.match(store,/SUPABASE_SERVICE_ROLE_KEY/);
});
test('single-owner and four-per-kingdom constraints remain transactional', () => { assert.match(rpcMigration,/pg_advisory_xact_lock/); assert.match(rpcMigration,/if v_total >= 4 then/); assert.match(rpcMigration,/alliance_already_managed/); });
test('worker uses fenced leases and retains departed-member history', () => { assert.match(worker,/lease_token=eq/); assert.match(worker,/registration_status:'departed'/); assert.match(handler,/registration_status:'departed'/); assert.match(worker,/Global player\s+registrations are never removed/); });
test('admin unregister disables configuration without deleting sync history', () => { assert.match(admin,/Preserve sync history and seen-player audit rows/); assert.match(admin,/last_status:\"unregistered\"/); assert.doesNotMatch(admin,/sql\.query\(\"delete from public\.alliance_sync_/i); });

test('admin alliance registration accepts canonical provider governor IDs and scopes them to the kingdom', () => { assert.ok(admin.includes('m?.governor_id??m?.fid??m?.player_id')); assert.ok(admin.includes('m?.kid??m?.kingdom_id??kingdom')); assert.ok(admin.includes('authorization:\"Bearer \"+SUPABASE_KEY')); });
