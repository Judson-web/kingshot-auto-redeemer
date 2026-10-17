import React,{useEffect,useRef,useState}from"react";
import{createRoot}from"react-dom/client";
import{ExternalLink,Gift,Menu,Search,ShieldCheck,ShieldOff,X,CheckCircle,LoaderCircle,AlertTriangle,Info,OctagonAlert,ArrowRight,Copy,Activity,Wrench,WifiOff,UserRound,MessageCircle,Image as ImageIcon,RefreshCw,ChevronLeft,ChevronRight}from"lucide-react";
import{makeSuccessOutcome,makeFailureOutcome,summarizeRegistrationOutcomes,registrationOutcomeHeadline}from"./registration-outcomes.js";
import"./styles.css";
import"./admin-players.css";
import"./support-chat-polish.css";
import LegalApp from"./LegalApp.jsx";
import InfoApp from"./InfoApp.jsx";
import CustomMessageApp from"./CustomMessageApp.jsx";
import GiftCodesApp from"./GiftCodesApp.jsx";
import PushNotifications from"./components/PushNotifications.tsx";
import PushConsoleApp from"./PushConsoleApp.tsx";
import DeveloperApp from"./DeveloperApp.tsx";
import PrivateDevApp from"./PrivateDevApp.tsx";
import ProfileApp from"./ProfileApp.tsx";
import SupportWidget from"./components/SupportWidget.tsx";
import DevSupportApp from"./DevSupportApp.tsx";
import AdminPlayersApp from"./AdminPlayersApp.tsx";


