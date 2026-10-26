import React, { useEffect, useState } from "react";
import "./developer-page.css";
import "./developer-redesign.css";
import PublicSiteHeader from "./components/PublicSiteHeader.jsx";
import DeveloperAccountPanel from "./DeveloperAccountPanel";
import { Activity, BookOpen, Check, ChevronRight, Code2, Copy, ExternalLink, Gauge, KeyRound, MessageCircle, ShieldCheck, Terminal } from "lucide-react";
import { copyToClipboard } from "./utils/clipboard-feedback";

const ORIGIN = "https://kingshot-autoredeemer.vercel.app";
const DEVELOPER_NAME = "Judson";
const DEVELOPER_DISCORD_USERNAME = "judson00713";
const DEVELOPER_DISCORD_ID = "871756466900598815";
const DEVELOPER_DISCORD_URL = "https://discord.com/users/" + DEVELOPER_DISCORD_ID;
type MaintainerDiscordProfile = { id: string; username?: string; globalName?: string | null; avatar?: string | null; animated?: boolean; avatarUrl?: string | null; format?: string; };
const endpoint = ORIGIN + "/api/v3/players/43180889";
const curlExample = 'curl "' + endpoint + '" \\\n  -H "Authorization: Bearer YOUR_API_KEY"';

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="dev-copy-button" type="button" onClick={async () => { try { const feedbackLabel = label.replace(/^\s*copy\s*/i, "").trim() || "Text"; await copyToClipboard(value, feedbackLabel); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { setCopied(false); } }} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, border: "1px solid #343e4d", borderRadius: 9, padding: "8px 11px", background: "#202633", color: "#e8ebf5", font: "inherit", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}><Copy size={14}/>{copied ? "Copied" : label}</button>;
}

