import React, { useState } from "react";
import DeveloperAccountPanel from "./DeveloperAccountPanel";
import { Activity, BookOpen, Check, ChevronRight, Code2, Copy, ExternalLink, Gauge, KeyRound, ShieldCheck, Terminal } from "lucide-react";

const ORIGIN = "https://kingshot-autoredeemer.vercel.app";
const endpoint = ORIGIN + "/api/v1/player?id=43180889";
const curlExample = 'curl "' + endpoint + '" \\\n  -H "Authorization: Bearer YOUR_API_KEY"';

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" onClick={() => navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }).catch(() => setCopied(false))} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, border: "1px solid #343e4d", borderRadius: 9, padding: "8px 11px", background: "#202633", color: "#e8ebf5", font: "inherit", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}><Copy size={14}/>{copied ? "Copied" : label}</button>;
}

export default function DeveloperApp() {
  const [tab, setTab] = useState<"curl" | "javascript">("curl");
  const [expanded, setExpanded] = useState("authentication");
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
  const accordion = (id: string, title: string, body: React.ReactNode) => <section style={{ ...card, padding: 0, overflow: "hidden" }}><button type="button" onClick={() => setExpanded(expanded === id ? "" : id)} aria-expanded={expanded === id} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: 17, textAlign: "left", background: "transparent", color: "#f2f5fb", border: 0, font: "inherit", cursor: "pointer" }}><ChevronRight size={16} style={{ transform: expanded === id ? "rotate(90deg)" : "none", transition: "transform .15s" }}/><b style={{ flex: 1 }}>{title}</b></button>{expanded === id && <div style={{ padding: "0 18px 18px" }}>{body}</div>}</section>;
  return <main className="dev-dashboard" style={{ minHeight: "100vh", background: "#0b0e14", color: "#f2f5fb", fontFamily: "inherit" }}>
    <style>{`
      .dev-dashboard *{box-sizing:border-box}
      .dev-topbar{position:sticky;top:0;z-index:20;background:rgba(11,14,20,.88);backdrop-filter:blur(16px);border-bottom:1px solid #252c38}
      .dev-shell{max-width:1180px;margin:0 auto;padding:0 20px}
      .dev-topbar-inner{min-height:66px;display:flex;align-items:center;gap:13px}
      .dev-brand-mark{width:36px;height:36px;display:grid;place-items:center;border-radius:11px;background:#7b82ff22;color:#b8bdff;flex:none}
      .dev-nav-link{color:#aeb8ca;text-decoration:none;font-size:12px;padding:8px 10px;border-radius:8px}
      .dev-nav-link:hover{background:#171d28;color:#f2f5fb}
      .dev-page{padding:30px 0 54px}
      .dev-overview{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px}
      .dev-eyebrow{color:#aeb4ff;font-size:10px;font-weight:850;letter-spacing:.14em;text-transform:uppercase}
      .dev-page-title{font-size:clamp(27px,4vw,36px);letter-spacing:-.045em;line-height:1.12;margin:7px 0 8px}
      .dev-muted{color:#aeb8ca;font-size:13px;line-height:1.65;margin:0}
      .dev-version-pill{display:inline-flex;align-items:center;gap:7px;border:1px solid #343e4d;background:#131821;border-radius:999px;padding:8px 11px;color:#d5dbea;font-size:11px;white-space:nowrap}
      .dev-stat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:20px}
      .dev-stat{background:#11161f;border:1px solid #252e3b;border-radius:13px;padding:15px;min-width:0}
      .dev-stat-label{font-size:11px;color:#9da8ba}
      .dev-stat-value{font-size:clamp(14px,2vw,18px);font-weight:750;letter-spacing:-.02em;margin-top:7px;overflow-wrap:anywhere}
      .dev-stat-detail{font-size:11px;color:#8390a4;margin-top:4px;line-height:1.5}
      .dev-layout{display:grid;grid-template-columns:minmax(270px, .78fr) minmax(0,1.65fr);align-items:start;gap:18px}
      .dev-sidebar{min-width:0}
      .dev-content{min-width:0;display:grid;gap:16px}
      .dev-card{background:#131821;border:1px solid #2b3442;border-radius:15px;padding:clamp(16px,2.5vw,23px);min-width:0}
      .dev-card-title{font-size:17px;letter-spacing:-.025em;margin:0}
      .dev-card-head{display:flex;align-items:center;gap:9px;margin-bottom:8px}
      .dev-section-kicker{font-size:10px;font-weight:800;letter-spacing:.12em;color:#b8bdff;text-transform:uppercase}
      .dev-feature-card{background:linear-gradient(135deg,#171b2a,#131821 68%);border-color:#353a5b}
      .dev-code{margin:0;max-width:100%;overflow:auto;padding:15px;border-radius:10px;background:#080a0f;color:#d5d8ff;font-size:12px;line-height:1.75;white-space:pre}
      .dev-tab{border:1px solid #343e4d;border-radius:8px;padding:7px 10px;background:transparent;color:#c9d0df;font:inherit;font-size:12px;cursor:pointer}
      .dev-tab[aria-pressed="true"]{background:#30365b;border-color:#4b5289;color:#fff}
      .dev-endpoint{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px;background:#0d1118;border:1px solid #2b3442;border-radius:10px}
      .dev-footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:26px;padding-top:17px;border-top:1px solid #252c38;color:#8f9aab;font-size:11px}
      .dev-footer a{color:#b8bdff;text-decoration:none}
      @media(max-width:760px){.dev-shell{padding:0 14px}.dev-page{padding-top:23px}.dev-layout{grid-template-columns:minmax(0,1fr)}.dev-sidebar{order:0}.dev-content{order:1}.dev-stat-grid{gap:8px}.dev-stat{padding:12px}.dev-stat-detail{font-size:10px}.dev-topbar-inner{min-height:59px}.dev-nav-link{padding:7px 6px}.dev-overview{gap:10px}.dev-version-pill{font-size:10px;padding:7px 8px}}
      @media(max-width:430px){.dev-stat-grid{grid-template-columns:1fr 1fr}.dev-stat:last-child{grid-column:1/-1}.dev-overview{display:block}.dev-version-pill{margin-top:13px}.dev-brand-copy{display:none}.dev-top-nav{gap:2px!important}.dev-nav-link{font-size:11px}}
      @media(prefers-reduced-motion:reduce){.dev-dashboard *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
    `}</style>
    <div className="dev-topbar"><div className="dev-shell dev-topbar-inner">
      <div className="dev-brand-mark"><Code2 size={20}/></div>
      <div className="dev-brand-copy" style={{minWidth:0,flex:1}}><div style={{fontSize:13,fontWeight:800,letterSpacing:"-.02em"}}>Kingshot <span style={{color:"#aeb4ff"}}>Developers</span></div><div style={{fontSize:10,color:"#8f9aab",marginTop:2}}>Read-only Player API</div></div>
      <nav className="dev-top-nav" aria-label="Developer navigation" style={{display:"flex",alignItems:"center",gap:5}}>
        <a className="dev-nav-link" href="#quickstart">Quick start</a><a className="dev-nav-link" href="#api-reference">API reference</a><a className="dev-nav-link" href="/" style={{display:"inline-flex",alignItems:"center",gap:5}}><ExternalLink size={12}/> Home</a>
      </nav>
    </div></div>
    <div className="dev-shell dev-page">
      <header className="dev-overview">
        <div><div className="dev-eyebrow">Developer workspace / Overview</div><h1 className="dev-page-title">Developer dashboard</h1><p className="dev-muted">Manage your API credentials and integrate Kingshot player data into your tools.</p></div>
        <span className="dev-version-pill"><span style={{width:7,height:7,borderRadius:9,background:"#9ce9c2",boxShadow:"0 0 0 3px #9ce9c21c"}}/> API v1 <span style={{color:"#687487"}}>·</span> HTTPS</span>
      </header>
      <div className="dev-stat-grid" aria-label="API overview">
        <article className="dev-stat"><div className="dev-stat-label">Endpoint</div><div className="dev-stat-value"><code style={{fontSize:"inherit"}}>GET /api/v1/player</code></div><div className="dev-stat-detail">Single read-only player lookup</div></article>
        <article className="dev-stat"><div className="dev-stat-label">Per-key quota</div><div className="dev-stat-value">60 / min</div><div className="dev-stat-detail">Up to 1,000 requests per day</div></article>
        <article className="dev-stat"><div className="dev-stat-label">Additional protection</div><div className="dev-stat-value">120 / min / IP</div><div className="dev-stat-detail">Shared IP-level rate limit</div></article>
      </div>
      <div className="dev-layout">
        <aside className="dev-sidebar" aria-label="Account and API keys"><DeveloperAccountPanel/></aside>
        <div className="dev-content">
          <section className="dev-card dev-feature-card">
            <div className="dev-section-kicker" style={{display:"flex",alignItems:"center",gap:7}}><ShieldCheck size={14}/> Read-only REST API</div>
            <h2 style={{fontSize:"clamp(21px,3vw,28px)",letterSpacing:"-.035em",lineHeight:1.25,margin:"10px 0 8px"}}>Your player data. Ready to integrate.</h2>
            <p className="dev-muted" style={{maxWidth:620}}>Use a personal API key to query player profiles from your backend. Existing valid API keys continue to work. Keep secrets out of browser code, public repositories, and URLs.</p>
            <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:15}}>{["Versioned endpoint","JSON responses","Bearer authentication"].map(tag=><span key={tag} style={{border:"1px solid #343e4d",borderRadius:7,padding:"5px 8px",fontSize:10,color:"#cbd3e2"}}>{tag}</span>)}</div>
          </section>
          <section className="dev-card" id="quickstart">
            <div className="dev-card-head"><Terminal size={18} color="#b8bdff"/><h2 className="dev-card-title">Quick start</h2></div>
            <p className="dev-muted" style={{marginBottom:15}}>Send your key in the Authorization header over HTTPS.</p>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:10}}>
              <div style={{display:"flex",gap:6}}><button type="button" className="dev-tab" aria-pressed={tab==="curl"} onClick={()=>setTab("curl")}>cURL</button><button type="button" className="dev-tab" aria-pressed={tab==="javascript"} onClick={()=>setTab("javascript")}>JavaScript</button></div><CopyButton value={code} label="Copy example"/>
            </div>
            <pre className="dev-code"><code>{code}</code></pre>
            <p className="dev-muted" style={{fontSize:11,marginTop:10}}>Replace <code>YOUR_API_KEY</code> with your secret and the example Player ID with the one you want to look up.</p>
          </section>
          <section className="dev-card" id="api-reference">
            <div className="dev-card-head"><Activity size={18} color="#b8bdff"/><h2 className="dev-card-title">API reference</h2></div>
            <p className="dev-muted" style={{marginBottom:13}}>Fetch a player profile using a numeric Kingshot Player ID.</p>
            <div className="dev-endpoint"><span style={{background:"#164b39",color:"#9ce9c2",borderRadius:6,padding:"5px 8px",fontSize:10,fontWeight:900}}>GET</span><code style={{fontSize:12,overflowWrap:"anywhere",flex:"1 1 170px"}}>/api/v1/player?id=PLAYER_ID</code><CopyButton value="/api/v1/player?id=PLAYER_ID" label="Copy path"/></div>
            <p className="dev-muted" style={{marginTop:11}}>Required query parameter: <code>id</code> — 5 to 20 digits. A valid, active API key is required.</p>
            <h3 style={{fontSize:13,margin:"19px 0 9px"}}>Example response</h3>
            <pre className="dev-code"><code>{JSON.stringify({data:{playerId:"43180889",name:"Example Player",kingdomId:"1125",power:123456789,townCenterLevel:30,avatarUrl:null},meta:{requestId:"server-generated-id",remaining:59,dailyRemaining:999}},null,2)}</code></pre>
            <p className="dev-muted" style={{fontSize:11,marginTop:9}}>Illustrative values only. Some fields may be null when the upstream provider has no value.</p>
          </section>
          {accordion("authentication","Authentication and key safety",<><p style={paragraph}>Send the key as <code>Authorization: Bearer YOUR_API_KEY</code> over HTTPS. Keys are secrets: store them in server-side environment variables or a secrets manager, and never commit them to source control.</p><p style={paragraph}>A revoked or invalid key receives <code>401</code>. Do not share keys between unrelated applications. Rotate a key immediately if it may have leaked.</p></>)}
          <div style={{height:0}}/>
          {accordion("limits","Rate limits and response codes",<><p style={paragraph}>Current limits: 60 requests per minute and 1,000 requests per day per key, plus 120 requests per minute per IP. Responses include rate-limit headers when available. On <code>429</code>, honor <code>Retry-After</code> and use exponential backoff.</p><div style={{display:"grid",gap:8,marginTop:13}}>{[["200","Lookup succeeded"],["400","Missing or invalid Player ID"],["401","Missing, invalid, or revoked API key"],["404","Player not found"],["429","Rate limit or quota exceeded"],["502","Upstream player provider unavailable"]].map(([status,desc])=><div key={status} style={{display:"flex",gap:12,borderBottom:"1px solid #252c38",padding:"7px 0"}}><code style={{width:38,color:status==="200"?"#9ce9c2":"#b8bdff"}}>{status}</code><span style={{color:"#aeb8ca",fontSize:13}}>{desc}</span></div>)}</div></>)}
          <div style={{height:0}}/>
          {accordion("lifecycle","API key lifecycle and availability",<><p style={paragraph}>Sign in with GitHub to create and manage your own API keys. Keys are displayed in full only once; only a hash is stored. You can revoke a key from the account panel, and revoked keys stop authorizing requests.</p><p style={paragraph}>Developer accounts do not grant administrative access. Keep keys private and revoke any secret that may have been exposed.</p></>)}
        </div>
      </div>
      <footer className="dev-footer"><span>API v1 · Read-only player data</span><a href="https://github.com/Judson-web/kingshot-auto-redeemer" target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:5}}>Source and changelog <ExternalLink size={12}/></a><a href="/privacy?service=kingshot-auto" style={{color:"inherit"}}>Privacy</a></footer>
    </div>
  </main>;