const imageUrl=(user,size=1024,format=user.format)=>"/api/discord-avatar?id="+encodeURIComponent(user.id)+"&hash="+encodeURIComponent(user.avatar)+"&format="+encodeURIComponent(format)+"&size="+encodeURIComponent(size);
const manualResultMeta=status=>{const s=String(status||"").toUpperCase();if(s==="SUCCESS")return{tone:"success",label:"Redeemed successfully.",Icon:CheckCircle};if(s==="RECEIVED"||s==="SAME TYPE EXCHANGE")return{tone:"claimed",label:"Already claimed.",Icon:CheckCircle};if(s==="TIME_ERROR")return{tone:"warning",label:"Code expired.",Icon:AlertTriangle};if(s==="CDK_NOT_FOUND")return{tone:"error",label:"Code not found.",Icon:OctagonAlert};if(s==="USAGE_LIMIT")return{tone:"warning",label:"Redemption limit reached.",Icon:AlertTriangle};if(s==="ROLE_NOT_EXIST")return{tone:"error",label:"Player not found.",Icon:OctagonAlert};if(s==="STATE_MISMATCH")return{tone:"error",label:"Kingdom mismatch.",Icon:OctagonAlert};if(s==="SIGN_ERROR"||s==="LOGIN_EXPIRED_MID_PROCESS")return{tone:"error",label:"Redemption unavailable.",Icon:OctagonAlert};if(s==="TIMEOUT_RETRY")return{tone:"warning",label:"Try again shortly.",Icon:AlertTriangle};return{tone:"error",label:"Redemption could not be completed.",Icon:AlertTriangle};};
const BRAND_ICON="/favicon.svg";
function KsLogo(){return <a className="brand ks-brand" href="/"><span className="brand-mark ks-brand-mark"><img src={BRAND_ICON} alt="Kingshot Redeemer"/></span><span>Kingshot Redeemer</span></a>}
function SiteStatus(){
 const [state,setState]=useState({kind:"checking",label:"CHECKING",message:"Checking live service state."}),[open,setOpen]=useState(false);
 const rootRef=useRef(null);
 useEffect(()=>{let live=true;const load=async()=>{try{const [mr,hr]=await Promise.all([fetch("/api/kingshot-admin-data?public=maintenance",{credentials:"same-origin",cache:"no-store"}),fetch("/api/kingshot-health",{credentials:"same-origin",cache:"no-store"})]);const m=mr.ok?await mr.json().catch(()=>null):null;const h=await hr.json().catch(()=>null);if(!live)return;if(m?.maintenanceEnabled){setState({kind:"maintenance",label:"MAINTENANCE",message:m.message||"The service is temporarily unavailable.",endsAt:m.endsAt||null,checkedAt:Date.now()});return}const healthy=hr.ok&&h?.healthy===true;setState({kind:healthy?"online":"offline",label:healthy?"RUNNING":"OFFLINE",message:healthy?"Production health checks are responding normally.":"The production health check is not reporting a healthy service.",worker:h?.status||null,lastCompletedAt:h?.lastCompletedAt||null,locked:Boolean(h?.locked),checkedAt:Date.now()})}catch{if(live)setState({kind:"offline",label:"OFFLINE",message:"The live service check could not be reached.",checkedAt:Date.now()})}};load();const timer=setInterval(load,30000);return()=>{live=false;clearInterval(timer)}},[]);
 useEffect(()=>{if(!open)return;const onKeyDown=e=>{if(e.key==="Escape")setOpen(false)};const onPointerDown=e=>{if(rootRef.current&&!rootRef.current.contains(e.target))setOpen(false)};document.addEventListener("keydown",onKeyDown);document.addEventListener("pointerdown",onPointerDown);return()=>{document.removeEventListener("keydown",onKeyDown);document.removeEventListener("pointerdown",onPointerDown)}},[open]);
 const Icon=state.kind==="maintenance"?Wrench:state.kind==="offline"?WifiOff:Activity;
 const detail=state.kind==="maintenance"?state.message:state.kind==="online"?"Worker and health checks are operational.":"The site may be unavailable or recovering.";
 const formatTime=value=>value?new Date(value).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}):"Not reported";
 return <div className={"site-status site-status-"+state.kind} ref={rootRef}>
  <button className="site-status-trigger" type="button" aria-expanded={open} aria-controls="site-status-details" aria-label={"Website status: "+state.label+". "+(open?"Close details":"View details")} onClick={()=>setOpen(v=>!v)}><i aria-hidden="true"/><Icon size={12}/></button>
  {open&&<><div className="site-status-backdrop" aria-hidden="true"/><section className="site-status-popover" id="site-status-details" role="dialog" aria-modal="false" aria-label="Live website status details"><div className="site-status-popover-head"><div><span className="site-status-kicker">LIVE WEBSITE STATE</span><b>{state.label==="CHECKING"?"Checking service…":state.label}</b></div><div className="site-status-head-actions"><span className="site-status-pulse"><i/>{state.kind==="checking"?"CHECKING":"LIVE"}</span><button className="site-status-close" type="button" aria-label="Close website status details" onClick={()=>setOpen(false)}><X size={14}/></button></div></div><p>{detail}</p>
  {state.kind==="online"&&<div className="site-status-grid"><span><small>WORKER STATE</small><b>{state.worker||"Not reported"}</b></span><span><small>LAST COMPLETED CYCLE</small><b>{formatTime(state.lastCompletedAt)}</b></span><span><small>WORKER LOCK</small><b>{state.locked?"ACTIVE":"CLEAR"}</b></span><span><small>LAST STATUS CHECK</small><b>{formatTime(state.checkedAt)}</b></span></div>}
  {state.kind==="maintenance"&&<div className="site-status-maintenance"><span><small>ESTIMATED RETURN</small><b>{state.endsAt?formatTime(state.endsAt):"Not scheduled"}</b></span><span><small>LAST STATUS CHECK</small><b>{formatTime(state.checkedAt)}</b></span></div>}
  {(state.kind==="offline"||state.kind==="checking")&&<div className="site-status-maintenance"><span><small>STATUS</small><b>{state.kind==="checking"?"CHECK IN PROGRESS":"HEALTH CHECK FAILED"}</b></span><span><small>LAST STATUS CHECK</small><b>{formatTime(state.checkedAt)}</b></span></div>}
  <div className="site-status-foot"><span>Updates automatically every 30 seconds</span><a href="/info">How it works <ArrowRight size={11}/></a></div></section></>}
 </div>;
}
const PROFILE_CHIP_CACHE="ks-profile-chip-v1";
function readProfileChipCache(){try{const value=JSON.parse(sessionStorage.getItem(PROFILE_CHIP_CACHE)||"null");return value&&typeof value==="object"&&typeof value.username==="string"?value:null}catch{return null}}
function writeProfileChipCache(value){try{if(value)sessionStorage.setItem(PROFILE_CHIP_CACHE,JSON.stringify(value));else sessionStorage.removeItem(PROFILE_CHIP_CACHE)}catch{}}
function DiscordChip(){
 const [account,setAccount]=useState(()=>readProfileChipCache());
 useEffect(()=>{let live=true;let running=false;const load=async()=>{if(running)return;running=true;try{const [pr,dr]=await Promise.all([fetch("/api/kingshot-player?developer=account-auth",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"content-type":"application/json"},body:JSON.stringify({action:"profile-check"})}),fetch("/api/kingshot-player?developer=account-auth",{credentials:"same-origin",cache:"no-store"})]);const p=await pr.json().catch(()=>({})),d=await dr.json().catch(()=>({}));if(!live)return;if(p.authenticated&&p.user){const next={...p.user,kind:p.kind||p.user.kind||(p.role==="developer"?"developer":"user"),role:p.role||p.user.role||"user"};setAccount(next);writeProfileChipCache(next)}else if(d.authenticated&&d.user){const next={...d.user,role:d.role,kind:"developer"};setAccount(next);writeProfileChipCache(next)}else{setAccount(null);writeProfileChipCache(null)}}catch{/* Keep the last known chip visible during transient network failures. */}finally{running=false}};void load();const onFocus=()=>void load();const onRoleChange=()=>void load();window.addEventListener("focus",onFocus);window.addEventListener("ks-profile-updated",onRoleChange);const timer=window.setInterval(load,30000);return()=>{live=false;window.clearInterval(timer);window.removeEventListener("focus",onFocus);window.removeEventListener("ks-profile-updated",onRoleChange)}},[]);
 const avatar=account?.avatar_url||"https://cdn.discordapp.com/embed/avatars/0.png?size=64";
 if(!account)return <div className="site-account-wrap"><a className="site-account-chip site-login-chip site-account-icon-only" href="/profile" aria-label="Sign in with Discord" title="Sign in with Discord"><UserRound size={17}/></a></div>;
 const isAdmin=account.role==="admin"||account.kind==="admin",isDeveloper=isAdmin||account.kind==="developer",isDev=isDeveloper&&!isAdmin;
 return <div className="site-account-wrap"><a className={"site-account-chip site-account-icon-only "+(isAdmin?"site-account-admin":isDev?"site-account-developer":"site-account-user")} href="/profile" aria-label={isAdmin?"Admin profile":isDev?"Developer profile":"User profile"} title={(account.username||account.email||"Profile")+" · "+(isAdmin?"Admin":isDev?"Developer":"User")}><span className="site-account-avatar-frame"><img src={avatar} alt="" onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src="https://cdn.discordapp.com/embed/avatars/0.png?size=64"}}/><span className="site-account-role-mark" aria-hidden="true">{isAdmin?"★":isDev?"⌘":"•"}</span></span></a></div>;
}

