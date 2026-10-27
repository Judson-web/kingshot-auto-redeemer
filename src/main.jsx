import React,{useEffect,useRef,useState}from"react";
import{createRoot}from"react-dom/client";
import{ExternalLink,Gift,Menu,Search,ShieldCheck,ShieldOff,X,CheckCircle,LoaderCircle,AlertTriangle,Info,OctagonAlert,ArrowRight,Activity,Wrench,WifiOff,UserRound,MessageCircle,LifeBuoy,Image as ImageIcon,RefreshCw,ChevronLeft,ChevronRight}from"lucide-react";
import{makeSuccessOutcome,makeFailureOutcome,summarizeRegistrationOutcomes,registrationOutcomeHeadline}from"./registration-outcomes.js";import{registrationInputSummary,sanitizeRegistrationInput,validateRegistrationIds}from"./registration-input.js";
import { playerIdFeedback } from "./player-id-feedback.js";
import{formatPower,playerDisplayName}from"../lib/player-display.js";
import"./styles.css";import"./registration-outcomes.css";import"./ux-feedback.css";
import"./manual-redesign.css";import"./auto-registration-redesign.css";import"./drawer-redesign.css";import"./maintenance-redesign.css";import"./icon-palette.css";import"./public-site-header.css";
import MobileNavDrawer from"./components/MobileNavDrawer.jsx";
import PublicSiteHeader from"./components/PublicSiteHeader.jsx";
import {useSiteLanguage} from "./shared/site-language.js";
import TownCenterLevel from"./components/TownCenterLevel.tsx";
import { useServiceStatus } from "./shared/service-status.js";
import KingshotAvatar from"./components/KingshotAvatar.tsx";

const LegalApp=React.lazy(()=>import("./LegalApp.jsx"));
const InfoApp=React.lazy(()=>import("./InfoApp.jsx"));
const CustomMessageApp=React.lazy(()=>import("./CustomMessageApp.jsx"));
const GiftCodesApp=React.lazy(()=>import("./GiftCodesApp.jsx"));
const PushNotifications=React.lazy(()=>import("./components/PushNotifications.tsx"));
const PushConsoleApp=React.lazy(()=>import("./PushConsoleApp.tsx"));
const DeveloperApp=React.lazy(()=>import("./DeveloperApp.tsx"));
const PrivateDevApp=React.lazy(()=>import("./PrivateDevApp.tsx"));
const ProfileApp=React.lazy(()=>import("./ProfileApp.tsx"));
const SupportWidget=React.lazy(()=>import("./components/SupportWidget.tsx"));
const DevSupportApp=React.lazy(()=>import("./DevSupportApp.tsx"));
const AdminPlayersApp=React.lazy(()=>import("./AdminPlayersApp.tsx"));
const MaintenanceAdminApp=React.lazy(()=>import("./MaintenanceAdminApp.tsx"));

