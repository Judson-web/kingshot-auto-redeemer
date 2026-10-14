import React, { useState } from "react";
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
  throw new Error(`API request failed: ${response.status}`);
}

const result = await response.json();
console.log(result.data.playerId, result.data.name);`;
  const card: React.CSSProperties = { background: "#131821", border: "1px solid #2b3442", borderRadius: 16, padding: "clamp(17px, 4vw, 24px)", boxSizing: "border-box" };
  const heading: React.CSSProperties = { margin: "0 0 10px", fontSize: 19, letterSpacing: "-.02em" };
  const paragraph: React.CSSProperties = { color: "#aeb8ca", lineHeight: 1.7, margin: "8px 0 0", fontSize: 14 };
  const codeStyle: React.CSSProperties = { margin: 0, overflowX: "auto", padding: 15, borderRadius: 11, background: "#080a0f", color: "#d5d8ff", fontSize: 12, lineHeight: 1.75, whiteSpace: "pre" };
  const accordion = (id: string, title: string, body: React.ReactNode) => <section style={{ ...card, padding: 0, overflow: "hidden" }}><button type="button" onClick={() => setExpanded(expanded === id ? "" : id)} aria-expanded={expanded === id} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: 17, textAlign: "left", background: "transparent", color: "#f2f5fb", border: 0, font: "inherit", cursor: "pointer" }}><ChevronRight size={16} style={{ transform: expanded === id ? "rotate(90deg)" : "none", transition: "transform .15s" }}/><b style={{ flex: 1 }}>{title}</b></button>{expanded === id && <div style={{ padding: "0 18px 18px" }}>{body}</div>}</section>;
  return <main style={{ minHeight: "100vh", background: "#0b0e14", color: "#f2f5fb", padding: "26px 16px 48px", fontFamily: "inherit" }}>
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 26 }}>
        <div style={{ width: 46, height: 46, display: "grid", placeItems: "center", borderRadius: 14, background: "#7b82ff22", color: "#b8bdff" }}><Code2 size={24}/></div>
        <div style={{ flex: 1 }}><div style={{ color: "#b8bdff", fontSize: 10, fontWeight: 850, letterSpacing: ".13em" }}>KINGSHOT REDEEMER · API V1</div><h1 style={{ fontSize: "clamp(27px, 5vw, 38px)", letterSpacing: "-.045em", margin: "4px 0 0" }}>Developer documentation</h1></div>
        <a href="/" style={{ color: "#c1c9d8", textDecoration: "none", fontSize: 12 }}>← Home</a>
      </header>
      <section style={{ ...card, background: "linear-gradient(135deg, #171b2a, #131821 65%)", marginBottom: 17 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "#9ce9c2", fontSize: 11, fontWeight: 800, letterSpacing: ".08em" }}><span style={{ width: 7, height: 7, borderRadius: 10, background: "#6ee7a8" }}/> READ-ONLY REST API</span>
        <h2 style={{ fontSize: "clamp(22px, 4vw, 31px)", letterSpacing: "-.035em", lineHeight: 1.2, margin: "13px 0 0" }}>Integrate Kingshot player data into your tools.</h2>
        <p style={{ ...paragraph, maxWidth: 720 }}>A small, versioned API for read-only player lookups. This documentation is public; account login and self-service API key issuance are not enabled yet. Existing valid API keys continue to use the endpoint.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 17 }}><span style={{ border: "1px solid #343e4d", borderRadius: 999, padding: "6px 10px", fontSize: 11, color: "#cbd3e2" }}>Version 1</span><span style={{ border: "1px solid #343e4d", borderRadius: 999, padding: "6px 10px", fontSize: 11, color: "#cbd3e2" }}>HTTPS</span><span style={{ border: "1px solid #343e4d", borderRadius: 999, padding: "6px 10px", fontSize: 11, color: "#cbd3e2" }}>Bearer authentication</span></div>
      </section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 205px), 1fr))", gap: 12, marginBottom: 17 }}>
        {[{icon:BookOpen,title:"One endpoint",value:"GET /api/v1/player",detail:"Read-only player profile"},{icon:Gauge,title:"Per-key limits",value:"60/min · 1,000/day",detail:"Requests per API key"},{icon:ShieldCheck,title:"IP protection",value:"120 requests/min",detail:"Additional IP-level limit"}].map(item => <article key={item.title} style={card}><item.icon size={19} color="#b8bdff"/><div style={{ color: "#aeb8ca", fontSize: 11, marginTop: 13 }}>{item.title}</div><b style={{ display: "block", marginTop: 5, fontSize: 16 }}>{item.value}</b><div style={{ color: "#8f9aab", fontSize: 11, marginTop: 5 }}>{item.detail}</div></article>)}
      </div>
      <section style={{ ...card, marginBottom: 17 }}>
        <div style={{ display: "flex", gap: 9, alignItems: "center" }}><Terminal size={19} color="#b8bdff"/><h2 style={heading}>Quick start</h2></div>
        <p style={paragraph}>Use your API key in the Authorization header. Never put API secrets in frontend code, public repositories, URLs, or client-side apps shipped to users.</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 17, marginBottom: 10 }}><div style={{ display: "flex", gap: 6 }}><button onClick={() => setTab("curl")} style={{ border: "1px solid #343e4d", borderRadius: 8, padding: "7px 10px", background: tab === "curl" ? "#30365b" : "transparent", color: "#f2f5fb", cursor: "pointer" }}>cURL</button><button onClick={() => setTab("javascript")} style={{ border: "1px solid #343e4d", borderRadius: 8, padding: "7px 10px", background: tab === "javascript" ? "#30365b" : "transparent", color: "#f2f5fb", cursor: "pointer" }}>JavaScript</button></div><CopyButton value={code} label="Copy example"/></div>
        <pre style={codeStyle}><code>{code}</code></pre>
      </section>
      <section style={{ ...card, marginBottom: 17 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}><Activity size={19} color="#b8bdff"/><h2 style={heading}>Endpoint reference</h2></div>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 9, marginTop: 15 }}><span style={{ background: "#164b39", color: "#9ce9c2", borderRadius: 6, padding: "5px 8px", fontSize: 11, fontWeight: 900 }}>GET</span><code style={{ overflowWrap: "anywhere", fontSize: 13 }}>/api/v1/player?id=PLAYER_ID</code><CopyButton value="/api/v1/player?id=PLAYER_ID" label="Copy path"/></div>
        <p style={paragraph}>Required query parameter: <code>id</code>, a Kingshot Player ID containing 5–20 digits. Requires a valid, active API key.</p>
        <h3 style={{ fontSize: 13, margin: "19px 0 8px" }}>Successful response</h3>
        <pre style={codeStyle}><code>{JSON.stringify({data:{playerId:"43180889",name:"Example Player",kingdomId:"1125",power:123456789,townCenterLevel:30,avatarUrl:null},meta:{requestId:"server-generated-id",remaining:59,dailyRemaining:999}},null,2)}</code></pre>
        <p style={paragraph}>Example values are illustrative, not live player data. Fields can be null when the upstream source does not provide them.</p>
      </section>
      {accordion("authentication","Authentication and key safety",<><p style={paragraph}>Send the key as <code>Authorization: Bearer YOUR_API_KEY</code> over HTTPS. Keys are secrets: store them in server-side environment variables or a secrets manager, and never commit them to source control.</p><p style={paragraph}>A revoked or invalid key receives <code>401</code>. Do not share keys between unrelated applications. Rotate a key immediately if it may have leaked.</p></>)}
      <div style={{ height: 10 }}/>
      {accordion("limits","Rate limits and response codes",<><p style={paragraph}>Current limits: 60 requests per minute and 1,000 requests per day per key, plus 120 requests per minute per IP. Responses include rate-limit headers when available. On <code>429</code>, honor <code>Retry-After</code> and use exponential backoff.</p><div style={{ display: "grid", gap: 8, marginTop: 13 }}>{[["200","Lookup succeeded"],["400","Missing or invalid Player ID"],["401","Missing, invalid, or revoked API key"],["404","Player not found"],["429","Rate limit or quota exceeded"],["502","Upstream player provider unavailable"]].map(([status,desc])=><div key={status} style={{ display: "flex", gap: 12, borderBottom: "1px solid #252c38", padding: "7px 0" }}><code style={{ width: 38, color: status === "200" ? "#9ce9c2" : "#b8bdff" }}>{status}</code><span style={{ color: "#aeb8ca", fontSize: 13 }}>{desc}</span></div>)}</div></>)}
      <div style={{ height: 10 }}/>
      {accordion("lifecycle","API key lifecycle and availability",<><p style={paragraph}>The endpoint supports immediate server-side revocation; revoked keys stop authorizing requests. Public self-service key creation and a customer key-management dashboard are intentionally not available until proper account authentication is implemented.</p><p style={paragraph}>For key issuance, revocation requests, or access questions, contact the project maintainer through the repository. Do not send existing secrets in support messages.</p></>)}
      <footer style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 24, paddingTop: 16, borderTop: "1px solid #252c38", color: "#8f9aab", fontSize: 11 }}><span>API v1 · Read-only player data</span><a href="https://github.com/Judson-web/kingshot-auto-redeemer" target="_blank" rel="noreferrer" style={{ color: "#b8bdff", display: "inline-flex", alignItems: "center", gap: 5 }}>Source and changelog <ExternalLink size={12}/></a><a href="/privacy?service=kingshot-auto" style={{ color: "inherit" }}>Privacy</a></footer>
    </div>
  </main>;
}