function KingshotApp(){
 const [playerId,setPlayerId]=useState(""),[code,setCode]=useState(""),[player,setPlayer]=useState(null),[busy,setBusy]=useState(false),[result,setResult]=useState(null),[error,setError]=useState(""),[menu,setMenu]=useState(false),[copiedRef,setCopiedRef]=useState(false);
 useEffect(()=>{const params=new URLSearchParams(window.location.search);const requestedCode=params.get("code");if(requestedCode&&/^[A-Za-z0-9]{1,64}$/.test(requestedCode))setCode(requestedCode)},[]);
const redeem=async e=>{e.preventDefault();const id=playerId.trim(),gift=code.trim();if(!/^\d{5,20}$/.test(id)){setError("Enter a valid Kingshot Player ID.");return}if(!gift||gift.length>64){setError("Enter a valid gift code.");return}setBusy(true);setError("");setResult(null);try{let p=player;if(!p||String(p.governor_id||p.fid||p.id)!==id){const pr=await fetch("/api/kingshot-player?id="+encodeURIComponent(id));const pd=await pr.json().catch(()=>({}));if(!pr.ok)throw Error(pd.error||"Could not find this player.");p=pd.player||pd;setPlayer(p)}const r=await fetch("/api/kingshot-redeem",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({playerId:id,code:gift,kid:String(p.kid??"")})});const d=await r.json().catch(()=>({}));if(d.status||d.statusLabel||d.message){setResult({...d,ok:Boolean(d.ok),statusLabel:d.statusLabel||d.status||"Redemption result",message:d.message||d.error||"Kingshot returned a redemption result."});if(r.ok){setError("")}else{setError("")}}else if(!r.ok)throw Error(d.error||"Redemption failed.");else setResult(d)}catch(e){setError(e.message||"Redemption failed.")}finally{setBusy(false)}};
 return <div className="app ks-app"><a className="skip-link" href="#main-content">Skip to main content</a><header><KsLogo/><nav className="primary-nav"><a href="/auto">Auto Redeem</a><a href="/info">How it works</a><a href="/developer">Developer API</a></nav><div className="header-right"><DiscordChip/><button className="menu-btn" onClick={()=>setMenu(v=>!v)} aria-label="Open navigation" aria-expanded={menu}><Menu size={18}/></button></div></header>
 {menu&&<><button className="mobile-menu-backdrop" type="button" aria-label="Close navigation menu" onPointerDown={e=>{e.preventDefault();setMenu(false)}} onTouchStart={()=>setMenu(false)}/><div className="mobile-menu" role="dialog" aria-label="Mobile navigation"><a href="/auto" onClick={()=>setMenu(false)}>Auto Redeem</a><a href="/info" onClick={()=>setMenu(false)}>How it works</a><a href="/developer" onClick={()=>setMenu(false)}>Developer API</a><a href="/profile" onClick={()=>setMenu(false)}>Your profile</a></div></>}<main id="main-content"><section className="ks-hero manual-page-hero" id="redeem">
 <div className="manual-hero-copy">
  <div className="eyebrow"><span/>KINGSHOT GIFT CODE REDEEMER</div>
  <h1>Claim your rewards.<br/><em>Manually.</em></h1>
  <p className="hero-copy">Enter your Player ID and gift code. We’ll identify your kingdom first, then submit the redemption securely from the server.</p>
  <div className="manual-trust-row">
   <span><ShieldCheck size={13}/> Server-side</span><span><CheckCircle size={13}/> No game password</span><span><Gift size={13}/> One code at a time</span>
  </div>
 </div>
 <form className="ks-form manual-redeem-form" onSubmit={redeem}>
  <div className="manual-form-head"><div><span className="manual-form-kicker">01 · PLAYER DETAILS</span><h2>Ready to redeem?</h2><p>Two details. One redemption request.</p></div><span className="manual-secure"><ShieldCheck size={14}/> Secure</span></div>
  <div className="manual-fields">
   <div className="ks-field manual-field-card"><label htmlFor="manual-player-id"><span>PLAYER ID</span><i>01</i></label><div><Search size={16}/><input id="manual-player-id" inputMode="numeric" enterKeyHint="next" autoComplete="off" value={playerId} onChange={e=>{setPlayerId(e.target.value.replace(/\D/g,""));setPlayer(null);setResult(null)}} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();document.getElementById("manual-gift-code")?.focus()}}} placeholder="e.g. 43180889"/></div><small>Your Kingshot Player ID, not your kingdom number.</small></div>
   <div className="ks-field manual-field-card"><label htmlFor="manual-gift-code"><span>GIFT CODE</span><i>02</i></label><div><Gift size={16}/><input id="manual-gift-code" value={code} onChange={e=>setCode(e.target.value.replace(/\s/g,""))} placeholder="e.g. Hangul2026" autoCapitalize="none" autoComplete="off" spellCheck="false" enterKeyHint="done"/></div><small>Enter the code exactly as provided.</small></div>
  </div>
  <div className="manual-submit-row"><span>By continuing, the request is sent to Kingshot through our server.</span><button className="ks-submit manual-submit" disabled={busy}>{busy?<><span className="manual-spinner" aria-hidden="true"><span></span><LoaderCircle size={15}/></span><span className="manual-submit-label"><strong>Processing</strong><small>Sending securely…</small></span></>:<><Gift size={16}/> Redeem Gift Code</>}</button></div>
 </form>
 {error&&<div className="ks-error" role="alert" aria-live="assertive"><b>Couldn’t redeem that code.</b><span>{error}</span></div>}
 {player&&!result&&<div className="ks-player"><div className="ks-avatar">{player.avatar_url?<img src={player.avatar_url} alt=""/>:<span>{(player.nick_name||"K").slice(0,1)}</span>}</div><div><b>{player.nick_name||"Kingshot Player"}</b><span>Kingdom {player.kid ?? "—"} · TC {player.town_center_level ?? "—"}</span></div><CheckCircle size={17}/></div>}
 {result&&(()=>{const meta=manualResultMeta(result.status);const Icon=meta.Icon;const success=String(result.status||"").toUpperCase()==="SUCCESS";const codeLabel=String(code||"").toUpperCase();const playerLabel=player?.nick_name||"Kingshot Player";const kingdomLabel=player?.kid??"—";return <div className={"ks-result ks-result-"+meta.tone} role="status" aria-live="polite"><div className="ks-result-identity"><div className="ks-avatar">{player?.avatar_url?<img src={player.avatar_url} alt=""/>:<span>{(playerLabel||"K").slice(0,1)}</span>}</div><div><b>{playerLabel}</b><span>Kingdom {kingdomLabel} · TC {player?.town_center_level ?? "—"}</span></div><CheckCircle size={17}/></div><div className="ks-result-main"><div className="ks-result-icon"><Icon size={21}/></div><div className="ks-result-copy"><span className="ks-result-kicker">{success?"REDEMPTION COMPLETE":"REDEMPTION RESULT"}</span><b>{result.statusLabel&&result.status==="SUCCESS"?result.statusLabel:meta.label}</b><span>{result.message||result.error||"Kingshot returned a redemption result."}</span></div></div><div className="ks-result-details"><span><small>GIFT CODE</small><b>{codeLabel||"—"}</b></span>{result.errCode&&<span><small>REFERENCE</small><b>{result.errCode}</b></span>}</div><div className="ks-result-footer"><span><ShieldCheck size={13}/> No game password required.</span><div className="ks-result-actions">{result.errCode&&<button className="ks-result-copy" type="button" onClick={async()=>{try{await navigator.clipboard.writeText(String(result.errCode));setCopiedRef(true);setTimeout(()=>setCopiedRef(false),1600)}catch{}}}><Copy size={12}/><span>{copiedRef?"Copied":"Copy reference"}</span></button>}<button className="ks-result-again" type="button" onClick={()=>{setResult(null);setError("");setCode("");setPlayer(null);setCopiedRef(false);}}><span>Redeem another</span><ArrowRight size={13}/></button></div></div></div>})()}
 </section><section className="ks-how" id="how"><div className="section-title"><span>01</span><h2>Simple by design.</h2></div><div className="feature-grid"><article><Search/><b>1. Find your player</b><p>Your Player ID is used to retrieve the current kingdom before redemption.</p></article><article><Gift/><b>2. Submit the code</b><p>The redemption request is signed server-side. Your signing secret is never exposed.</p></article><article><CheckCircle/><b>3. Get the result</b><p>We translate the game API response into a clear redemption status.</p></article></div></section></main><footer><KsLogo/><span>Independent Kingshot community service. Not affiliated with Century Games.</span><span><a href="/info">How it works</a> · <a href="/terms?service=kingshot-manual">Terms</a> · <a href="/privacy?service=kingshot-manual">Privacy</a></span></footer></div>
}