const imageUrl=(user,size=1024,format=user.format)=>"/api/discord-avatar?id="+encodeURIComponent(user.id)+"&hash="+encodeURIComponent(user.avatar)+"&format="+encodeURIComponent(format)+"&size="+encodeURIComponent(size);
const manualResultMeta=(status,t)=>{const s=String(status||"").toUpperCase();if(s==="INVALID_INPUT")return{tone:"error",label:t("manual.statusCheck","Check your details."),Icon:AlertTriangle};if(s==="SUCCESS")return{tone:"success",label:t("manual.statusSuccess","Redeemed successfully."),Icon:CheckCircle};if(s==="RECEIVED"||s==="SAME TYPE EXCHANGE")return{tone:"claimed",label:t("manual.statusClaimed","Already claimed."),Icon:CheckCircle};if(s==="TIME_ERROR")return{tone:"warning",label:t("manual.statusExpired","Code expired."),Icon:AlertTriangle};if(s==="CDK_NOT_FOUND")return{tone:"error",label:t("manual.statusNotFound","Code not found."),Icon:OctagonAlert};if(s==="USAGE_LIMIT")return{tone:"warning",label:t("manual.statusLimit","Redemption limit reached."),Icon:AlertTriangle};if(s==="ROLE_NOT_EXIST")return{tone:"error",label:t("manual.statusPlayer","Player not found."),Icon:OctagonAlert};if(s==="STATE_MISMATCH")return{tone:"error",label:t("manual.statusKingdom","Kingdom mismatch."),Icon:OctagonAlert};if(s==="SIGN_ERROR"||s==="LOGIN_EXPIRED_MID_PROCESS")return{tone:"error",label:t("manual.statusUnavailable","Redemption unavailable."),Icon:OctagonAlert};if(s==="TIMEOUT_RETRY")return{tone:"warning",label:t("manual.statusRetry","Try again shortly."),Icon:AlertTriangle};return{tone:"error",label:t("manual.statusFailed","Redemption could not be completed."),Icon:AlertTriangle};};
const BRAND_ICON="/favicon.svg";
function KsLogo(){return <a className="brand ks-brand" href="/"><span className="brand-mark ks-brand-mark"><img src={BRAND_ICON} alt="Kingshot Redeemer"/></span><span>Kingshot Redeemer</span></a>}
function CopyToastHost(){
 const [message,setMessage]=useState("");
 const timerRef=useRef(0);
 useEffect(()=>{const handleCopied=event=>{const label=String(event?.detail?.label||"Text").trim()||"Text";setMessage(label+" copied successfully");window.clearTimeout(timerRef.current);timerRef.current=window.setTimeout(()=>setMessage(""),2600)};window.addEventListener("ks-copy-success",handleCopied);return()=>{window.removeEventListener("ks-copy-success",handleCopied);window.clearTimeout(timerRef.current)}},[]);
 if(!message)return null;
 return <div className="ks-copy-toast" role="status" aria-live="polite" aria-atomic="true"><CheckCircle size={16}/><span>{message}</span></div>;
}
function PlayerMetaLine({player,kingdom}) {
 const power = formatPower(player?.power ?? player?.player_power);
 const townCenter = player?.town_center_level ?? player?.tc_level ?? player?.townCenterLevel ?? player?.town_center;
 return <span className="ks-player-meta-line"><span>Power {power}</span><span className="ks-player-meta-separator" aria-hidden="true">·</span><span>Kingdom {kingdom ?? player?.kid ?? player?.kingdom_id ?? "—"}</span><span className="ks-player-meta-separator" aria-hidden="true">·</span><span className="ks-player-meta-tc">TC <TownCenterLevel value={townCenter}/></span></span>;
}
function KingshotApp(){
 const {t}=useSiteLanguage();
 const [playerId,setPlayerId]=useState(""),[code,setCode]=useState(""),[player,setPlayer]=useState(null),[busy,setBusy]=useState(false),[result,setResult]=useState(null),[error,setError]=useState(""),[errorTitle,setErrorTitle]=useState("Couldn’t redeem that code.");
 const manualSubmissionRef=useRef(false);
 useEffect(()=>{const params=new URLSearchParams(window.location.search);const requestedCode=params.get("code");if(requestedCode&&/^[A-Za-z0-9_-]{6,32}$/.test(requestedCode))setCode(requestedCode)},[]);
 const redeem=async e=>{
  e.preventDefault();
  if(manualSubmissionRef.current)return;
  const id=playerId.trim(),gift=code.trim();
  if(!/^\d{5,20}$/.test(id)){setResult(null);setErrorTitle("Check Player ID");setError("Use the numeric Player ID shown in Kingshot under Profile → Info. It must contain 5–20 digits; your kingdom number is different.");return}
  if(!/^[A-Za-z0-9_-]{6,32}$/.test(gift)){setResult(null);setErrorTitle("Check gift code");setError(t("manual.codeHelp","Gift codes must be 6–32 letters, numbers, underscores, or hyphens."));return}
  manualSubmissionRef.current=true;setBusy(true);setError("");setErrorTitle("Couldn’t redeem that code.");setResult(null);
  try{
   let p=player;
   if(!p||String(p.governor_id||p.fid||p.id)!==id){
    const pr=await fetch("/api/kingshot-player?id="+encodeURIComponent(id),{signal:AbortSignal.timeout(15000)});
    const pd=await pr.json().catch(()=>({}));
    if(!pr.ok)throw Object.assign(new Error(pd.error||"Could not find this player."),{code:pd.code,status:pr.status});
    p=pd.player||pd;setPlayer(p);
   }
   const r=await fetch("/api/kingshot-redeem",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({playerId:id,code:gift,kid:String(p.kid??"")}),signal:AbortSignal.timeout(40000)});
   const d=await r.json().catch(()=>({}));
   if(d.status||d.statusLabel||d.message){
    setResult({...d,ok:Boolean(d.ok),statusLabel:d.statusLabel||d.status||"Redemption result",message:d.message||d.error||"Kingshot returned a redemption result."});
    setError("");
   }else if(!r.ok)throw Error(d.error||"Redemption failed.");
   else setResult(d);
  }catch(e){
   const issue=playerIdFeedback(e?.code,e?.message);
   const timedOut=e?.name==="TimeoutError"||e?.name==="AbortError";
   if(issue){setErrorTitle(issue.title);setError(issue.message)}
   else{setErrorTitle(timedOut?"Request timed out":"Couldn’t redeem that code.");setError(timedOut?"The request timed out. It was not retried automatically because Kingshot may already have received it. Check in-game mail before submitting again.":e.message||"Redemption failed.")}
  }finally{manualSubmissionRef.current=false;setBusy(false)}
 };

 return <div className="app ks-app ks-manual-app"><a className="skip-link" href="#main-content">{t("common.skip","Skip to main content")}</a><PublicSiteHeader current="manual" /><main id="main-content"><section className="ks-hero manual-page-hero" id="redeem">
 <div className="manual-hero-copy">
  <div className="eyebrow"><span/>KINGSHOT GIFT CODE REDEEMER</div>
  <h1>{t("manual.title","Redeem a gift code")}</h1>
  <p className="hero-copy">{t("manual.hero","Use your Kingshot Player ID and gift code below. The result will appear here.")}</p>
  
 </div>
 <form className="ks-form manual-redeem-form" noValidate onSubmit={redeem}>
  <div className="manual-form-head"><div><span className="manual-form-kicker">{t("manual.playerDetails","01 · PLAYER DETAILS")}</span><h2>{t("manual.yourDetails","Your details")}</h2><p>{t("manual.lookup","We’ll look up your player before sending the code.")}</p></div><span className="manual-secure"><ShieldCheck size={14}/> {t("manual.serverSide","Server-side")}</span></div>
  <div className="manual-fields">
   <div className="ks-field manual-field-card"><label htmlFor="manual-player-id"><span>{t("manual.playerId","Player ID")}</span><i>01</i></label><div className={error&&errorTitle==="Check Player ID"?"is-invalid":""}><Search size={16}/><input id="manual-player-id" inputMode="numeric" required minLength={5} maxLength={20} pattern="[0-9]{5,20}" aria-describedby={error&&errorTitle==="Check Player ID"?"manual-player-help manual-error":"manual-player-help"} aria-invalid={Boolean(error&&errorTitle==="Check Player ID")} enterKeyHint="next" autoComplete="off" value={playerId} onChange={e=>{setPlayerId(e.target.value.replace(/\D/g,""));setPlayer(null);setResult(null);setError("");setErrorTitle("Couldn’t redeem that code.")}} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();document.getElementById("manual-gift-code")?.focus()}}} placeholder="e.g. 43180889"/></div><small id="manual-player-help">{t("manual.playerIdHelp","Your Player ID is different from your kingdom number.")}</small></div>
   <div className="ks-field manual-field-card"><label htmlFor="manual-gift-code"><span>{t("manual.giftCode","Gift code")}</span><i>02</i></label><div className={error&&errorTitle==="Check gift code"?"is-invalid":""}><Gift size={16}/><input id="manual-gift-code" required minLength={6} maxLength={32} pattern="[A-Za-z0-9_-]{6,32}" aria-describedby={error&&errorTitle==="Check gift code"?"manual-code-help manual-error":"manual-code-help"} aria-invalid={Boolean(error&&errorTitle==="Check gift code")} value={code} onChange={e=>{setCode(e.target.value.replace(/\s/g,""));setError("");setErrorTitle("Couldn’t redeem that code.")}} placeholder="e.g. Hangul2026" autoCapitalize="none" autoComplete="off" spellCheck="false" enterKeyHint="done"/></div><small id="manual-code-help">6–32 letters, numbers, underscores, or hyphens.</small></div>
  </div>
  <div className="manual-submit-row"><span>{t("common.noPassword","Your game password is never requested.")}</span><button className="ks-submit manual-submit" disabled={busy}>{busy?<><span className="manual-spinner" aria-hidden="true"><span></span><LoaderCircle size={15}/></span><span className="manual-submit-label"><strong>{t("manual.processing","Processing")}</strong><small>{t("manual.sending","Sending securely…")}</small></span></>:<><Gift size={16}/> {t("manual.submit","Redeem code")}</>}</button></div>
 </form>
 {error&&<div className="ks-error" id="manual-error" role="alert" aria-live="assertive"><b>{errorTitle}</b><span>{error}</span></div>}
 {player&&!result&&<div className="ks-player"><KingshotAvatar playerId={playerId||player?.fid||player?.governor_id} avatarUrl={player.avatar_url} size={38} initials={(player.nick_name||"K").slice(0,1)}/><div><b>{playerDisplayName(player,"Kingshot Player")}</b><PlayerMetaLine player={player}/></div><CheckCircle size={17}/></div>}
 {result&&(()=>{const status=String(result.status||"").toUpperCase();const meta=manualResultMeta(status,t);const Icon=meta.Icon;const success=status==="SUCCESS";const playerLabel=playerDisplayName(player||{},"Kingshot Player");const kingdomLabel=player?.kid??"—";const giftCode=String(code||"").trim();const rawMessage=String(result.message||result.error||"").trim();const safeRawMessage=rawMessage&&(!giftCode||!rawMessage.toLowerCase().includes(giftCode.toLowerCase()))&&rawMessage.toLowerCase()!==String(meta.label).toLowerCase()?rawMessage:"The request could not be completed. Try again shortly.";const summary=success?"Check your in-game mail for the rewards.":(status==="RECEIVED"||status==="SAME TYPE EXCHANGE")?"This code has already been claimed on this account.":status==="TIME_ERROR"?"This code has expired.":status==="CDK_NOT_FOUND"?"This code was not recognized. Check its spelling. The attempt is finished and will not be retried automatically.":status==="USAGE_LIMIT"?"Kingshot recognized this code, but its redemption limit has been reached. This is a limit result, not an invalid-code rejection.":status==="ROLE_NOT_EXIST"?"Kingshot couldn’t recognize this Player ID for redemption. Verify it under Profile → Info, then try again.":status==="STATE_MISMATCH"?"This code is not available in this player’s kingdom.":(status==="SIGN_ERROR"||status==="LOGIN_EXPIRED_MID_PROCESS")?"Redemption is temporarily unavailable. Try again shortly.":status==="TIMEOUT_RETRY"?"Kingshot asked for a cooldown. This attempt is finished; wait before choosing to submit again.":status==="INVALID_INPUT"?(result.message||"Check the Player ID and gift code format."):safeRawMessage;return <article className={"ks-result ks-result-"+meta.tone+" ks-result-compact"} key={status+"-"+String(result.errCode||"")} role="status" aria-live="polite"><div className="ks-result-identity"><KingshotAvatar playerId={playerId||player?.fid||player?.governor_id} avatarUrl={player?.avatar_url} size={50} initials={(playerLabel||"K").slice(0,1)}/><div className="ks-result-player"><b>{playerLabel}</b><PlayerMetaLine player={player||{}} kingdom={kingdomLabel}/></div></div><div className="ks-result-copy"><span className="ks-result-kicker">{t("manual.resultKicker","REDEMPTION RESULT")}</span><div className="ks-result-status"><Icon size={17} aria-hidden="true"/><b>{meta.label}</b></div><p>{summary}</p></div></article>})()}
 </section><section className="ks-how" id="how"><div className="section-title"><span>01</span><h2>{t("manual.how","How redemption works")}</h2></div><div className="feature-grid"><article><Search/><b>{t("manual.step1","1. Find your player")}</b><p>{t("manual.step1Text","Your Player ID is used to retrieve the current kingdom before redemption.")}</p></article><article><Gift/><b>{t("manual.step2","2. Submit the code")}</b><p>{t("manual.step2Text","The redemption request is signed server-side. Your signing secret is never exposed.")}</p></article><article><CheckCircle/><b>{t("manual.step3","3. Get the result")}</b><p>{t("manual.step3Text","We translate the game API response into a clear redemption status.")}</p></article></div></section></main><footer><KsLogo/><span>{t("common.footer","Independent Kingshot community service. Not affiliated with Century Games.")}</span><span><a href="/info">{t("info.title","How it works")}</a> · <a href="/terms?service=kingshot-manual">{t("legal.termsTab","Terms")}</a> · <a href="/privacy?service=kingshot-manual">{t("legal.privacyTab","Privacy")}</a></span></footer></div>
}

