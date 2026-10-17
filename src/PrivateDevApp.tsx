import React,{useEffect,useMemo,useState} from "react";
import {LockKeyhole,LogOut,Search,ExternalLink,ChevronRight,ShieldCheck,Code2,BookOpen,KeyRound,Activity,Copy,MessageCircle} from "lucide-react";
const ORIGIN="https://kingshot-autoredeemer.vercel.app";
const OWNER="Judson-web";
const pages=[
{path:"/",group:"Public pages",desc:"Automatic redemption landing page"},
{path:"/auto",group:"Public pages",desc:"Automatic redemption experience"},
{path:"/manual",group:"Public pages",desc:"Manual gift-code redemption"},
{path:"/info",group:"Public pages",desc:"How the service works"},
{path:"/gift-codes",group:"Public pages",desc:"Gift-code listing"},
{path:"/message",group:"Public pages",desc:"Custom message tools"},
{path:"/push",group:"Tools",desc:"Push notification console"},
{path:"/developer",group:"Developer",desc:"Public API documentation and API key management"},
{path:"/dev",group:"Private",desc:"This owner-only navigation and development hub"},
{path:"/devsupport",group:"Private",desc:"Admin-only two-way support inbox, separate from removal tickets"},
{path:"/terms",group:"Legal",desc:"Terms of service"},
{path:"/privacy",group:"Legal",desc:"Privacy policy"}
];
const apis=[
{method:"GET",path:"/api/v3/players/{playerId}",auth:"Bearer API key",desc:"V3 player profile with explicit provider freshness and quota metadata."},
{method:"POST",path:"/api/v3/redemptions",auth:"Bearer API key",desc:"V3 manual redemption with standardized errors; inspect the operation outcome."},
{method:"GET",path:"/api/v1/player?id=PLAYER_ID",auth:"Bearer API key · legacy",desc:"V1-compatible player lookup route."},
{method:"POST",path:"/api/v3/redemptions",auth:"Bearer API key · legacy",desc:"V1-compatible manual redemption route."},
{method:"GET",path:"/api/kingshot-player?id=PLAYER_ID",auth:"Public, rate limited",desc:"Legacy website player lookup endpoint."},
{method:"POST",path:"/api/kingshot-redeem",auth:"Public, rate limited",desc:"Website manual-redemption endpoint."},
{method:"POST",path:"/api/kingshot-register",auth:"Public, rate limited",desc:"Register a player for the existing auto-redemption workflow."},
{method:"GET/POST",path:"/api/kingshot-auto",auth:"Internal scheduler token",desc:"Internal worker only. Never expose scheduler credentials or call worker mode from a client."},
{method:"GET",path:"/api/kingshot-health",auth:"Public status",desc:"Service health summary."},
{method:"GET",path:"/api/kingshot-admin-data",auth:"Admin session (except public status)",desc:"Administration data API."}
];
export default function PrivateDevApp(){
 const [user,setUser]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[query,setQuery]=useState(""),[group,setGroup]=useState("All"),[tab,setTab]=useState("routes"),[expanded,setExpanded]=useState("/api/v3/redemptions"),[copied,setCopied]=useState("");
 const allowed=useMemo(()=>Boolean(user),[user]);
 async function request(url:string,init:RequestInit={}){const r=await fetch(url,{...init,credentials:"same-origin",headers:{"content-type":"application/json",...(init.headers as Record<string,string>|undefined||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Request failed");return d}
 useEffect(()=>{let live=true;async function init(){try{const params=new URLSearchParams(location.hash.slice(1));const token=params.get("access_token");if(token){history.replaceState(null,"",location.pathname+location.search);const d=await request("/api/kingshot-player?developer=account-auth",{method:"POST",body:JSON.stringify({action:"dev-verify",access_token:token})});if(live)setUser(d.user);return}const d=await request("/api/kingshot-player?developer=account-auth",{method:"POST",body:JSON.stringify({action:"dev-check"})});if(live&&d.authenticated)setUser(d.user||{user_name:OWNER})}catch(e){if(live)setError(e.message||"Sign-in failed")}finally{if(live)setLoading(false)}}init();return()=>{live=false}},[]);
 async function signIn(){setLoading(true);setError("");try{const d=await request("/api/kingshot-player?developer=account-auth",{method:"POST",body:JSON.stringify({action:"dev-discord-oauth-url"})});if(!d.url||!d.url.startsWith("https://wocxvtptqapietlteshr.supabase.co/auth/v1/authorize?provider=discord"))throw Error("Discord sign-in is not configured. Check the Supabase Discord provider.");location.assign(d.url)}catch(e){setError(e.message||"Could not start Discord sign-in");setLoading(false)}}
 const filtered=pages.filter(p=>(group==="All"||p.group===group)&&(p.path+" "+p.desc+" "+p.group).toLowerCase().includes(query.toLowerCase()));
 async function copy(text,label){try{await navigator.clipboard.writeText(text);setCopied(label);setTimeout(()=>setCopied(""),1400)}catch{setError("Clipboard unavailable; select and copy the text manually.")}}
 if(loading)return <main style={shell}><p>Verifying Discord identity…</p></main>;
 if(!allowed)return <main style={shell}><section style={panel}><div style={mark}><LockKeyhole/></div><p style={eyebrow}>PRIVATE WORKSPACE · OWNER ACCESS</p><h1 style={h1}>Developer control room</h1><p style={muted}>This page is reserved for the site owner. Sign in with the authorized Discord account to view the route tree and API map.</p>{error&&<p role="alert" style={{color:"#ff9b9b"}}>{error}</p>}<div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr)",gap:9}}><button style={{...button,background:"#5865f2"}} onClick={()=>signIn()}><MessageCircle size={17}/> Continue with Discord</button></div><p style={{...muted,fontSize:12,marginTop:18}}>Owner access is verified against your Discord ID on the server. Developer API access does not grant admin privileges.</p><a href="/" style={link}>← Back to website</a></section></main>;
 const groups=["All",...new Set(pages.map(p=>p.group))];
 return <main style={{...shell,maxWidth:1180}}><header style={header}><a href="/" style={link}>← Kingshot Redeemer</a><span style={pill}><ShieldCheck size={14}/> OWNER VERIFIED</span><button style={{...button,background:"#202633"}} onClick={async()=>{await request("/api/kingshot-player?developer=account-auth",{method:"POST",body:JSON.stringify({action:"dev-logout"})}).catch(()=>{});setUser(null);history.replaceState(null,"",location.pathname);}}><LogOut size={14}/> Sign out</button></header><section style={{padding:"35px 0 26px"}}><p style={eyebrow}>PRIVATE DEVELOPER HUB</p><h1 style={h1}>Your website, mapped.</h1><p style={muted}>A searchable route tree, API inventory, and direct links to the places you work most.</p><div style={stats}><div style={panel}><b style={big}>{pages.length}</b><span style={muted}>Website routes</span></div><div style={panel}><b style={big}>{apis.length}</b><span style={muted}>API surfaces</span></div><div style={panel}><b style={big}>Owner</b><span style={muted}>{user.user_name?"@"+user.user_name:user.email}</span></div></div></section><nav style={tabs}><button style={tabStyle(tab==="routes")} onClick={()=>setTab("routes")}><Activity size={15}/> Site tree</button><button style={tabStyle(tab==="api")} onClick={()=>setTab("api")}><Code2 size={15}/> API map</button><a style={tabLink} href="/developer"><BookOpen size={15}/> Public API docs <ExternalLink size={12}/></a><a style={tabLink} href="/api/kingshot-health"><Activity size={15}/> Health <ExternalLink size={12}/></a></nav>
 {tab==="routes"?<section style={panel}><div style={row}><div><h2 style={h2}>Route tree</h2><p style={muted}>Filter by page, function, or route group.</p></div><div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search routes…" style={input}/></div></div><div style={chips}>{groups.map(g=><button key={g} style={chip(g===group)} onClick={()=>setGroup(g)}>{g}</button>)}</div>{filtered.map(p=><div key={p.path} style={routeRow}><div style={{minWidth:0}}><code style={code}>{p.path}</code><p style={{...muted,margin:"5px 0 0"}}>{p.desc}</p></div><div style={{display:"flex",gap:7}}><button style={smallButton} onClick={()=>copy(ORIGIN+p.path,p.path)}><Copy size={13}/>{copied===p.path?"Copied":"URL"}</button><a style={smallButton} href={p.path}><ExternalLink size={13}/>Open</a></div></div>)}</section>:<section style={panel}><h2 style={h2}>API endpoint inventory</h2><p style={muted}>Public, key-protected, and internal endpoints are labelled separately.</p>{apis.map(a=><div key={a.path} style={routeRow}><div style={{minWidth:0,flex:1}}><div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><span style={method}>{a.method}</span><code style={code}>{a.path}</code></div><p style={{...muted,margin:"8px 0 3px"}}>{a.desc}</p><small style={muted}>Authentication: {a.auth}</small></div><button style={smallButton} onClick={()=>setExpanded(expanded===a.path?"":a.path)}><ChevronRight size={14} style={{transform:expanded===a.path?"rotate(90deg)":"none"}}/>Details</button>{expanded===a.path&&<div style={{flexBasis:"100%",padding:"10px 0 0"}}><p style={muted}>Base URL: <code>{ORIGIN}</code></p>{a.path==="/api/v3/redemptions"&&<><pre style={pre}>{"curl -X POST '"+ORIGIN+"/api/v3/redemptions' \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"playerId\":\"43180889\",\"code\":\"EXAMPLECODE\",\"kid\":\"1125\"}'"}</pre><button style={smallButton} onClick={()=>copy("curl -X POST '"+ORIGIN+"/api/v3/redemptions' -H 'Authorization: Bearer YOUR_API_KEY' -H 'Content-Type: application/json' -d '{\"playerId\":\"43180889\",\"code\":\"EXAMPLECODE\",\"kid\":\"1125\"}'","curl")}>{copied==="curl"?"Copied":"Copy cURL"}</button></>}</div>}</div>)}</section>}
 <footer style={{...muted,padding:"26px 0 50px"}}>Private owner workspace · No secrets or scheduler tokens are displayed here.</footer></main>
}
const shell:React.CSSProperties={minHeight:"100vh",background:"radial-gradient(900px 520px at 50% -18%,#302451 0%,transparent 65%),#080a0f",color:"#f2f5fb",padding:"24px clamp(16px,4vw,40px)",fontFamily:"Inter,system-ui,sans-serif",boxSizing:"border-box"};
const panel:React.CSSProperties={background:"#121721",border:"1px solid #293343",borderRadius:16,padding:"clamp(16px,3vw,25px)",marginBottom:14};
const header:React.CSSProperties={display:"flex",gap:14,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",borderBottom:"1px solid #252b36",paddingBottom:16};
const h1:React.CSSProperties={fontSize:"clamp(34px,6vw,56px)",letterSpacing:"-.055em",margin:"10px 0",lineHeight:1.05};
const h2:React.CSSProperties={fontSize:20,margin:"0 0 6px"};
const muted:React.CSSProperties={color:"#aab5c7",lineHeight:1.6,fontSize:14};
const eyebrow:React.CSSProperties={fontSize:10,letterSpacing:".15em",fontWeight:800,color:"#b8bdff"};
const mark:React.CSSProperties={width:46,height:46,borderRadius:14,display:"grid",placeItems:"center",background:"#777fff22",color:"#c3c7ff"};
const button:React.CSSProperties={display:"inline-flex",alignItems:"center",gap:8,justifyContent:"center",border:0,borderRadius:10,padding:"12px 15px",background:"#737af0",color:"white",fontWeight:750,cursor:"pointer"};
const link:React.CSSProperties={color:"#d0d4ff",textDecoration:"none",display:"inline-flex",alignItems:"center",gap:6,fontSize:13};
const pill:React.CSSProperties={display:"inline-flex",alignItems:"center",gap:6,color:"#a9f0ca",fontSize:11};
const stats:React.CSSProperties={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10,marginTop:24};
const big:React.CSSProperties={fontSize:25,display:"block",marginBottom:5};
const tabs:React.CSSProperties={display:"flex",gap:8,flexWrap:"wrap",margin:"12px 0 18px"};
const tabStyle=(active:boolean):React.CSSProperties=>({display:"inline-flex",alignItems:"center",gap:7,padding:"10px 13px",border:"1px solid "+(active?"#777fff":"#303847"),borderRadius:9,background:active?"#262b4b":"#141922",color:"#f2f5fb",cursor:"pointer"});
const tabLink:React.CSSProperties={...link,padding:"10px 13px",border:"1px solid #303847",borderRadius:9,background:"#141922"};
const input:React.CSSProperties={background:"#080a0f",color:"#fff",border:"1px solid #343e4d",borderRadius:9,padding:"10px 12px",minWidth:150};
const chips:React.CSSProperties={display:"flex",gap:7,flexWrap:"wrap",margin:"18px 0"};
const chip=(active:boolean):React.CSSProperties=>({border:"1px solid "+(active?"#777fff":"#343e4d"),borderRadius:999,padding:"7px 11px",background:active?"#282d50":"#0c1017",color:"#e9ecf7",fontSize:12});
const row:React.CSSProperties={display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"};
const routeRow:React.CSSProperties={display:"flex",alignItems:"center",gap:12,justifyContent:"space-between",flexWrap:"wrap",padding:"14px 0",borderTop:"1px solid #27303c"};
const code:React.CSSProperties={color:"#d2d5ff",fontSize:12,overflowWrap:"anywhere"};
const method:React.CSSProperties={fontSize:10,fontWeight:850,color:"#b2f3cd",background:"#163528",borderRadius:5,padding:"4px 6px"};
const smallButton:React.CSSProperties={display:"inline-flex",alignItems:"center",gap:6,textDecoration:"none",border:"1px solid #374151",borderRadius:8,padding:"7px 9px",background:"#202633",color:"#f1f4fa",fontSize:11,cursor:"pointer",whiteSpace:"nowrap"};
const pre:React.CSSProperties={overflowX:"auto",padding:12,background:"#080a0f",borderRadius:8,color:"#d5d8ff",fontSize:11,lineHeight:1.6};
