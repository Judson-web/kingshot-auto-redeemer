/** Server-only Supabase store for live automatic alliance-sync state. */
const BASE = process.env.SUPABASE_URL || 'https://wocxvtptqapietlteshr.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
export async function sb(path: string, init: RequestInit = {}) {
  if (!KEY) throw new Error('Supabase service key is not configured.');
  const response = await fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json', accept: 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(12000) });
  const text = await response.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!response.ok) { const err: any = new Error(data?.message || data?.details || `Supabase alliance-sync request failed (${response.status}).`); err.status = response.status; err.code = data?.code || data?.hint || 'supabase_error'; throw err; }
  return data;
}
export const selectRows = (table: string, query: string) => sb(`${table}?${query}`);
export const insertRows = (table: string, body: unknown) => sb(table, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
export const patchRows = (table: string, query: string, body: unknown) => sb(`${table}?${query}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
export const callRpc = (name: string, body: unknown) => sb(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
export const enc = (v: unknown) => encodeURIComponent(String(v));