function AutoRedeemApp(){
 const {t}=useSiteLanguage();
 const [ids,setIds]=useState(""),[busy,setBusy]=useState(false),[outcomes,setOutcomes]=useState([]),[error,setError]=useState(""),[inputNotice,setInputNotice]=useState(""),[progress,setProgress]=useState({done:0,total:0,currentId:""});
 const inputSummary=registrationInputSummary(ids);
 const idInputRef=useRef(null),pendingCaretRef=useRef(null),discardTokenRef=useRef(false);
 useEffect(()=>{
  if(pendingCaretRef.current===null)return;
  const caret=pendingCaretRef.current;
  pendingCaretRef.current=null;
  const field=idInputRef.current;
  if(field){field.focus({preventScroll:true});field.setSelectionRange(caret,caret)}
 },[ids]);
 const insertCleanText=(field,raw)=>{
  const source=String(raw??"");
  const containsUnsupported=/[^0-9,\s]/.test(source);
  const safe=sanitizeRegistrationInput(source);
  discardTokenRef.current=false;
  const start=field.selectionStart??ids.length,end=field.selectionEnd??start;
  const before=ids.slice(0,start),after=ids.slice(end);
  const next=sanitizeRegistrationInput(before+safe+after);
  pendingCaretRef.current=next===ids?null:sanitizeRegistrationInput(before+safe).length;
  setIds(next);
  setInputNotice(containsUnsupported?t("auto.unsupportedIgnored","Letters and symbols were ignored. Only digits, commas, and spaces are allowed."):"");
  if(error)setError("");
 };
 const register=async e=>{
  e.preventDefault();
  const parsed=validateRegistrationIds(ids);
  setError("");
  if(parsed.error){setOutcomes([]);setError(parsed.error);return}
  const raw=parsed.ids;
  setBusy(true);setOutcomes([]);
  setProgress({done:0,total:raw.length,currentId:raw[0]||""});
  const collected=[];
  try{
   for(const id of raw){
    setProgress({done:collected.length,total:raw.length,currentId:id});
    let result; let player=null; let phase="player lookup";
    try{
     const lookupSignal=typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function"?AbortSignal.timeout(15000):undefined;
     const profileUrl="/api/kingshot-player?id="+encodeURIComponent(id);
     const profileResponse=await fetch(profileUrl,lookupSignal?{signal:lookupSignal}:{});

     const profileData=await profileResponse.json().catch(()=>({}));
     if(!profileResponse.ok)throw Object.assign(new Error(profileData.error||"Could not find this player in the game profile service."),{code:profileData.code,banned:profileData.banned,disabled:profileData.disabled,alreadyRegistered:profileData.alreadyRegistered,ban:profileData.ban});
     player=profileData.player||profileData;
     phase="registration";
     const registrationResponse=await fetch("/api/kingshot-register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({playerId:id,kingdomId:String(player.kid??""),playerName:player.nick_name||player.name||player.nickname||"Kingshot Player",avatarUrl:player.avatar_url||player.avatar||player.avatarUrl||""})});
     const registrationData=await registrationResponse.json().catch(()=>({}));
     if(!registrationResponse.ok)throw Object.assign(new Error(registrationData.error||"Could not register this player."),{code:registrationData.code,banned:registrationData.banned,disabled:registrationData.disabled,alreadyRegistered:registrationData.alreadyRegistered,ban:registrationData.ban,reason:registrationData.reason});
     result=makeSuccessOutcome(id,player,registrationData);
    }catch(failure){
     const timedOut=failure?.name==="TimeoutError"||failure?.name==="AbortError";
     const transportFailure=failure?.name==="TypeError";
     const failureMessage=timedOut?"Player lookup timed out. Please retry this ID.":transportFailure?phase==="registration"?"Connection interrupted during registration. Check this Player ID's status before retrying.":"Could not reach player lookup. Check your connection and retry this ID.":failure?.message;
     result=makeFailureOutcome({id,player,message:failureMessage,code:failure?.code,banned:failure?.banned,disabled:failure?.disabled,alreadyRegistered:failure?.alreadyRegistered,ban:failure?.ban,reason:failure?.reason});
    }
    collected.push(result);
    setOutcomes([...collected]);
    setProgress({done:collected.length,total:raw.length,currentId:collected.length<raw.length?raw[collected.length]:""});
   }
  }catch(failure){setError(failure instanceof Error?failure.message:"Registration could not be completed. Please try again.")}
  finally{setBusy(false);setProgress(current=>({...current,currentId:""}))}
 };
 return <div className="app ks-app ks-auto-app"><a className="skip-link" href="#auto-main-content">{t("common.skip","Skip to main content")}</a><PublicSiteHeader current="auto" /><main id="auto-main-content"><section className="ks-auto-hero"><div className="eyebrow"><span/>KINGSHOT AUTO REDEEM</div><h1>{t("auto.title","Automatic redemption")}</h1><p className="hero-copy">{t("auto.hero","Eligible gift codes are checked automatically for registered players.")}</p><form className="ks-register-box ks-register-card" onSubmit={register} aria-describedby={error?"auto-register-help auto-register-error":"auto-register-help"} aria-busy={busy}>
 <div className="ks-register-card-intro">
  <div className="ks-register-card-intro-icon"><Gift size={20} aria-hidden="true"/></div>
  <div className="ks-register-card-intro-copy">
   <span className="ks-register-card-eyebrow">{t("auto.oneTime","ONE-TIME SETUP")}</span>
   <h2>{t("auto.registerPlayers","Register your players")}</h2>
  </div>
  <span className="ks-register-card-limit">{t("auto.limit","UP TO 10")}</span>
 </div>
 <div className="ks-register-field">
  <div className="ks-register-label-row"><label htmlFor="auto-player-ids">{t("auto.playerIds","Player IDs")}</label><span>{t("auto.digitsEach","5–20 digits each")}</span></div>
  <div className="ks-register-entry"><Gift size={18} aria-hidden="true"/><textarea ref={idInputRef} id="auto-player-ids" rows={1} inputMode="numeric" enterKeyHint="enter" value={ids} onChange={e=>{const value=e.target.value,clean=sanitizeRegistrationInput(value),containsUnsupported=/[^0-9,\s]/.test(value);if(clean!==value)pendingCaretRef.current=sanitizeRegistrationInput(value.slice(0,e.target.selectionStart)).length;else pendingCaretRef.current=null;setIds(clean);setInputNotice(containsUnsupported?t("auto.unsupportedIgnored","Letters and symbols were ignored. Only digits, commas, and spaces are allowed."):"");if(error)setError("")}} onBeforeInput={e=>{const event=e.nativeEvent,field=e.currentTarget;if(event.inputType==="insertLineBreak"||event.inputType==="insertParagraph"){e.preventDefault();insertCleanText(field," ");return}if(!event.data)return;if(/[^0-9, ]/.test(event.data)){e.preventDefault();const value=field.value,start=field.selectionStart??0,end=field.selectionEnd??start,left=Math.max(value.lastIndexOf(",",start-1),value.lastIndexOf(" ",start-1))+1,tail=value.slice(end),nextSeparator=tail.search(/[, ]/),right=nextSeparator<0?value.length:end+nextSeparator,next=value.slice(0,left)+value.slice(right);discardTokenRef.current=true;pendingCaretRef.current=next===value?null:left;setIds(next);setInputNotice(t("auto.unsupported","Letters and symbols are not accepted. Use digits, commas, or spaces."));return}if(discardTokenRef.current){if(event.data===","||event.data===" ")discardTokenRef.current=false;else{e.preventDefault();return}}}} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();insertCleanText(e.currentTarget," ")}}} onPaste={e=>{e.preventDefault();insertCleanText(e.currentTarget,e.clipboardData.getData("text/plain"))}} onDrop={e=>{e.preventDefault();insertCleanText(e.currentTarget,e.dataTransfer.getData("text/plain"))}} placeholder="e.g. 43180889, 51234567" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck="false" maxLength={256} aria-describedby={error?"auto-register-help auto-register-error":"auto-register-help"} aria-invalid={Boolean(error)}/></div>
  <small id="auto-register-help">{t("auto.inputHelp","Use Enter between IDs, or paste a comma/space-separated list.")}</small>
  {inputNotice&&<small className="ks-register-input-notice" role="status" aria-live="polite">{inputNotice}</small>}
  {ids.trim()&&<div className={"ks-register-id-summary"+(inputSummary.overLimit?" is-limit":"")} id="auto-id-summary" role="status" aria-live="polite" aria-atomic="true"><span>{inputSummary.label}</span><small>{inputSummary.detail}</small></div>}
 </div>
 <button className={"ks-submit ks-register-submit"+(busy?" register-loading":"")} disabled={busy}>{busy?<><span className="manual-spinner" aria-hidden="true"><span></span><LoaderCircle size={15}/></span><span className="manual-submit-label"><strong>{t("auto.registering","Registering players")}</strong><small>{t("auto.processingEach","Processing each ID in order…")}</small></span></> : <>{t("auto.submit","Register players")} <ArrowRight size={17} aria-hidden="true"/></>}</button>
 <div className="ks-register-card-footer"><ShieldCheck size={15} aria-hidden="true"/><span>{t("common.noPassword","Your game password is never requested.")}</span></div>
