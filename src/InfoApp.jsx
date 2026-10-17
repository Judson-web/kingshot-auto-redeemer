import React,{useEffect,useRef,useState} from "react";
import {ArrowLeft,CheckCircle,Clock3,Database,Gift,History,LockKeyhole,RefreshCw,Sparkles,Zap,Menu,X,ShieldCheck} from "lucide-react";
const KINGSHOT_ICON="https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/ee/d2/22/eed22297-9313-d8b0-52c8-95f42a2795b2/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/0x0ss-85.png";
function KsLogo(){return <a className="brand ks-brand" href="/"><span className="brand-mark ks-brand-mark"><img src={KINGSHOT_ICON} alt="Kingshot"/></span><span>Kingshot Redeemer</span></a>}
const PROFILE_CHIP_CACHE="ks-profile-chip-v1";
function readCachedProfile(){try{const value=JSON.parse(sessionStorage.getItem(PROFILE_CHIP_CACHE)||"null");return value&&typeof value==="object"&&typeof value.username==="string"?value:null}catch{return null}}
function DiscordChip(){
 const [account,setAccount]=useState(()=>readCachedProfile());
 useEffect(()=>{let live=true,running=false;const load=async()=>{if(running)return;running=true;try{const [pr,dr]=await Promise.all([fetch("/api/kingshot-player?developer=account-auth",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"content-type":"application/json","cache-control":"no-cache"},body:JSON.stringify({action:"profile-check"})}),fetch("/api/kingshot-player?developer=account-auth",{credentials:"same-origin",cache:"no-store",headers:{"cache-control":"no-cache"}})]);const p=await pr.json().catch(()=>({})),d=await dr.json().catch(()=>({}));if(!live)return;if(p.authenticated&&p.user){const next={...p.user,kind:p.kind||p.user.kind||(p.role==="developer"?"developer":"user"),role:p.role||p.user.role||"user"};setAccount(next);try{sessionStorage.setItem(PROFILE_CHIP_CACHE,JSON.stringify(next))}catch{}}else if(d.authenticated&&d.user){const next={...d.user,kind:"developer",role:d.role||"developer"};setAccount(next);try{sessionStorage.setItem(PROFILE_CHIP_CACHE,JSON.stringify(next))}catch{}}else{setAccount(null);try{sessionStorage.removeItem(PROFILE_CHIP_CACHE)}catch{}}}catch{/* Preserve the shared cached profile during temporary network failures. */}finally{running=false}};void load();const refresh=()=>void load();window.addEventListener("focus",refresh);window.addEventListener("ks-profile-updated",refresh);const timer=window.setInterval(load,30000);return()=>{live=false;window.clearInterval(timer);window.removeEventListener("focus",refresh);window.removeEventListener("ks-profile-updated",refresh)}},[]);
 const avatar=account?.avatar_url||"https://cdn.discordapp.com/embed/avatars/0.png?size=64";
 if(!account)return <div className="site-account-wrap"><a className="site-account-chip site-login-chip site-account-icon-only" href="/profile" aria-label="Sign in with Discord" title="Sign in with Discord"><span>♙</span></a></div>;
 const isAdmin=account.role==="admin"||account.kind==="admin",isDeveloper=isAdmin||account.kind==="developer",isDev=isDeveloper&&!isAdmin;
 return <div className="site-account-wrap"><a className={"site-account-chip site-account-icon-only "+(isAdmin?"site-account-admin":isDev?"site-account-developer":"site-account-user")} href="/profile" aria-label={isAdmin?"Admin profile":isDev?"Developer profile":"User profile"} title={(account.username||account.email||"Profile")+" · "+(isAdmin?"Admin":isDev?"Developer":"User")}><span className="site-account-avatar-frame"><img src={avatar} alt="" onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src="https://cdn.discordapp.com/embed/avatars/0.png?size=64"}}/><span className="site-account-role-mark" aria-hidden="true">{isAdmin?"★":isDev?"⌘":"•"}</span></span></a></div>;
}

const sections=[
 {icon:Zap,title:"Automatic redemption",text:"Register your Kingshot Player ID once. The service checks the active gift-code pool automatically and processes eligible codes without requiring you to return and redeem them manually."},
 {icon:History,title:"Backfill for older codes",text:"Backfill is part of the normal redemption flow. If an older code is still active and your player has not handled it, a later run can pick it up."},
 {icon:Database,title:"Persistent redemption history",text:"Each player/code combination is tracked so the same redemption is not repeatedly attempted. The returned game status is stored with the processing record."},
 {icon:RefreshCw,title:"Live code discovery",text:"Codes are collected from multiple public sources, normalized, deduplicated, and filtered when they are known to be expired."},
 {icon:ShieldCheck,title:"Server-side redemption",text:"Redemption requests are submitted from the server. Signing material and privileged database credentials are never sent to the browser."},
 {icon:LockKeyhole,title:"Protected registration",text:"Public endpoints use validation, rate limits, and server-side checks. Registration does not require your Kingshot password or account credentials."},
];