function AutoRedeemApp(){
 const [ids,setIds]=useState(""),[busy,setBusy]=useState(false),[outcomes,setOutcomes]=useState([]),[error,setError]=useState(""),[menu,setMenu]=useState(false);
 const register=async e=>{
  e.preventDefault();
  const input=ids.trim();
  setError("");
  if(!input){setOutcomes([]);setError("Enter at least one Kingshot Player ID.");return}
  if(!/^[0-9, ]+$/.test(input)){setOutcomes([]);setError("Player IDs can only contain digits, spaces, or commas.");return}
  const raw=[...new Set(input.split(/[ ,]+/).map(v=>v.trim()).filter(Boolean))];
  const invalid=raw.find(id=>!/^[0-9]{5,20}$/.test(id));
  if(invalid){setOutcomes([]);setError("Each Player ID must contain 5–20 digits. Check: "+invalid);return}
  setBusy(true);setOutcomes([]);
  const collected=[];
  try{
   for(const id of raw){
    let result;
    try{
     const profileResponse=await fetch("/api/kingshot-player?id="+encodeURIComponent(id));
     const profileData=await profileResponse.json().catch(()=>({}));
     if(!profileResponse.ok)throw Object.assign(new Error(profileData.error||"Could not find this player in the game profile service."),{code:profileData.code,banned:profileData.banned,disabled:profileData.disabled,alreadyRegistered:profileData.alreadyRegistered,ban:profileData.ban});
     const player=profileData.player||profileData;
     const registrationResponse=await fetch("/api/kingshot-register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({playerId:id,kingdomId:String(player.kid??""),playerName:player.nick_name||player.name||player.nickname||"Kingshot Player",avatarUrl:player.avatar_url||player.avatar||player.avatarUrl||""})});
     const registrationData=await registrationResponse.json().catch(()=>({}));
     if(!registrationResponse.ok)throw Object.assign(new Error(registrationData.error||"Could not register this player."),{code:registrationData.code,banned:registrationData.banned,disabled:registrationData.disabled,alreadyRegistered:registrationData.alreadyRegistered,ban:registrationData.ban,reason:registrationData.reason});
     result=makeSuccessOutcome(id,player,registrationData);
    }catch(failure){
     result=makeFailureOutcome({id,message:failure?.message,code:failure?.code,banned:failure?.banned,disabled:failure?.disabled,alreadyRegistered:failure?.alreadyRegistered,ban:failure?.ban,reason:failure?.reason});
    }
    collected.push(result);
    setOutcomes([...collected]);
   }
  }catch(failure){setError(failure instanceof Error?failure.message:"Registration could not be completed. Please try again.")}
  finally{setBusy(false)}
 };
 return <div className="app ks-app"><a className="skip-link" href="#auto-main-content">Skip to main content</a><header><KsLogo/><nav><a href="/manual">Manual Redeem</a><a href="/info">How it works</a><a href="/developer">API Docs</a></nav><div className="header-right"><DiscordChip/><button className="menu-btn" onClick={()=>setMenu(v=>!v)} aria-label="Menu"><Menu size={18}/></button></div></header>{menu&&<><button className="mobile-menu-backdrop" type="button" aria-label="Close navigation menu" onPointerDown={e=>{e.preventDefault();setMenu(false)}} onTouchStart={()=>setMenu(false)}/><div className="mobile-menu" role="dialog" aria-label="Mobile navigation"><a href="/manual" onClick={()=>setMenu(false)}>Manual Redeem</a><a href="/info" onClick={()=>setMenu(false)}>How it works</a><a href="/developer" onClick={()=>setMenu(false)}>API Docs</a></div></>}<main id="auto-main-content"><section className="ks-auto-hero"><div className="eyebrow"><span/>KINGSHOT AUTO REDEEM</div><h1>Never miss a gift code.<br/><em>Let it run for you.</em></h1><p className="hero-copy">Register your Kingshot Player ID once. Active gift codes are checked automatically, including older codes that are still valid.</p><form className="ks-register-box" onSubmit={register} aria-describedby="auto-register-help"><div className="ks-register-field"><label htmlFor="auto-player-ids">PLAYER ID(S)</label><div><Gift size={17}/><input id="auto-player-ids" inputMode="numeric" enterKeyHint="done" value={ids} onChange={e=>{const value=e.target.value;if(/^[0-9, ]*$/.test(value))setIds(value)}} onBeforeInput={e=>{if(e.data&&!/^[0-9, ]+$/.test(e.data))e.preventDefault()}} onPaste={e=>{const pasted=e.clipboardData.getData("text/plain");if(!/^[0-9, ]*$/.test(pasted))e.preventDefault()}} onDrop={e=>{const dropped=e.dataTransfer.getData("text/plain");if(!/^[0-9, ]*$/.test(dropped))e.preventDefault()}} placeholder="Enter one or more Player IDs" autoComplete="off" spellCheck="false" pattern="[0-9, ]*" aria-describedby="auto-register-help"/></div><small id="auto-register-help">Use digits only. Separate multiple IDs with spaces or commas. Pasted text must contain only digits, spaces, or commas.</small></div><button className="ks-submit" disabled={busy}>{busy?<><span className="register-spinner" aria-hidden="true"><LoaderCircle size={16}/></span><span>Checking players…</span></>: "Register for Auto Redeem"}</button></form>{error&&<div className="ks-error" role="alert" aria-live="assertive"><b>Registration needs attention.</b><span>{error}</span></div>}
 <RegistrationOutcomePanel outcomes={outcomes}/>
 </section><section className="ks-auto-how" id="how"><div className="section-title"><span>01</span><h2>How automatic redemption works.</h2></div><div className="feature-grid"><article><Gift/><b>1. Register once</b><p>Each Player ID is checked independently, so one blocked ID does not stop other registrations in the same submission.</p></article><article><Gift/><b>2. Recover missed codes</b><p>Every active code is checked against that player's redemption history, including older valid codes.</p></article><article><CheckCircle/><b>3. Redeem safely</b><p>Each player/code pair is claimed atomically, so overlapping workers cannot submit the same redemption twice.</p></article></div></section></main><footer><KsLogo/><span>Automatic redemption is a community service. Not affiliated with Century Games.</span><span><a href="/info">How it works</a> · <a href="/terms?service=kingshot-auto">Terms</a> · <a href="/privacy?service=kingshot-auto">Privacy</a></span></footer></div>
}
function RegistrationOutcomePanel({outcomes}){
 const trackRef=useRef(null);
 const [activeIndex,setActiveIndex]=useState(0);
 const summary=summarizeRegistrationOutcomes(outcomes);
 useEffect(()=>{setActiveIndex(current=>Math.max(0,Math.min(current,Math.max(0,outcomes.length-1))))},[outcomes.length]);
 if(!outcomes.length)return null;
 const current=outcomes[Math.min(activeIndex,outcomes.length-1)];
 const multiple=outcomes.length>1;
 const tone=summary.allRestricted?"blocked":summary.needsAttention?"attention":"success";
 const kind=summary.banned?"banned":summary.disabled?"disabled":summary.failed?"failed":summary.reactivated?"reactivated":summary.existing?"existing":"registered";
 const iconFor=value=>value==="banned"?<ShieldOff size={20}/>:value==="disabled"?<WifiOff size={20}/>:value==="failed"?<AlertTriangle size={20}/>:value==="existing"?<ShieldCheck size={20}/>:value==="reactivated"?<RefreshCw size={20}/>:<CheckCircle size={20}/>;
 const goTo=index=>{const target=Math.max(0,Math.min(outcomes.length-1,index));trackRef.current?.scrollTo({left:target*(trackRef.current?.clientWidth||0),behavior:"smooth"});setActiveIndex(target)};
 const onScroll=e=>{const width=Math.max(1,e.currentTarget.clientWidth);setActiveIndex(Math.max(0,Math.min(outcomes.length-1,Math.round(e.currentTarget.scrollLeft/width))))};
 const footer=summary.allActive?"All submitted IDs are active. Eligible gift codes will be checked automatically.":summary.allRestricted?"No registration was created for these IDs. Contact Support if you believe a restriction is incorrect.":summary.active?"Each Player ID was processed independently. Active registrations remain active even if another ID is blocked or needs attention.":"Review each ID's status and reason below. Contact Support if you need help with a blocked or disabled registration.";
 return <section className={"ks-outcome-panel ks-outcome-"+tone} aria-labelledby="ks-outcome-title">
  <div className="ks-outcome-header"><div className="ks-outcome-head-icon">{iconFor(multiple?kind:current.kind)}</div><div className="ks-outcome-head-copy"><span className="ks-outcome-kicker">{multiple?outcomes.length+" PLAYER IDs · SUBMISSION SUMMARY":"PLAYER ID STATUS"}</span><h2 id="ks-outcome-title">{multiple?"Registration results":registrationOutcomeHeadline(outcomes)}</h2><p>{multiple?summary.message:current.summary}</p></div><span className="ks-outcome-count"><b>{outcomes.length}</b><small>{multiple?"CHECKED":"PLAYER"}</small></span></div>
  {multiple&&<div className="ks-outcome-summary" aria-label="Outcome totals">{summary.active>0&&<span className="is-active"><CheckCircle size={12}/>{summary.active} active</span>}{summary.banned>0&&<span className="is-blocked"><ShieldOff size={12}/>{summary.banned} blocked</span>}{summary.disabled>0&&<span className="is-disabled"><WifiOff size={12}/>{summary.disabled} disabled</span>}{summary.failed>0&&<span className="is-failed"><AlertTriangle size={12}/>{summary.failed} need attention</span>}</div>}
  <div className="ks-outcome-track-wrap"><div ref={trackRef} className="ks-outcome-track" role="region" aria-label={multiple?"Swipe to review each Player ID result":"Player registration result"} tabIndex="0" onScroll={onScroll} onKeyDown={e=>{if(e.key==="ArrowRight"){e.preventDefault();goTo(activeIndex+1)}else if(e.key==="ArrowLeft"){e.preventDefault();goTo(activeIndex-1)}}}>{outcomes.map((item,index)=><article className={"ks-outcome-slide ks-outcome-"+item.kind} key={item.id+"-"+index} aria-label={"Player ID result "+(index+1)+" of "+outcomes.length}><div className="ks-outcome-slide-icon">{iconFor(item.kind)}</div><div className="ks-outcome-slide-content"><div className="ks-outcome-player-heading"><h3>Player ID {item.id}</h3><span className={"ks-outcome-badge badge-"+item.kind}>{item.label}</span></div>{(item.name||item.kingdom&&item.kingdom!=="—")&&<p className="ks-outcome-player-meta">{item.name&&item.name!=="Kingshot Player"?item.name:""}{item.name&&item.name!=="Kingshot Player"&&item.kingdom&&item.kingdom!=="—"?" · ":""}{item.kingdom&&item.kingdom!=="—"?"Kingdom "+item.kingdom:""}</p>}<p className="ks-outcome-description">{item.summary}</p>{item.reason&&<div className="ks-outcome-reason"><small>BLOCK REASON</small><span>{item.reason}</span></div>}</div></article>)}</div>{multiple&&<><button type="button" className="ks-outcome-arrow previous" onClick={()=>goTo(activeIndex-1)} disabled={activeIndex===0} aria-label="Previous Player ID result"><ChevronLeft size={18}/></button><button type="button" className="ks-outcome-arrow next" onClick={()=>goTo(activeIndex+1)} disabled={activeIndex===outcomes.length-1} aria-label="Next Player ID result"><ChevronRight size={18}/></button></>}</div>
  {multiple&&<div className="ks-outcome-pagination"><span aria-live="polite">Player {activeIndex+1} of {outcomes.length}</span><div className="ks-outcome-dots" aria-label="Choose a Player ID result">{outcomes.length<=8&&outcomes.map((item,index)=><button type="button" key={item.id+"-"+index} className={index===activeIndex?"active":""} aria-label={"Show result for Player ID "+item.id} aria-current={index===activeIndex?"step":undefined} onClick={()=>goTo(index)}/>)}</div><small>Swipe to review</small></div>}
  <div className="ks-outcome-footer"><Info size={16}/><p>{footer}</p></div>
 </section>
}
function MaintenanceScreen({state}){
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);
 const endMs=state?.endsAt?new Date(state.endsAt).getTime():null,remaining=endMs?Math.max(0,endMs-now):null,totalSeconds=remaining===null?null:Math.ceil(remaining/1000),days=totalSeconds===null?0:Math.floor(totalSeconds/86400),hours=totalSeconds===null?0:Math.floor((totalSeconds%86400)/3600),minutes=totalSeconds===null?0:Math.floor((totalSeconds%3600)/60),seconds=totalSeconds===null?0:totalSeconds%60;
 return <div className="maintenance-app"><div className="maintenance-noise" aria-hidden="true"/><div className="maintenance-glow maintenance-glow-a"/><div className="maintenance-glow maintenance-glow-b"/><main className="maintenance-shell"><div className="maintenance-brand"><span className="maintenance-brand-mark"><Gift size={16}/></span><span><b>KINGSHOT REDEEMER</b><small>SERVICE STATUS</small></span><DiscordChip/></div><div className="maintenance-card"><div className="maintenance-topline"><span className="maintenance-status"><i/>SYSTEM MAINTENANCE</span><span className="maintenance-live"><i/>IN PROGRESS</span></div><div className="maintenance-visual" aria-hidden="true"><span className="maintenance-visual-ring maintenance-visual-ring-a"/><span className="maintenance-visual-ring maintenance-visual-ring-b"/><div className="maintenance-icon"><Wrench size={24}/></div><span className="maintenance-visual-spark maintenance-visual-spark-a"/><span className="maintenance-visual-spark maintenance-visual-spark-b"/></div><span className="maintenance-kicker">A LITTLE PAUSE. A BETTER EXPERIENCE.</span><h1>We’ll be back<br/><em>in a moment.</em></h1><p className="maintenance-message">{state?.message||"We’re tuning things up behind the scenes. Thanks for your patience while we get everything ready."}</p>{remaining!==null?<><div className="maintenance-countdown-label"><span>ESTIMATED RETURN</span><b>{days?`${days}d remaining`:hours?`${hours}h ${String(minutes).padStart(2,"0")}m remaining`:minutes?`${minutes}m ${String(seconds).padStart(2,"0")}s remaining`:`${seconds}s remaining`}</b></div><div className={"maintenance-countdown "+(days?"has-days":"")} aria-label="Maintenance countdown">{days>0&&<div className="maintenance-time"><b>{String(days).padStart(2,"0")}</b><span>DAYS</span></div>}<div className="maintenance-time"><b>{String(hours).padStart(2,"0")}</b><span>HOURS</span></div><div className="maintenance-time"><b>{String(minutes).padStart(2,"0")}</b><span>MINUTES</span></div><div className="maintenance-time"><b>{String(seconds).padStart(2,"0")}</b><span>SECONDS</span></div></div><div className="maintenance-note"><CheckCircle size={14}/><span>You’ll be returned to the site automatically when service is restored.</span></div></>:<div className="maintenance-note"><CheckCircle size={14}/><span>We’re working behind the scenes. This page will return automatically when service is restored.</span></div>}</div><p className="maintenance-footer">Kingshot Redeemer <span>·</span> Independent community service</p></main></div>
}
function MaintenancePreflight({error}){
 return <div className="maintenance-preflight" role="status" aria-live="polite"><div className="maintenance-preflight-card"><div className="maintenance-loader" aria-hidden="true"><span className="maintenance-loader-orbit maintenance-loader-orbit-a"/><span className="maintenance-loader-orbit maintenance-loader-orbit-b"/><span className="maintenance-loader-core"><i/></span></div><span className="maintenance-kicker">PREPARING SECURE CONNECTION</span><h1 key={error?"availability":"status"}>{error?"Checking service availability":"Checking website status"}</h1><p key={error?"retry-copy":"status-copy"}>{error?"The maintenance status could not be confirmed yet. The website will stay hidden until the check succeeds. Retrying automatically.":"We check maintenance mode before loading the website."}</p><span className="maintenance-preflight-progress"><i/></span><small>{error?"RETRYING EVERY 5 SECONDS":"LIVE STATUS CHECK · PLEASE WAIT"}</small></div></div>
}
function MaintenanceGate({children}){
 const [state,setState]=useState(null),[verified,setVerified]=useState(false),[error,setError]=useState(false);
 useEffect(()=>{let live=true;let busy=false;const load=async()=>{if(busy)return;busy=true;try{const response=await fetch("/api/kingshot-admin-data?public=maintenance",{credentials:"same-origin",cache:"no-store",headers:{"cache-control":"no-cache"}});if(!response.ok)throw Error("Maintenance status unavailable");const data=await response.json();if(!data||typeof data.maintenanceEnabled!=="boolean")throw Error("Invalid maintenance status");if(!live)return;setState(previous=>{const next={maintenanceEnabled:data.maintenanceEnabled,message:data.message||"",endsAt:data.endsAt||null,updatedAt:data.updatedAt||null};return previous&&previous.maintenanceEnabled===next.maintenanceEnabled&&previous.message===next.message&&previous.endsAt===next.endsAt?previous:next});setVerified(true);setError(false)}catch{if(live){setError(true);/* Keep the last verified state during a transient outage. */}}finally{busy=false}};load();const timer=setInterval(load,5000);return()=>{live=false;clearInterval(timer)}},[]);
 if(!verified||!state)return <MaintenancePreflight error={error}/>;
 if(state.maintenanceEnabled)return <MaintenanceScreen state={state}/>;
 return children;
}
const announcementIcon=t=>t==="success"?CheckCircle:t==="warning"?AlertTriangle:t==="important"?OctagonAlert:Info;
function InstallAppPrompt(){const [installEvent,setInstallEvent]=useState(null),[dismissed,setDismissed]=useState(()=>{try{return localStorage.getItem("ks-install-dismissed")==="1"}catch{return false}});useEffect(()=>{const onBefore=e=>{e.preventDefault();setInstallEvent(e)};const onInstalled=()=>{setInstallEvent(null);setDismissed(true);try{localStorage.setItem("ks-install-dismissed","1")}catch{}};window.addEventListener("beforeinstallprompt",onBefore);window.addEventListener("appinstalled",onInstalled);return()=>{window.removeEventListener("beforeinstallprompt",onBefore);window.removeEventListener("appinstalled",onInstalled)}},[]);if(!installEvent||dismissed)return null;const install=async()=>{const pending=installEvent;setInstallEvent(null);try{await pending.prompt();const choice=await pending.userChoice;if(choice?.outcome==="accepted"){setDismissed(true);try{localStorage.setItem("ks-install-dismissed","1")}catch{}}}catch{}};const dismiss=()=>{setDismissed(true);try{localStorage.setItem("ks-install-dismissed","1")}catch{}};return <aside className="ks-install-prompt" aria-label="Install Kingshot Redeemer" aria-live="polite"><div className="ks-install-icon"><img src="/favicon.svg" alt=""/></div><div className="ks-install-copy"><b>Install Kingshot Redeemer</b><span>Add it to your home screen for faster access.</span></div><button type="button" className="ks-install-action" onClick={install}>Install</button><button type="button" className="ks-install-close" aria-label="Dismiss install prompt" onClick={dismiss}><X size={15}/></button></aside>}
function AnnouncementCard({item}){if(!item)return null;const C=announcementIcon(item.type||"info");return <aside className={"site-announcement site-announcement-"+(item.type||"info")}><div className="site-announcement-icon"><C size={17}/></div><div className="site-announcement-content"><b>{item.title||"Announcement title"}</b><p>{item.message||"Your announcement message will appear here."}</p>{item.link_url&&<a href={item.link_url} target="_blank" rel="noopener noreferrer">{item.link_label||"Learn more"} <ExternalLink size={11}/></a>}</div></aside>}
function PublicAnnouncements({children}){const[state,setState]=useState(null);useEffect(()=>{fetch("/api/kingshot-admin-data?public=announcements").then(r=>r.ok?r.json():null).then(d=>setState(d?.announcements||[])).catch(()=>setState([]))},[]);return <>{state?.[0]&&<div style={{maxWidth:"1180px",margin:"0 auto",padding:"14px 20px 0"}}><AnnouncementCard item={state[0]}/></div>}{children}</>}
function PublicMaintenance({children}){const [state,setState]=useState(null);useEffect(()=>{let live=true;fetch("/api/kingshot-admin-data?public=maintenance",{credentials:"same-origin",cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{if(live)setState(d||{maintenanceEnabled:false})}).catch(()=>{if(live)setState({maintenanceEnabled:false})});return()=>{live=false}},[]);return state?.maintenanceEnabled?<MaintenanceScreen/>:children}
const publicPage=location.pathname==="/auto"||location.pathname==="/" ? <AutoRedeemApp/>:location.pathname==="/manual"||location.pathname==="/redeem" ? <KingshotApp/>:location.pathname==="/info"?<InfoApp/>:location.pathname==="/message"?<CustomMessageApp/>:location.pathname==="/push"?<PushConsoleApp/>:location.pathname==="/developer"?<DeveloperApp/>:location.pathname==="/profile"?<ProfileApp/>:location.pathname==="/dev"?<PrivateDevApp/>:location.pathname==="/devsupport"?<DevSupportApp/>:location.pathname==="/admin/players"?<AdminPlayersApp/>:location.pathname==="/gift-codes"?<GiftCodesApp/>:location.pathname==="/terms"?<LegalApp type="terms"/>:location.pathname==="/privacy"?<LegalApp type="privacy"/>:<AutoRedeemApp/>; function registerAppServiceWorker(){
 if(!("serviceWorker" in navigator))return;
 const showUpdate=()=>{
  if(document.getElementById("ks-update-toast"))return;
  const toast=document.createElement("button");
  toast.id="ks-update-toast";
  toast.type="button";
  toast.textContent="New version available · Refresh";
  Object.assign(toast.style,{position:"fixed",left:"50%",bottom:"18px",transform:"translateX(-50%)",zIndex:"9999",padding:"11px 15px",border:"1px solid #3b3327",borderRadius:"999px",background:"#11131a",color:"#f2eee8",font:"700 11px system-ui,sans-serif",boxShadow:"0 14px 40px #0009",cursor:"pointer"});
  toast.onclick=()=>{
   const waiting=window.__ksWaitingWorker;
   if(waiting)waiting.postMessage({type:"SKIP_WAITING"});
   else location.reload();
  };
  document.body.appendChild(toast);
 };
 window.addEventListener("load",()=>{
  navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).then(reg=>{
   reg.update().catch(()=>{});
   reg.addEventListener("updatefound",()=>{
    const worker=reg.installing;
    if(!worker)return;
    window.__ksWaitingWorker=worker;
    worker.addEventListener("statechange",()=>{
     if(worker.state==="installed"&&navigator.serviceWorker.controller)showUpdate();
    });
   });
  }).catch(()=>{});
  navigator.serviceWorker.addEventListener("controllerchange",()=>location.reload());
 });
}