export default function DeveloperApp() {
  const [maintainerProfile, setMaintainerProfile] = useState<MaintainerDiscordProfile | null>(null);
  const [maintainerAvatarFailed, setMaintainerAvatarFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let version = 0;
    const loadProfile = async () => {
      const currentVersion = ++version;
      try {
        const response = await fetch("/api/discord-user?id=" + encodeURIComponent(DEVELOPER_DISCORD_ID), { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) return;
        const profile = await response.json();
        if (!active || currentVersion !== version || String(profile?.id || "") !== DEVELOPER_DISCORD_ID || typeof profile?.username !== "string") return;
        setMaintainerProfile({ id: DEVELOPER_DISCORD_ID, username: profile.username.slice(0, 32), globalName: typeof profile.globalName === "string" ? profile.globalName.slice(0, 80) : null, avatar: typeof profile.avatar === "string" ? profile.avatar : null, animated: profile.animated === true, avatarUrl: typeof profile.avatarUrl === "string" ? profile.avatarUrl : null, format: typeof profile.format === "string" ? profile.format : "png" });
      } catch { /* The monogram remains available if Discord profile lookup is temporarily unavailable. */ }
    };
    void loadProfile();
    const onFocus = () => { void loadProfile(); };
    window.addEventListener("focus", onFocus);
    return () => { active = false; version++; window.removeEventListener("focus", onFocus); };
  }, []);
  const maintainerHandle = maintainerProfile?.username || DEVELOPER_DISCORD_USERNAME;
  const avatarHash = typeof maintainerProfile?.avatar === "string" && /^[A-Za-z0-9_]{20,80}$/.test(maintainerProfile.avatar) ? maintainerProfile.avatar : "";
  const avatarFormat = avatarHash.startsWith("a_") || maintainerProfile?.animated ? "gif" : "png";
  let fallbackAvatarUrl = "";
  try { const candidate = new URL(String(maintainerProfile?.avatarUrl || "")); if (candidate.protocol === "https:" && candidate.hostname === "cdn.discordapp.com" && !candidate.username && !candidate.password) fallbackAvatarUrl = candidate.href; } catch { /* Ignore untrusted or malformed profile URLs. */ }
  const maintainerAvatarSrc = avatarHash ? "/api/discord-avatar?id=" + encodeURIComponent(DEVELOPER_DISCORD_ID) + "&hash=" + encodeURIComponent(avatarHash) + "&format=" + avatarFormat + "&size=128" : fallbackAvatarUrl;
  useEffect(() => { setMaintainerAvatarFailed(false); }, [maintainerAvatarSrc]);
  useEffect(() => {
    const title = "Kingshot Developer API Documentation";
    const description = "V3 integration guide for the Kingshot Auto Redeemer community API: authentication, player lookup, manual redemption, quotas, and response codes.";
    document.title = title;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "description"; document.head.appendChild(meta); }
    meta.content = description;
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) { robots = document.createElement("meta"); robots.name = "robots"; document.head.appendChild(robots); }
    robots.content = "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1";
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.appendChild(canonical); }
    canonical.href = ORIGIN + "/developer";
    const schema = { "@context": "https://schema.org", "@type": "TechArticle", headline: title, description, author: { "@type": "Person", name: DEVELOPER_NAME, url: DEVELOPER_DISCORD_URL }, url: ORIGIN + "/developer", mainEntityOfPage: ORIGIN + "/developer", about: { "@type": "WebAPI", name: "Kingshot Developer API", documentation: ORIGIN + "/developer.md", termsOfService: ORIGIN + "/terms" }, isPartOf: { "@type": "WebSite", name: "Kingshot Auto Redeemer", url: ORIGIN } };
    let script = document.getElementById("developer-api-jsonld") as HTMLScriptElement | null;
    if (!script) { script = document.createElement("script"); script.id = "developer-api-jsonld"; script.type = "application/ld+json"; document.head.appendChild(script); }
    script.textContent = JSON.stringify(schema);
    return () => { document.title = "Kingshot Auto Redeem"; meta?.setAttribute("content", "Redeem Kingshot gift codes with less hassle. Register your player for automatic code checks or use the manual redemption tool."); canonical?.setAttribute("href", ORIGIN + "/"); script?.remove(); };
  }, []);
  const [tab, setTab] = useState<"curl" | "javascript">("curl");
  const [expanded, setExpanded] = useState("");
  const code = tab === "curl" ? curlExample : `const response = await fetch("${endpoint}", {
  headers: {
    Authorization: "Bearer YOUR_API_KEY",
  },
});

if (!response.ok) {
  throw new Error("API request failed: " + response.status);
}

const result = await response.json();
console.log(result.data.playerId, result.data.name);`;
  const card: React.CSSProperties = { background: "#131821", border: "1px solid #2b3442", borderRadius: 16, padding: "clamp(17px, 4vw, 24px)", boxSizing: "border-box" };
  const heading: React.CSSProperties = { margin: "0 0 10px", fontSize: 19, letterSpacing: "-.02em" };
  const paragraph: React.CSSProperties = { color: "#aeb8ca", lineHeight: 1.7, margin: "8px 0 0", fontSize: 14 };
  const codeStyle: React.CSSProperties = { margin: 0, overflowX: "auto", padding: 15, borderRadius: 11, background: "#080a0f", color: "#d5d8ff", fontSize: 12, lineHeight: 1.75, whiteSpace: "pre" };
  const accordion = (id: string, title: string, body: React.ReactNode) => <section className="dev-accordion" style={{ ...card, padding: 0, overflow: "hidden" }}><button className="dev-accordion-trigger" type="button" onClick={() => setExpanded(expanded === id ? "" : id)} aria-expanded={expanded === id} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: 17, textAlign: "left", background: "transparent", color: "#f2f5fb", border: 0, font: "inherit", cursor: "pointer" }}><ChevronRight size={16} style={{ transform: expanded === id ? "rotate(90deg)" : "none", transition: "transform .15s" }}/><b style={{ flex: 1 }}>{title}</b></button>{expanded === id && <div style={{ padding: "0 18px 18px" }}>{body}</div>}</section>;
  return <div className="dev-dashboard ks-dev-route" aria-labelledby="developer-docs-title">
    <PublicSiteHeader current="developer" />
    <main className="dev-shell dev-page">
      <header className="dev-overview">
        <div><div className="dev-eyebrow">Developer workspace / Overview</div><h1 id="developer-docs-title" className="dev-page-title">Developer API documentation</h1><p className="dev-muted">Manage your API credentials and integrate Kingshot player data into your tools.</p></div>
        <span className="dev-version-pill"><span style={{width:7,height:7,borderRadius:9,background:"#9ce9c2",boxShadow:"0 0 0 3px #9ce9c21c"}}/> API v3 <span style={{color:"#687487"}}>·</span> HTTPS</span>
      </header>
      <div className="dev-stat-grid" aria-label="API overview">
        <article className="dev-stat"><div className="dev-stat-label">Endpoint</div><div className="dev-stat-value"><code style={{fontSize:"inherit"}}>GET /api/v3/players/&#123;playerId&#125;</code></div><div className="dev-stat-detail">Single read-only player lookup</div></article>
        <article className="dev-stat"><div className="dev-stat-label">Per-key quota</div><div className="dev-stat-value">60 / min</div><div className="dev-stat-detail">Up to 1,000 requests per day</div></article>
        <article className="dev-stat"><div className="dev-stat-label">Additional protection</div><div className="dev-stat-value">120 / min / IP</div><div className="dev-stat-detail">Shared IP-level rate limit</div></article>
      </div>
      <div className="dev-section-nav" aria-label="Documentation sections"><a href="#quickstart"><Terminal size={13}/> Quick start</a><a href="#api-reference"><Activity size={13}/> Player lookup</a><a href="#manual-redemption"><Code2 size={13}/> Manual redeem</a><a href="#auto-redemption"><Gauge size={13}/> Auto redeem</a><a href="#limits"><Activity size={13}/> Limits &amp; errors</a><a href="#authentication"><ShieldCheck size={13}/> Security</a><a href="#maintainer-contact"><MessageCircle size={13}/> Contact</a></div><div className="dev-layout">
        <aside className="dev-sidebar" aria-label="Account and API keys"><DeveloperAccountPanel/></aside>
        <div className="dev-content"><div className="dev-doc-grid">
          <section className="dev-card dev-feature-card">
            <div className="dev-section-kicker" style={{display:"flex",alignItems:"center",gap:7}}><ShieldCheck size={14}/> Kingshot REST API</div>
            <h2 style={{fontSize:"clamp(21px,3vw,28px)",letterSpacing:"-.035em",lineHeight:1.25,margin:"10px 0 8px"}}>Look up players. Redeem codes. Enroll for auto-redeem.</h2>
            <p className="dev-muted" style={{maxWidth:620}}>Use a developer key for versioned player lookup and manual redemption. V3 is the supported developer API. V1 routes are deprecated; migrate existing integrations to V3 now. The automatic-redemption registration flow is documented separately. Keep keys and signing secrets out of browser code, source control, and URLs.</p>
            <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:15}}>{["Player lookup","Manual redemption","Auto-redeem enrollment","JSON responses","Bearer authentication"].map(tag=><span key={tag} style={{border:"1px solid #343e4d",borderRadius:7,padding:"5px 8px",fontSize:10,color:"#cbd3e2"}}>{tag}</span>)}</div>
          </section>
          <section className="dev-card" id="quickstart">
            <div className="dev-card-head"><Terminal size={18} color="#b8bdff"/><h2 className="dev-card-title">Quick start</h2></div>
            <p className="dev-muted" style={{marginBottom:15}}>Send your key in the Authorization header over HTTPS.</p>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:10}}>
              <div style={{display:"flex",gap:6}}><button type="button" className="dev-tab" aria-pressed={tab==="curl"} onClick={()=>setTab("curl")}>cURL</button><button type="button" className="dev-tab" aria-pressed={tab==="javascript"} onClick={()=>setTab("javascript")}>JavaScript</button></div><CopyButton value={code} label="Copy example"/>
            </div>
            <pre className="dev-code" tabIndex={0} aria-label="Player lookup code example, horizontally scrollable"><code>{code}</code></pre>
            <p className="dev-muted" style={{fontSize:11,marginTop:10}}>Replace <code>YOUR_API_KEY</code> with your secret and the example Player ID with the one you want to look up.</p>
          </section>
          <section className="dev-card" id="api-reference">
            <div className="dev-card-head"><Activity size={18} color="#b8bdff"/><h2 className="dev-card-title">API reference</h2></div>
            <p className="dev-muted" style={{marginBottom:13}}>Fetch a player profile using a numeric Kingshot Player ID.</p>
            <div className="dev-endpoint"><span style={{background:"#164b39",color:"#9ce9c2",borderRadius:6,padding:"5px 8px",fontSize:10,fontWeight:900}}>GET</span><code style={{fontSize:12,overflowWrap:"anywhere",flex:"1 1 170px"}}>/api/v3/players/&#123;playerId&#125;</code><CopyButton value="/api/v3/players/{playerId}" label="Copy path"/></div>
            <p className="dev-muted" style={{marginTop:11}}>Required path parameter: <code>playerId</code> — 5 to 20 digits. A valid, active API key is required.</p>
            <h3 style={{fontSize:13,margin:"19px 0 9px"}}>Example response</h3>
            <pre className="dev-code" tabIndex={0} aria-label="Example player API JSON response, horizontally scrollable"><code>{JSON.stringify({data:{playerId:"43180889",name:"Example Player",kingdomId:"1125",power:123456789,townCenterLevel:30,avatarUrl:null,allianceName:"Example Alliance",allianceTag:"EXA"},meta:{apiVersion:"3",requestId:"server-generated-id",timestamp:"2026-10-17T12:00:00.000Z",source:"mightpulse",stale:false,providerFresh:true,providerAgeSeconds:2,rateLimit:{perMinuteLimit:60,perMinuteRemaining:59,perDayLimit:1000,perDayRemaining:999,resetAt:"2026-10-17T12:01:00.000Z"}},dev:{name:DEVELOPER_NAME,discord:"@" + DEVELOPER_DISCORD_USERNAME,url:DEVELOPER_DISCORD_URL}},null,2)}</code></pre>
            <p className="dev-muted" style={{fontSize:11,marginTop:9}}>Illustrative values only. Some fields may be null when the upstream provider has no value. Public JSON responses also include a top-level <code>dev</code> object with maintainer contact details.</p>
          </section>
          <section className="dev-card" id="manual-redemption">
            <div className="dev-card-head"><KeyRound size={18} color="#b8bdff"/><h2 className="dev-card-title">Manual redemption</h2></div>
            <div className="dev-endpoint"><span style={{background:"#4a3216",color:"#ffd28a",borderRadius:6,padding:"5px 8px",fontSize:10,fontWeight:900}}>POST</span><code style={{fontSize:12,overflowWrap:"anywhere",flex:"1 1 170px"}}>/api/v3/redemptions</code><CopyButton value="/api/v3/redemptions" label="Copy path"/></div>
            <p className="dev-muted" style={{marginTop:11}}>Requires a developer Bearer key. Submit one Player ID, gift code, and kingdom ID per request.</p>
            <pre className="dev-code" tabIndex={0} aria-label="Manual redemption cURL example, horizontally scrollable"><code>{`curl -X POST "${ORIGIN}/api/v3/redemptions" \\\n  -H "Authorization: Bearer $KINGSHOT_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"playerId":"43180889","code":"EXAMPLECODE","kid":"1125"}'`}</code></pre>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8,marginTop:12}}>{[["playerId","5–20 digits"],["code","1–64 safe characters"],["kid","1–10 digit kingdom ID"]].map(([name,desc])=><div key={name} style={{border:"1px solid #2b3442",background:"#0d1118",borderRadius:9,padding:10}}><code style={{fontSize:12}}>{name}</code><p className="dev-muted" style={{fontSize:11,marginTop:4}}>{desc}</p></div>)}</div>
            <p className="dev-muted" style={{marginTop:12}}>Check <code>data.ok</code>, <code>data.status</code>, <code>data.message</code>, and <code>data.errorCategory</code>. HTTP success alone does not guarantee rewards were granted.</p>
          </section>
          <section className="dev-card" id="auto-redemption">
            <div className="dev-card-head"><Gauge size={18} color="#b8bdff"/><h2 className="dev-card-title">Automatic redemption enrollment</h2></div>
            <div className="dev-endpoint"><span style={{background:"#164b39",color:"#9ce9c2",borderRadius:6,padding:"5px 8px",fontSize:10,fontWeight:900}}>POST</span><code style={{fontSize:12,overflowWrap:"anywhere",flex:"1 1 170px"}}>/api/kingshot-register</code><CopyButton value="/api/kingshot-register" label="Copy path"/></div>
            <p className="dev-muted" style={{marginTop:11}}>Enrolls a player in the existing scheduled auto-redeem workflow. One player per request. This public website route is rate limited and does not use a developer API key; the worker itself remains private.</p>
            <pre className="dev-code" tabIndex={0} aria-label="Automatic redemption registration cURL example, horizontally scrollable"><code>{`curl -X POST "${ORIGIN}/api/kingshot-register" \\\n  -H "Content-Type: application/json" \\\n  -d '{"playerId":"43180889","kingdomId":"1125","playerName":"Example Player"}'`}</code></pre>
            <p className="dev-muted" style={{marginTop:12}}>Required: <code>playerId</code>. Optional: <code>kingdomId</code>, <code>playerName</code>, <code>avatarUrl</code>. The response reports <code>registered</code>, <code>alreadyRegistered</code>, <code>registrationStatus</code>, and kingdom verification state.</p>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:13}}><a href="/auto" style={{display:"inline-flex",alignItems:"center",gap:7,border:"1px solid #343e4d",borderRadius:9,padding:"9px 12px",color:"#d5d8ff",textDecoration:"none",fontSize:12}}>Open Auto Redeem page <ExternalLink size={13}/></a><a href="/manual" style={{display:"inline-flex",alignItems:"center",gap:7,border:"1px solid #343e4d",borderRadius:9,padding:"9px 12px",color:"#d5d8ff",textDecoration:"none",fontSize:12}}>Open Manual Redeem page <ExternalLink size={13}/></a></div>
            <p className="dev-muted" style={{fontSize:11,marginTop:12}}>Enrollment does not start/stop the worker, force an individual redemption, or guarantee a code is valid. Never call the internal <code>/api/kingshot-auto</code> scheduler endpoint from clients.</p>
          </section>
          {accordion("authentication","Authentication and key safety",<><p style={paragraph}>Send the key as <code>Authorization: Bearer YOUR_API_KEY</code> over HTTPS. Keys are secrets: store them in server-side environment variables or a secrets manager, and never commit them to source control.</p><p style={paragraph}>A revoked or invalid key receives <code>401</code>. Do not share keys between unrelated applications. Rotate a key immediately if it may have leaked.</p></>)}
          <div style={{height:0}}/>
          {accordion("limits","Rate limits and response codes",<><p style={paragraph}>Current limits: 60 requests per minute and 1,000 requests per day per key, plus 120 requests per minute per IP. Responses include rate-limit headers when available. On <code>429</code>, honor <code>Retry-After</code> and use bounded backoff. V3 errors use <code>error.code</code> and <code>error.message</code>, with <code>meta.apiVersion</code>, <code>meta.requestId</code>, and <code>meta.timestamp</code>. A redemption can complete with HTTP 200 even if the game rejects the code; inspect the response body and do not blindly retry an ambiguous timeout.</p><div style={{display:"grid",gap:8,marginTop:13}}>{[["200","Lookup succeeded"],["400","Missing or invalid Player ID"],["401","Missing, invalid, or revoked API key"],["404","Player not found"],["429","Rate limit or quota exceeded"],["502","Upstream player provider unavailable"]].map(([status,desc])=><div key={status} style={{display:"flex",gap:12,borderBottom:"1px solid #252c38",padding:"7px 0"}}><code style={{width:38,color:status==="200"?"#9ce9c2":"#b8bdff"}}>{status}</code><span style={{color:"#aeb8ca",fontSize:13}}>{desc}</span></div>)}</div></>)}
          <div style={{height:0}}/>
          {accordion("lifecycle","API key lifecycle and availability",<><p style={paragraph}>Sign in with Discord to create and manage your own API keys. Keys are displayed in full only once; only a hash is stored. You can revoke a key from the account panel, and revoked keys stop authorizing requests.</p><p style={paragraph}>Developer accounts do not grant administrative access. Keep keys private and revoke any secret that may have been exposed.</p></>)}
          <section className="dev-card dev-maintainer-card" id="maintainer-contact" aria-labelledby="maintainer-contact-title">
            <div className="dev-maintainer-heading">
              <div className="dev-card-head"><MessageCircle size={18} color="#d4bd88"/><h2 className="dev-card-title" id="maintainer-contact-title">Built and maintained by {DEVELOPER_NAME}</h2></div>
              <span className="dev-maintainer-badge"><ShieldCheck size={12}/> Project maintainer</span>
            </div>
            <p className="dev-muted dev-maintainer-intro">Independent community project for Kingshot players. For API integrations, tooling questions, or project feedback, contact the maintainer on Discord.</p>
            <div className="dev-maintainer-contact">
              <div className="dev-maintainer-identity">
                <span className="dev-maintainer-avatar site-account-admin" role="img" aria-label={DEVELOPER_NAME + "'s Discord profile with administrator frame"}>
                  <span className="site-account-avatar-frame">
                    {maintainerAvatarSrc && !maintainerAvatarFailed ? <img src={maintainerAvatarSrc} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setMaintainerAvatarFailed(true)}/> : <span className="dev-maintainer-avatar-fallback">J</span>}
                    <span className="site-account-role-mark" aria-hidden="true">★</span>
                  </span>
                </span>
                <span className="dev-maintainer-identity-copy"><b>{DEVELOPER_NAME}</b><span className="dev-maintainer-handle-row"><small>@{maintainerHandle}</small><CopyButton value={"@" + maintainerHandle} label="Copy"/></span></span>
              </div>
              <div className="dev-maintainer-actions">
                <a className="dev-maintainer-discord" href={DEVELOPER_DISCORD_URL} target="_blank" rel="noopener noreferrer" aria-describedby="maintainer-contact-note" aria-label={"Open Discord profile for " + DEVELOPER_NAME + " in a new tab"}><MessageCircle size={15}/> Open Discord profile <ExternalLink size={13}/></a>
              </div>
            </div>
            <p className="dev-maintainer-note" id="maintainer-contact-note"><ShieldCheck size={15}/><span><b>Developer contact only.</b> This opens Judson’s Discord profile; it does not sign you in or create an account. Direct messages depend on Discord privacy settings. For account or redemption issues, use the in-app Support Centre. Never share passwords, API keys, or sign-in codes.</span></p>
          </section>
          </div>
        </div>
      </div>
      <footer className="dev-footer"><span>API v3 · Supported developer API · V1 routes deprecated · Maintained by {DEVELOPER_NAME}</span><a href="#maintainer-contact">Maintainer & contact</a><a href={DEVELOPER_DISCORD_URL} target="_blank" rel="noopener noreferrer">Developer contact (Discord)</a><a href="/developer.md">Plain-text docs for crawlers and integrations</a><a href="/openapi.json">OpenAPI specification</a><a href="/info" style={{display:"inline-flex",alignItems:"center",gap:5}}>Service overview <ExternalLink size={12}/></a><a href="/privacy?service=kingshot-auto" style={{color:"inherit"}}>Privacy</a></footer>
    </main>
  </div>;
}