</form>
{busy&&<div className="ks-register-progress" role="status" aria-live="polite" aria-atomic="true"><div className="ks-register-progress-top"><b>{t("auto.registering","Registering players")}</b><span>{progress.done} {t("auto.progressOf","of")} {progress.total} {t("auto.progressComplete","complete")}</span></div><progress max={progress.total||1} value={progress.done} aria-label={t("auto.progressLabel","Player registration progress")}/><small>{progress.currentId?t("auto.checkingId","Checking Player ID")+" "+progress.currentId+"…":t("auto.preparing","Preparing the next result…")}</small><p>{t("auto.progressHelp","Results appear as each ID finishes. Each registration is handled separately.")}</p></div>}
{error&&<div className="ks-error" role="alert" aria-live="assertive" id="auto-register-error"><b>{t("auto.errorTitle","Registration needs attention.")}</b><span>{error}</span></div>}
<RegistrationOutcomePanel outcomes={outcomes}/>
 </section><section className="ks-auto-how" id="how"><div className="section-title"><span>01</span><h2>{t("auto.how","How it works")}</h2></div><div className="feature-grid"><article><UserRound/><b>{t("auto.step1","Register once")}</b><p>{t("auto.step1Text","Each ID is enrolled separately.")}</p></article><article><RefreshCw/><b>{t("auto.step2","Automatic checks")}</b><p>{t("auto.step2Text","Eligible codes, including older valid codes, are checked.")}</p></article><article><CheckCircle/><b>{t("auto.step3","Individual results")}</b><p>{t("auto.step3Text","One result per ID. An issue with one player does not stop the others.")}</p></article></div></section></main><footer><KsLogo/><span>{t("auto.footer","Automatic redemption is a community service. Not affiliated with Century Games.")}</span><span><a href="/info">{t("info.title","How it works")}</a> · <a href="/terms?service=kingshot-auto">{t("legal.termsTab","Terms")}</a> · <a href="/privacy?service=kingshot-auto">{t("legal.privacyTab","Privacy")}</a></span></footer></div>
}
function RegistrationOutcomePanel({outcomes}){
 const {t}=useSiteLanguage();
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
 return <section className={"ks-outcome-panel ks-outcome-"+tone+(multiple?"":" ks-outcome-single")} aria-labelledby="ks-outcome-title">
  <div className="ks-outcome-header"><div className="ks-outcome-head-icon">{iconFor(multiple?kind:current.kind)}</div><div className="ks-outcome-head-copy"><span className="ks-outcome-kicker">{multiple?t("outcome.summaryKicker","SUBMISSION SUMMARY"):t("outcome.playerKicker","PLAYER ID STATUS")}</span><h2 id="ks-outcome-title">{multiple?t("outcome.title","Registration results"):registrationOutcomeHeadline(outcomes)}</h2>{(multiple||(current.kind!=="existing"&&current.code!=="invalid_player_id"&&current.code!=="player_not_found"))&&<p>{multiple?summary.message:current.summary}</p>}</div>{multiple&&<span className="ks-outcome-count"><b>{outcomes.length}</b><small>{t("outcome.checked","CHECKED")}</small></span>}</div>
  {multiple&&<div className="ks-outcome-summary" aria-label={t("outcome.totals","Outcome totals")}>{summary.active>0&&<span className="is-active"><CheckCircle size={12}/>{summary.active} {t("outcome.active","active")}</span>}{summary.banned>0&&<span className="is-blocked"><ShieldOff size={12}/>{summary.banned} {t("outcome.blocked","blocked")}</span>}{summary.disabled>0&&<span className="is-disabled"><WifiOff size={12}/>{summary.disabled} {t("outcome.disabled","disabled")}</span>}{summary.failed>0&&<span className="is-failed"><AlertTriangle size={12}/>{summary.failed} {t("outcome.attention","need attention")}</span>}</div>}
  <div className="ks-outcome-track-wrap"><div ref={trackRef} className={"ks-outcome-track"+(multiple?"":" ks-outcome-track-single")} role="region" aria-label={multiple?t("outcome.swipeResults","Swipe to review each Player ID result"):t("outcome.registrationResult","Player registration result")} tabIndex="0" onScroll={onScroll} onKeyDown={e=>{if(e.key==="ArrowRight"){e.preventDefault();goTo(activeIndex+1)}else if(e.key==="ArrowLeft"){e.preventDefault();goTo(activeIndex-1)}}}>{outcomes.map((item,index)=><article className={"ks-outcome-slide ks-outcome-"+item.kind+(multiple?"":" ks-outcome-slide-single")} key={item.id+"-"+index} aria-label={t("outcome.playerResult","Player ID result")+" "+(index+1)+" "+t("auto.progressOf","of")+" "+outcomes.length}><div className="ks-outcome-slide-icon">{item.avatar?<KingshotAvatar playerId={item.id} avatarUrl={item.avatar} size={46} initials={(item.name||"K").slice(0,1)} className="ks-outcome-avatar-shell"/>:iconFor(item.kind)}</div><div className="ks-outcome-slide-content"><div className="ks-outcome-player-heading"><div className="ks-outcome-identity"><h3>{item.name&&item.name!=="Kingshot Player"?item.name:"Player profile"}</h3><p className="ks-outcome-player-meta">Power {item.power} · Kingdom {item.kingdom} · <span className="ks-outcome-tc">TC <TownCenterLevel value={item.townCenterLevel}/></span></p><small className="ks-outcome-player-id">Player ID {item.id}</small></div>{item.kind!=="existing"&&<span className={"ks-outcome-badge badge-"+item.kind}>{item.label}</span>}</div>{item.kind!=="existing"&&(multiple||item.code==="invalid_player_id"||item.code==="player_not_found")&&<p className="ks-outcome-description">{item.summary}</p>}{item.reason&&<div className="ks-outcome-reason"><small>{t("outcome.disabledReason","DISABLED REASON")}</small><span>{item.reason}</span></div>}</div></article>)}</div>{multiple&&<><button type="button" className="ks-outcome-arrow previous" onClick={()=>goTo(activeIndex-1)} disabled={activeIndex===0} aria-label={t("outcome.previous","Previous Player ID result")}><ChevronLeft size={18}/></button><button type="button" className="ks-outcome-arrow next" onClick={()=>goTo(activeIndex+1)} disabled={activeIndex===outcomes.length-1} aria-label={t("outcome.next","Next Player ID result")}><ChevronRight size={18}/></button></>}</div>
  {multiple&&<div className="ks-outcome-pagination"><span aria-live="polite">{t("outcome.player","Player")} {activeIndex+1} {t("auto.progressOf","of")} {outcomes.length}</span><div className="ks-outcome-dots" aria-label={t("outcome.chooseResult","Choose a Player ID result")}>{outcomes.length<=8&&outcomes.map((item,index)=><button type="button" key={item.id+"-"+index} className={index===activeIndex?"active":""} aria-label={t("outcome.showResult","Show result for Player ID")+" "+item.id} aria-current={index===activeIndex?"step":undefined} onClick={()=>goTo(index)}/>)}</div><small>{t("outcome.swipe","Swipe to review")}</small></div>}
  {multiple&&summary.active!==outcomes.length&&<div className="ks-outcome-footer"><Info size={16}/><p>{footer}</p></div>}
 </section>
}
function MaintenanceScreen({state}){
 const [now,setNow]=useState(Date.now());
 const supportButtonRef=useRef(null);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);
 const rawEnd=state?.endsAt?new Date(state.endsAt).getTime():null;
 const estimateAvailable=Number.isFinite(rawEnd)&&rawEnd>0;
 const remaining=estimateAvailable?Math.max(0,rawEnd-now):null;
 const totalSeconds=remaining===null?null:Math.ceil(remaining/1000);
 const days=totalSeconds===null?0:Math.floor(totalSeconds/86400);
 const hours=totalSeconds===null?0:Math.floor((totalSeconds%86400)/3600);
 const minutes=totalSeconds===null?0:Math.floor((totalSeconds%3600)/60);
 const seconds=totalSeconds===null?0:totalSeconds%60;
 const contactSupport=()=>window.dispatchEvent(new CustomEvent("ks-support-open",{detail:{topic:"Other",subject:"Maintenance support request",pageTitle:"Service maintenance",returnFocus:supportButtonRef.current||undefined}}));
 return <div className="maintenance-app">
  <main className="maintenance-shell">
   <header className="maintenance-brand">
    <span className="maintenance-brand-mark"><Gift size={17}/></span>
    <span><b>KINGSHOT REDEEMER</b><small>SERVICE STATUS</small></span>
    <span className="maintenance-current-status"><i aria-hidden="true"/>Maintenance active</span>
   </header>
   <section className="maintenance-card" aria-labelledby="maintenance-title">
    <div className="maintenance-topline"><span className="maintenance-status"><i aria-hidden="true"/>MAINTENANCE MODE</span><span className="maintenance-live"><i aria-hidden="true"/>IN PROGRESS</span></div>
    <div className="maintenance-visual" aria-hidden="true"><div className="maintenance-icon"><Wrench size={21}/></div></div>
    <span className="maintenance-kicker">SERVICE UPDATE</span>
    <h1 id="maintenance-title">We’re making a few improvements.</h1>
    <p className="maintenance-message">{state?.message||"The service is temporarily unavailable while maintenance is in progress. Please check back shortly."}</p>
    {remaining!==null&&remaining>0?<><div className="maintenance-countdown-label"><span>ESTIMATED RETURN</span><b>{days?days+"d remaining":hours?hours+"h "+String(minutes).padStart(2,"0")+"m remaining":minutes?minutes+"m "+String(seconds).padStart(2,"0")+"s remaining":seconds+"s remaining"}</b></div><div className={"maintenance-countdown "+(days?"has-days":"")} aria-label="Estimated time remaining">{days>0&&<div className="maintenance-time"><b>{String(days).padStart(2,"0")}</b><span>DAYS</span></div>}<div className="maintenance-time"><b>{String(hours).padStart(2,"0")}</b><span>HOURS</span></div><div className="maintenance-time"><b>{String(minutes).padStart(2,"0")}</b><span>MINUTES</span></div><div className="maintenance-time"><b>{String(seconds).padStart(2,"0")}</b><span>SECONDS</span></div></div></>:<p className="maintenance-estimate-note">{estimateAvailable?"The estimated window has passed. We’re checking for recovery automatically.":"No return time has been scheduled. We’re checking for recovery automatically."}</p>}
    <p className="maintenance-note"><CheckCircle size={14}/><span>Status refreshes automatically. This page will return to the site when service is restored.</span></p>
    <div className="maintenance-actions"><button ref={supportButtonRef} type="button" className="maintenance-support-button" onClick={contactSupport}><MessageCircle size={16}/>Contact support</button><span>Need help while the site is paused?</span></div>
   </section>
   <footer className="maintenance-footer">Kingshot Redeemer <span>·</span> Independent community service</footer>
  </main>
 </div>
}
function MaintenancePreflight({error}){
 return <div className="maintenance-preflight" role="status" aria-live="polite"><div className="maintenance-preflight-card"><div className="maintenance-loader" aria-hidden="true"><span className="maintenance-loader-orbit maintenance-loader-orbit-a"/><span className="maintenance-loader-orbit maintenance-loader-orbit-b"/><span className="maintenance-loader-core"><i/></span></div><span className="maintenance-kicker">PREPARING SECURE CONNECTION</span><h1 key={error?"availability":"status"}>{error?"Checking service availability":"Checking website status"}</h1><p key={error?"retry-copy":"status-copy"}>{error?"The maintenance status could not be confirmed yet. The website will stay hidden until the check succeeds. Retrying automatically.":"We check maintenance mode before loading the website."}</p><span className="maintenance-preflight-progress"><i/></span><small>{error?"RETRYING EVERY 5 SECONDS":"LIVE STATUS CHECK · PLEASE WAIT"}</small></div></div>
}
function MaintenanceGate({children}){
 const {maintenance}=useServiceStatus({criticalMaintenance:true});
 if(!maintenance.verified)return <MaintenancePreflight error={maintenance.error}/>;
 if(maintenance.maintenanceEnabled)return <><MaintenanceScreen state={maintenance}/><SupportWidget maintenanceMode/></>;
 return children;
}
const announcementIcon=t=>t==="success"?CheckCircle:t==="warning"?AlertTriangle:t==="important"?OctagonAlert:Info;
function InstallAppPrompt(){const [installEvent,setInstallEvent]=useState(null),[dismissed,setDismissed]=useState(()=>{try{return localStorage.getItem("ks-install-dismissed")==="1"}catch{return false}});useEffect(()=>{const onBefore=e=>{e.preventDefault();setInstallEvent(e)};const onInstalled=()=>{setInstallEvent(null);setDismissed(true);try{localStorage.setItem("ks-install-dismissed","1")}catch{}};window.addEventListener("beforeinstallprompt",onBefore);window.addEventListener("appinstalled",onInstalled);return()=>{window.removeEventListener("beforeinstallprompt",onBefore);window.removeEventListener("appinstalled",onInstalled)}},[]);if(!installEvent||dismissed)return null;const install=async()=>{const pending=installEvent;setInstallEvent(null);try{await pending.prompt();const choice=await pending.userChoice;if(choice?.outcome==="accepted"){setDismissed(true);try{localStorage.setItem("ks-install-dismissed","1")}catch{}}}catch{}};const dismiss=()=>{setDismissed(true);try{localStorage.setItem("ks-install-dismissed","1")}catch{}};return <aside className="ks-install-prompt" aria-label="Install Kingshot Redeemer" aria-live="polite"><div className="ks-install-icon"><img src="/favicon.svg" alt=""/></div><div className="ks-install-copy"><b>Install Kingshot Redeemer</b><span>Add it to your home screen for faster access.</span></div><button type="button" className="ks-install-action" onClick={install}>Install</button><button type="button" className="ks-install-close" aria-label="Dismiss install prompt" onClick={dismiss}><X size={15}/></button></aside>}
function AnnouncementCard({item}){if(!item)return null;const C=announcementIcon(item.type||"info");return <aside className={"site-announcement site-announcement-"+(item.type||"info")}><div className="site-announcement-icon"><C size={17}/></div><div className="site-announcement-content"><b>{item.title||"Announcement title"}</b><p>{item.message||"Your announcement message will appear here."}</p>{item.link_url&&<a href={item.link_url} target="_blank" rel="noopener noreferrer">{item.link_label||"Learn more"} <ExternalLink size={11}/></a>}</div></aside>}
function PublicAnnouncements({children}){const[state,setState]=useState(null);useEffect(()=>{fetch("/api/kingshot-admin-data?public=announcements").then(r=>r.ok?r.json():null).then(d=>setState(d?.announcements||[])).catch(()=>setState([]))},[]);return <>{state?.[0]&&<div style={{maxWidth:"1180px",margin:"0 auto",padding:"14px 20px 0"}}><AnnouncementCard item={state[0]}/></div>}{children}</>}