function recordVisitorPageView(){
 try{
  if(!window.fetch||!window.sessionStorage)return;
  const path=location.pathname;
  if(!path||path.startsWith("/api/")||path==="/push"||path==="/message"||path==="/developer"||path==="/dev"||path==="/devsupport"||path==="/admin/players")return;
  const key="ks_telemetry_seen:"+path;
  if(sessionStorage.getItem(key))return;
  sessionStorage.setItem(key,"1");
  const referrerHost=(()=>{try{return document.referrer?new URL(document.referrer).hostname:""}catch{return""}})();
  const width=window.innerWidth||0;
  const screenClass=width<600?"small":width<1024?"medium":width>=1024?"large":"unknown";
  fetch("/api/ops-tools/visitor",{method:"POST",credentials:"same-origin",keepalive:true,headers:{"Content-Type":"application/json"},body:JSON.stringify({path,referrerHost,screenClass})}).catch(()=>{});
 }catch{}
}
if(typeof window!=="undefined")window.addEventListener("load",recordVisitorPageView,{once:true});

registerAppServiceWorker();

createRoot(document.getElementById("root")).render(<MaintenanceGate><PublicAnnouncements>{publicPage}</PublicAnnouncements><InstallAppPrompt/><PushNotifications/>{location.pathname!=="/devsupport"&&<SupportWidget/>}</MaintenanceGate>);