function InfoApp(){
 const [menu,setMenu]=useState(false),menuButtonRef=useRef(null),drawerRef=useRef(null);
 const closeMenu=()=>{setMenu(false);requestAnimationFrame(()=>menuButtonRef.current?.focus())};
 const goBack=()=>{if(history.length>1)history.back();else location.href="/auto"};
 useEffect(()=>{
  if(!menu)return;
  const onKey=e=>{if(e.key==="Escape"){e.preventDefault();closeMenu()}};
  const onPointer=e=>{if(drawerRef.current&&!drawerRef.current.contains(e.target)&&menuButtonRef.current&&!menuButtonRef.current.contains(e.target))closeMenu()};
  document.addEventListener("keydown",onKey);
  document.addEventListener("pointerdown",onPointer);
  const previous=document.body.style.overflow;document.body.style.overflow="hidden";
  requestAnimationFrame(()=>drawerRef.current?.querySelector("a")?.focus());
  return()=>{document.removeEventListener("keydown",onKey);document.removeEventListener("pointerdown",onPointer);document.body.style.overflow=previous};
 },[menu]);
 return <div className="app ks-app info-app">
  <a className="skip-link" href="#main-content">Skip to main content</a>
  <header><KsLogo/><nav><a href="/auto">Auto Redeem</a><a href="/manual">Manual Redeem</a><a className="active" href="/info">How it works</a></nav><div className="header-right"><DiscordChip/><button ref={menuButtonRef} className="menu-btn" onClick={()=>setMenu(v=>!v)} aria-label={menu?"Close menu":"Open menu"} aria-expanded={menu} aria-controls="info-mobile-drawer">{menu?<X size={18}/>:<Menu size={18}/>}</button></div></header>
  {menu&&<>
   <button className="info-menu-backdrop" type="button" aria-label="Close navigation menu" onPointerDown={e=>{e.preventDefault();closeMenu()}} onTouchStart={closeMenu}/>
   <nav ref={drawerRef} className="info-mobile-menu" id="info-mobile-drawer" aria-label="Mobile navigation">
    <div className="info-drawer-head"><div><span className="info-drawer-kicker">NAVIGATION</span><strong>Explore</strong></div><button type="button" onClick={closeMenu} aria-label="Close navigation menu"><X size={15}/></button></div>
    <a href="/auto" onClick={closeMenu}><b>Auto Redeem</b><span>Hands-off gift-code processing</span></a>
    <a href="/manual" onClick={closeMenu}><b>Manual Redeem</b><span>Submit a specific gift code</span></a>
    <a className="active" href="/info" onClick={closeMenu}><b>How it works</b><span>See exactly how the service operates</span><i>Current page</i></a>
    <div className="info-drawer-foot"><ShieldCheck size={13}/><span>Your game password is never requested.</span></div>
   </nav>
  </>}
  <main id="main-content">
   <section className="info-hero"><button className="info-back" onClick={goBack}><ArrowLeft size={14}/> Back</button><div className="eyebrow"><span/>ABOUT THE SERVICE</div><h1>How Kingshot<br/><em>Auto Redeem works.</em></h1><p className="hero-copy">A plain-English guide to the service, from code discovery and backfill to redemption history, server-side processing, and account protection.</p></section>
   <section className="info-flow"><div className="section-title"><span>01</span><h2>The basic flow.</h2></div><div className="info-steps"><article><b>01</b><div><strong>Register your player</strong><p>Your Player ID is looked up so the current kingdom can be associated with the registration.</p></div></article><article><b>02</b><div><strong>Codes enter the active pool</strong><p>Public code sources are checked and normalized. Codes known to be expired are excluded.</p></div></article><article><b>03</b><div><strong>Workers process eligible players</strong><p>Registered players are distributed across a durable worker pool. Each worker processes its assigned shard concurrently.</p></div></article><article><b>04</b><div><strong>Results are remembered</strong><p>Each player/code attempt is claimed and recorded, preventing duplicate work while preserving the redemption result.</p></div></article></div></section>
   <section className="info-features"><div className="section-title"><span>02</span><h2>What the service does.</h2></div><div className="info-grid">{sections.map(({icon:Icon,title,text})=><article key={title}><div className="info-icon"><Icon size={18}/></div><div><h3>{title}</h3><p>{text}</p></div></article>)}</div></section>
   <section className="info-backfill"><div className="info-callout-icon"><Gift size={20}/></div><div><span className="result-label">BACKFILL, EXPLAINED</span><h2>Joining later does not mean missing every valid code.</h2><p>The system keeps redemption history per player. During normal processing it looks for active codes that the player has not already handled. If older active codes remain eligible, later runs can work through them as well.</p><small>Backfill is state-driven, not a separate one-time job. It uses the same redemption and duplicate-prevention rules as normal processing.</small></div></section>
   <section className="info-failures"><div className="section-title"><span>03</span><h2>When something does not go through.</h2></div><div className="info-grid"><article><div className="info-icon"><Clock3 size={18}/></div><div><h3>Expired or already handled</h3><p>A code can be valid elsewhere but expired, exhausted, or already recorded for your player. The service reports the outcome instead of repeatedly retrying it.</p></div></article><article><div className="info-icon"><RefreshCw size={18}/></div><div><h3>Temporary limits</h3><p>Upstream services can rate-limit or temporarily reject requests. The worker backs off rather than hammering the same endpoint.</p></div></article><article><div className="info-icon"><ShieldCheck size={18}/></div><div><h3>Player or kingdom mismatch</h3><p>Player validation happens before redemption so a stale or invalid registration is not blindly submitted to the game service.</p></div></article></div></section><section className="info-notes"><div><Clock3 size={16}/><div><b>Runs continuously</b><span>The production scheduler invokes the coordinator every minute.</span></div></div><div><Sparkles size={16}/><div><b>One service, multiple tools</b><span>Use Auto Redeem for hands-off processing or Manual Redeem when you want to submit a specific code yourself.</span></div></div><div><CheckCircle size={16}/><div><b>Clear outcomes</b><span>Game responses are translated into readable statuses such as successful, already handled, expired, invalid, or rate limited.</span></div></div></section>
  </main>
  <footer><KsLogo/><span>Independent Kingshot community service. Not affiliated with Century Games.</span><span><a href="/info">How it works</a> · <a href="/terms?service=kingshot-auto">Terms</a> · <a href="/privacy?service=kingshot-auto">Privacy</a></span></footer>
 </div>
}
export default InfoApp;
