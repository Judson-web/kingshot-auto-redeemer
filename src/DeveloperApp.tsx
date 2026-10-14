import React, { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Copy, ExternalLink, KeyRound, LoaderCircle, LockKeyhole, Plus, Search, ShieldCheck, Trash2, UserRound, X } from "lucide-react";

type DeveloperKey = { id: string; key_prefix: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null; requests_today: number; daily_limit: number; minute_limit: number };
type PlayerResult = { playerId: string; name: string; kingdomId: string; power: number | string | null; townCenterLevel: number | string | null; avatarUrl: string | null };
async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
export default function DeveloperApp() {
  const [passkey, setPasskey] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [label, setLabel] = useState("My integration");
  const [keys, setKeys] = useState<DeveloperKey[]>([]);
  const [newKey, setNewKey] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [player, setPlayer] = useState<PlayerResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadKeys = async () => {
    try { const data = await request("/api/kingshot-tools/developer/keys"); setKeys(Array.isArray(data.keys) ? data.keys : []); setAuthenticated(true); }
    catch (e) { if (e instanceof Error && /session expired|unauthorized/i.test(e.message)) setAuthenticated(false); else setError(e instanceof Error ? e.message : "Could not load API keys."); }
  };
  useEffect(() => {
    let live = true;
    request("/api/kingshot-tools/developer/keys").then(data => { if (live) { setKeys(Array.isArray(data.keys) ? data.keys : []); setAuthenticated(true); } }).catch(() => { if (live) setAuthenticated(false); }).finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, []);
  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { await request("/api/kingshot-admin-login", { method: "POST", body: JSON.stringify({ accessKey: passkey }) }); setPasskey(""); setAuthenticated(true); await loadKeys(); setNotice("Admin access verified."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not verify passkey."); }
    finally { setBusy(false); }
  };
  const createKey = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice(""); setNewKey("");
    try { const data = await request("/api/kingshot-tools/developer/keys", { method: "POST", body: JSON.stringify({ label }) }); setNewKey(data.key); await loadKeys(); setNotice("API key created. Copy it now; it will not be shown again."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create API key."); }
    finally { setBusy(false); }
  };
  const revokeKey = async (key: DeveloperKey) => {
    if (!window.confirm("Revoke " + key.key_prefix + "? Any integration using it will stop working immediately.")) return;
    setBusy(true); setError(""); setNotice(""); setNewKey("");
    try { await request("/api/kingshot-tools/developer/keys/" + key.id, { method: "DELETE" }); await loadKeys(); setNotice("API key revoked."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not revoke API key."); }
    finally { setBusy(false); }
  };
  const lookup = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice(""); setPlayer(null);
    try {
      const data = await request("/api/kingshot-player?id=" + encodeURIComponent(playerId.trim()));
      const p = data.player || data;
      setPlayer({ playerId: String(p.governor_id || p.fid || p.id || playerId), name: String(p.nick_name || p.name || p.nickname || "Kingshot Player"), kingdomId: String(p.kid ?? p.kingdom_id ?? ""), power: p.power ?? null, townCenterLevel: p.town_center_level ?? p.tc_level ?? null, avatarUrl: p.avatar_url || p.avatar || p.avatarUrl || null });
    } catch (e) { setError(e instanceof Error ? e.message : "Player lookup failed."); }
    finally { setBusy(false); }
  };
  const logout = async () => { try { await request("/api/kingshot-admin-login", { method: "DELETE" }); } catch {} setAuthenticated(false); setKeys([]); setNewKey(""); setNotice("Signed out."); };
  const card: React.CSSProperties = { background: "#131821", border: "1px solid #2b3442", borderRadius: 18, padding: "clamp(18px, 4vw, 26px)", boxSizing: "border-box" };
  const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", marginTop: 7, padding: "12px 13px", borderRadius: 10, border: "1px solid #343e4d", background: "#0b0e14", color: "#f2f5fb", font: "inherit", outlineOffset: 2 };
  const button: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, border: 0, borderRadius: 10, padding: "11px 14px", background: "#7b82ff", color: "#fff", font: "inherit", fontWeight: 750, cursor: busy ? "wait" : "pointer", opacity: busy ? .65 : 1 };
  const labelStyle: React.CSSProperties = { display: "block", marginTop: 16, color: "#aeb8ca", fontSize: 11, letterSpacing: ".08em", fontWeight: 800 };
  const shell: React.CSSProperties = { minHeight: "100vh", background: "#0b0e14", color: "#f2f5fb", padding: "26px 16px 48px", fontFamily: "inherit" };
  if (checking) return <main style={shell}><div style={{ ...card, maxWidth: 720, margin: "12vh auto", display: "flex", gap: 10, alignItems: "center" }}><LoaderCircle className="spin" size={18}/> Checking developer access…</div></main>;
  return <main style={shell}><div style={{ maxWidth: 960, margin: "0 auto" }}>
    <header style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 25 }}><div style={{ width: 46, height: 46, display: "grid", placeItems: "center", borderRadius: 14, background: "#7b82ff22", color: "#b8bdff" }}><KeyRound size={23}/></div><div style={{ flex: 1 }}><div style={{ color: "#b8bdff", fontSize: 10, fontWeight: 850, letterSpacing: ".13em" }}>KINGSHOT REDEEMER · API V1</div><h1 style={{ fontSize: "clamp(27px, 5vw, 38px)", letterSpacing: "-.045em", margin: "4px 0 0" }}>Developer portal</h1></div><a href="/" style={{ color: "#c1c9d8", textDecoration: "none", fontSize: 12 }}>← Home</a></header>
    <p style={{ color: "#aeb8ca", lineHeight: 1.7, maxWidth: 760 }}>Create and manage developer keys, try a player lookup, and integrate the read-only player endpoint into your own tools. API secrets are stored only as hashes and shown once when created.</p>
    {error && <div role="alert" style={{ ...card, borderColor: "#8b3e4b", color: "#ffb6c0", display: "flex", gap: 9, alignItems: "flex-start", margin: "16px 0" }}><AlertTriangle size={17}/><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error" style={{ marginLeft: "auto", background: "transparent", color: "inherit", border: 0 }}><X size={15}/></button></div>}
    {notice && <div role="status" style={{ ...card, borderColor: "#27634b", color: "#9ce9c2", display: "flex", gap: 9, alignItems: "center", margin: "16px 0" }}><CheckCircle2 size={17}/>{notice}</div>}
    {!authenticated ? <section style={{ ...card, maxWidth: 620, marginTop: 20 }}><div style={{ display: "flex", gap: 10, alignItems: "center" }}><LockKeyhole size={20} color="#b8bdff"/><h2 style={{ fontSize: 19, margin: 0 }}>Admin access</h2></div><p style={{ color: "#aeb8ca", lineHeight: 1.6 }}>Enter the existing admin passkey to manage developer keys. This creates a short-lived, secure server session; the passkey is never stored in this page.</p><form onSubmit={login}><label style={labelStyle}>ADMIN PASSKEY<input style={input} type={showKey ? "text" : "password"} value={passkey} onChange={e => setPasskey(e.target.value)} autoComplete="current-password" required/></label><button type="button" onClick={() => setShowKey(v => !v)} style={{ marginTop: 8, background: "transparent", border: 0, color: "#aeb8ca", cursor: "pointer" }}>{showKey ? "Hide passkey" : "Show passkey"}</button><button style={{ ...button, width: "100%", marginTop: 18 }} disabled={busy || !passkey}>{busy ? <LoaderCircle className="spin" size={16}/> : <ShieldCheck size={16}/>} Unlock developer admin</button></form></section> : <>
      <section style={{ ...card, marginTop: 20 }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><ShieldCheck size={19} color="#9ce9c2"/><h2 style={{ fontSize: 19, margin: 0, flex: 1 }}>Admin · API key management</h2><button onClick={logout} style={{ ...button, background: "#252c38", padding: "8px 10px", fontSize: 12 }}>Sign out</button></div><p style={{ color: "#aeb8ca", lineHeight: 1.6 }}>At most two keys can ever be issued from one IP address. Revoking a key does not reset that IP's issuance allowance.</p>
        <form onSubmit={createKey} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "end", gap: 12 }}><label style={{ ...labelStyle, marginTop: 0 }}>KEY LABEL<input style={input} maxLength={80} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Discord bot"/></label><button style={button} disabled={busy || !label.trim()}><Plus size={16}/> Create key</button></form>
        {newKey && <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: "1px solid #7b82ff66", background: "#7b82ff0e" }}><b style={{ display: "block", marginBottom: 8 }}>Copy your new API key now</b><code style={{ display: "block", overflowWrap: "anywhere", lineHeight: 1.6, color: "#d5d8ff" }}>{newKey}</code><button onClick={() => navigator.clipboard.writeText(newKey).then(() => setNotice("API key copied to clipboard.")).catch(() => setError("Clipboard access failed; copy the key manually."))} style={{ ...button, marginTop: 10, background: "#353d67" }}><Copy size={15}/> Copy key</button></div>}
        <div style={{ marginTop: 20, display: "grid", gap: 10 }}>{keys.length ? keys.map(key => <article key={key.id} style={{ padding: 13, borderRadius: 12, border: "1px solid #2b3442", background: "#0b0e14", display: "flex", gap: 12, alignItems: "center" }}><KeyRound size={18} color={key.revoked_at ? "#697385" : "#b8bdff"}/><div style={{ flex: 1, minWidth: 0 }}><b>{key.label}</b><div style={{ color: "#aeb8ca", fontSize: 12, marginTop: 5, overflowWrap: "anywhere" }}>{key.key_prefix}… · {key.requests_today}/{key.daily_limit} daily requests · {key.minute_limit}/min</div><small style={{ color: key.revoked_at ? "#ffb6c0" : "#91dcb7" }}>{key.revoked_at ? "REVOKED" : "ACTIVE"} · created {new Date(key.created_at).toLocaleString()} · last used {key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "never"}</small></div>{!key.revoked_at && <button title="Revoke API key" aria-label={"Revoke " + key.label} onClick={() => revokeKey(key)} disabled={busy} style={{ ...button, background: "#3a2027", padding: 10 }}><Trash2 size={15}/></button>}</article>) : <p style={{ color: "#aeb8ca" }}>No developer keys yet.</p>}</div>
      </section>
      <section style={{ ...card, marginTop: 18 }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><UserRound size={19} color="#b8bdff"/><h2 style={{ fontSize: 19, margin: 0 }}>Player lookup</h2></div><p style={{ color: "#aeb8ca", lineHeight: 1.6 }}>Test the existing player lookup service. This does not redeem a code or register the player.</p><form onSubmit={lookup} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><input style={{ ...input, flex: "1 1 220px", marginTop: 0 }} value={playerId} onChange={e => setPlayerId(e.target.value.replace(/\D/g, "").slice(0, 20))} inputMode="numeric" autoComplete="off" placeholder="Kingshot Player ID" aria-label="Kingshot Player ID" required/><button style={button} disabled={busy || !/^\d{5,20}$/.test(playerId)}><Search size={16}/> Look up</button></form>
        {player && <div style={{ marginTop: 15, display: "flex", gap: 12, alignItems: "center", padding: 14, borderRadius: 12, background: "#0b0e14", border: "1px solid #2b3442" }}>{player.avatarUrl ? <img src={player.avatarUrl} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 13 }}/> : <UserRound size={34}/>}<div style={{ flex: 1 }}><b>{player.name || "Kingshot Player"}</b><div style={{ color: "#aeb8ca", fontSize: 12, marginTop: 5 }}>ID {player.playerId} · Kingdom {player.kingdomId || "—"} · TC {player.townCenterLevel ?? "—"}</div><div style={{ color: "#aeb8ca", fontSize: 12 }}>Power {player.power == null ? "—" : String(player.power)}</div></div></div>}
      </section>
      <section style={{ ...card, marginTop: 18 }}><div style={{ display: "flex", gap: 10, alignItems: "center" }}><Activity size={19} color="#b8bdff"/><h2 style={{ fontSize: 19, margin: 0 }}>Quick start</h2></div><p style={{ color: "#aeb8ca", lineHeight: 1.6 }}>Use your API key in the Authorization header. The player lookup is read-only and returns a limited public profile.</p><pre style={{ overflowX: "auto", padding: 14, borderRadius: 10, background: "#080a0f", color: "#d5d8ff", fontSize: 12, lineHeight: 1.6 }}><code>{'curl "https://kingshot-autoredeemer.vercel.app/api/v1/player?id=43180889" \\\n  -H "Authorization: Bearer YOUR_API_KEY"'}</code></pre><p style={{ color: "#aeb8ca", lineHeight: 1.6, fontSize: 12 }}>Rate limits: 60 requests/minute and 1,000/day per key; 120 requests/minute per IP. Requests require a valid API key. Use only Player IDs you are authorized to look up.</p><a href="https://github.com/Judson-web/kingshot-auto-redeemer" target="_blank" rel="noreferrer" style={{ color: "#b8bdff", display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}>Source and changelog <ExternalLink size={13}/></a></section>
    </>}
    <footer style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 22, paddingTop: 15, borderTop: "1px solid #252c38", color: "#8f9aab", fontSize: 11 }}><span>API v1 · Read-only player data</span><a href="/privacy?service=kingshot-auto" style={{ color: "inherit" }}>Privacy</a></footer>
  </div></main>;
}