const publicPage=location.pathname==="/auto"||location.pathname==="/" ? <AutoRedeemApp/>:location.pathname==="/manual"||location.pathname==="/redeem" ? <KingshotApp/>:location.pathname==="/info"?<InfoApp/>:location.pathname==="/message"?<CustomMessageApp/>:location.pathname==="/push"?<PushConsoleApp/>:location.pathname==="/developer"?<DeveloperApp/>:location.pathname==="/profile"?<ProfileApp/>:location.pathname==="/dev"?<PrivateDevApp/>:location.pathname==="/devsupport"?<DevSupportApp/>:location.pathname==="/admin/players"?<AdminPlayersApp/>:location.pathname==="/admin/maintenance"?<MaintenanceAdminApp/>:location.pathname==="/gift-codes"?<GiftCodesApp/>:location.pathname==="/terms"?<LegalApp type="terms"/>:location.pathname==="/privacy"?<LegalApp type="privacy"/>:<AutoRedeemApp/>; function registerAppServiceWorker(){
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
  if(!path||path.startsWith("/api/")||path==="/push"||path==="/message"||path==="/developer"||path==="/dev"||path==="/devsupport"||path==="/admin/players"||path==="/admin/maintenance")return;
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

const privateWorkspacePaths=new Set(["/dev","/devsupport","/admin/players","/admin/maintenance","/push","/message","/gift-codes"]);
const isPrivateWorkspace=privateWorkspacePaths.has(location.pathname);
const showNotificationPrompt=["/","/auto","/manual","/redeem"].includes(location.pathname);
const showPublicSupport=!isPrivateWorkspace;
const maintenanceAdminAccess=location.pathname==="/admin/maintenance"||(location.pathname==="/profile"&&new URLSearchParams(location.search).get("returnTo")==="/admin/maintenance");
createRoot(document.getElementById("root")).render(<><React.Suspense fallback={<div role="status" aria-live="polite" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,minHeight:"45vh",padding:24,color:"#d4bd88",fontSize:13}}><LoaderCircle size={18}/> Loading workspace…</div>}>{maintenanceAdminAccess?publicPage:<MaintenanceGate>{isPrivateWorkspace?publicPage:<PublicAnnouncements>{publicPage}</PublicAnnouncements>}{!isPrivateWorkspace&&<InstallAppPrompt/>}{showNotificationPrompt&&<PushNotifications/>}{showPublicSupport&&<SupportWidget/>}</MaintenanceGate>}</React.Suspense><CopyToastHost/></>);