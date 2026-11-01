import { verifyKingdom, type KingdomVerification } from "./mightpulse.js";
import { syncRegisteredPlayerProfile } from "./player.js";
import { normalizeRegistrationInput } from "./registration-input.js";
export { normalizeRegistrationInput } from "./registration-input.js";

export interface RegisterPlayerInput { playerId?: unknown; kingdomId?: unknown; playerName?: unknown; avatarUrl?: unknown; }
export interface RegisterPlayerResult { registered: boolean; alreadyRegistered: boolean; registrationStatus: string; kingdomVerified: boolean; verificationPending?: boolean; stale?: boolean; verifiedKingdomId?: string; player?: unknown; }

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_KEY) throw Error("Supabase service key is not configured on the server.");

async function announceRegistrationMilestone(): Promise<void> {
 try {
  const claimed = await rpc("claim_kingshot_registration_milestone", { p_milestone: 1000 });
  if (claimed !== true) return;
  const title = "A thousand strong. And counting.";
  const message = "The Kingshot Auto Redeemer community has reached 1,000 registered Player IDs. Thank you for building this with us. This milestone belongs to every player who joined the journey.";
  const announcement = await fetch(SUPABASE_URL + "/rest/v1/kingshot_announcements", { method: "POST", headers: { apikey: SUPABASE_KEY, authorization: "Bearer " + SUPABASE_KEY, "content-type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ title, message, type: "success", link_url: "/", link_label: "Explore the community", active: true, published_at: new Date().toISOString() }), signal: AbortSignal.timeout(8000) });
  if (!announcement.ok) throw Error("Could not publish the milestone announcement.");
  const webhook = String(process.env.DISCORD_KINGSHOT_WEBHOOK_URL || process.env.DISCORD_SCRAPER_WEBHOOK_URL || "").trim();
  if (webhook) {
   const parsed = new URL(webhook);
   if (parsed.protocol !== "https:" || !/discord(?:app)?\\.com$/i.test(parsed.hostname)) throw Error("Configured Kingshot Discord webhook is invalid.");
   const response = await fetch(parsed.toString(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ embeds: [{ title: "🏆 1,000 REGISTERED PLAYER IDS", description: message, color: 0xD6B56D, footer: { text: "Kingshot Auto Redeemer • Community milestone" }, timestamp: new Date().toISOString() }], allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(8000) });
   if (!response.ok) throw Error("Discord milestone delivery failed (" + response.status + ").");
  }
  try { const { broadcastPush } = await import("../push-notifications.js"); await broadcastPush({ title: "🏆 1,000 players. One community.", body: "We reached 1,000 registered Player IDs. Thank you for being part of the journey!", url: "/", tag: "kingshot-registration-milestone-1000" }); } catch (error) { console.error("[registration-milestone] push delivery failed", error); }
 } catch (error) { console.error("[registration-milestone] announcement failed", error); }
}

async function rpc(name: string, body: Record<string, unknown>): Promise<any> {
 const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, { method: "POST", headers: { apikey: SUPABASE_KEY, authorization: "Bearer " + SUPABASE_KEY, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
 const d = await r.json().catch(() => null);
 if (!r.ok) throw Error(d?.message || "Supabase request failed.");
 return Array.isArray(d) ? d[0] : d;
}

export async function registerPlayer(input: ReturnType<typeof normalizeRegistrationInput>): Promise<RegisterPlayerResult> {
 const banResponse=await fetch(SUPABASE_URL+"/rest/v1/kingshot_player_bans?select=player_id,reason,created_at&player_id=eq."+encodeURIComponent(input.playerId)+"&limit=1",{headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY},signal:AbortSignal.timeout(5000)});
 if(!banResponse.ok)throw Error("Registration policy check is temporarily unavailable. Please retry.");
 const bans=await banResponse.json().catch(()=>[]);
 if(Array.isArray(bans)&&bans[0]) {
  const blocked=Object.assign(new Error("This Player ID is blocked from registration. Reason: "+String(bans[0].reason||"Blocked by administrator")), {status:403,code:"player_banned",banned:true,ban:bans[0]});
  throw blocked;
 }
 const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/register_kingshot_player_v2", { method: "POST", headers: { apikey: SUPABASE_KEY, authorization: "Bearer " + SUPABASE_KEY, "content-type": "application/json" }, body: JSON.stringify({ p_player_id: input.playerId, p_kingdom_id: input.kingdomId || null, p_player_name: input.playerName || null, p_avatar_url: input.avatarUrl || null }), signal: AbortSignal.timeout(10000) });
 const d = await r.json().catch(() => null);
 if (!r.ok) throw Error(d?.message || d?.hint || "Could not register this player.");
 const result = Array.isArray(d) ? d[0] : d;
 if (!Boolean(result?.already_registered)) await announceRegistrationMilestone();
 try {
  const verified: KingdomVerification = await verifyKingdom(input.playerId);
  if (verified.notFound) {
   await rpc("mark_kingshot_player_stale", { p_player_id: input.playerId, p_reason: "MIGHTPULSE_PLAYER_NOT_FOUND" });
   return { registered: true, alreadyRegistered: Boolean(result?.already_registered), registrationStatus: result?.registration_status || (result?.already_registered ? "ALREADY_REGISTERED" : "NEW"), kingdomVerified: false, stale: true, player: result?.player || result };
  }
  await rpc("record_kingshot_kingdom_revalidation", { p_player_id: input.playerId, p_kingdom_id: verified.kingdomId, p_player_name: verified.name || input.playerName || null, p_avatar_url: verified.avatarUrl || input.avatarUrl || null });
  if (verified.player) {
   try { await syncRegisteredPlayerProfile(input.playerId, verified.player); } catch { /* Registration succeeds even if profile metadata is temporarily unavailable. */ }
  }
  return { registered: true, alreadyRegistered: Boolean(result?.already_registered), registrationStatus: result?.registration_status || (result?.already_registered ? "ALREADY_REGISTERED" : "NEW"), kingdomVerified: true, verifiedKingdomId: verified.kingdomId, player: result?.player || result };
 } catch {
  return { registered: true, alreadyRegistered: Boolean(result?.already_registered), registrationStatus: result?.registration_status || (result?.already_registered ? "ALREADY_REGISTERED" : "NEW"), kingdomVerified: false, verificationPending: true, player: result?.player || result };
 }
}
