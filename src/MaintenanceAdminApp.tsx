import React,{useCallback,useEffect,useState}from"react";
import{ArrowLeft,CheckCircle2,Clock3,LoaderCircle,LockKeyhole,RefreshCw,ShieldCheck,Wrench,Power,AlertTriangle}from"lucide-react";
import"./maintenance-admin.css";

type MaintenanceState={maintenance_enabled:boolean;maintenance_message:string;ends_at:string|null;updated_at:string|null};
const API="/api/kingshot-admin-data";
async function request(init:RequestInit={}){
 const response=await fetch(API+"?maintenanceOnly=1",{...init,credentials:"same-origin",cache:"no-store",headers:{"content-type":"application/json",...(init.headers as Record<string,string>|undefined||{})}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){const error=new Error(String(data.error||"Could not load maintenance controls."));(error as Error&{status?:number}).status=response.status;throw error}
 return data;
}
const date=(value:string|null|undefined)=>{if(!value)return"Not scheduled";const parsed=new Date(value);return Number.isNaN(parsed.getTime())?"Not scheduled":parsed.toLocaleString([], {dateStyle:"medium",timeStyle:"short"})};
export default function MaintenanceAdminApp(){
 const[state,setState]=useState<MaintenanceState|null>(null),[message,setMessage]=useState(""),[endsAt,setEndsAt]=useState(""),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[authRequired,setAuthRequired]=useState(false),[denied,setDenied]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const load=useCallback(async()=>{
  setLoading(true);setError("");setAuthRequired(false);setDenied(false);
  try{const data=await request();const next=data.maintenance as MaintenanceState|null;if(!next||typeof next.maintenance_enabled!=="boolean")throw Error("The server returned an invalid maintenance state.");setState(next);setMessage(next.maintenance_message||"");setEndsAt(next.ends_at?(()=>{const d=new Date(next.ends_at);return Number.isNaN(d.getTime())?"":new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)})():"");}
  catch(e){const status=(e as Error&{status?:number}).status;if(status===401)setAuthRequired(true);else if(status===403)setDenied(true);else setError(e instanceof Error?e.message:"Could not load maintenance controls.");}
  finally{setLoading(false)}
 },[]);
 useEffect(()=>{void load()},[load]);
 async function save(enabled:boolean){
  if(saving)return;
  const cleanMessage=message.trim();
  if(enabled&&endsAt){const end=new Date(endsAt);if(Number.isNaN(end.getTime())||end.getTime()<=Date.now()){setError("Choose a future end time, or leave it empty for indefinite maintenance.");return}}
  setSaving(true);setError("");setNotice("");
  try{
   const data=await request({method:"POST",body:JSON.stringify({action:"SET_MAINTENANCE",enabled,message:cleanMessage,endsAt:enabled&&endsAt?new Date(endsAt).toISOString():null})});
   const next=data.maintenance as MaintenanceState;
   setState(next);setMessage(next.maintenance_message||"");setEndsAt(next.ends_at?(()=>{const d=new Date(next.ends_at);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)})():"");
   setNotice(enabled?"Maintenance mode is now enabled. The public site will show the maintenance screen.":"Maintenance mode is disabled. The public site is available again.");
  }catch(e){const status=(e as Error&{status?:number}).status;if(status===401)setAuthRequired(true);else if(status===403)setDenied(true);else setError(e instanceof Error?e.message:"Could not save maintenance settings.");}
  finally{setSaving(false)}
 }
 return <main className="maintenance-admin-page"><div className="ma-shell">
  <header className="ma-header"><a className="ma-back" href="/profile" aria-label="Back to profile"><ArrowLeft size={17}/></a><div className="ma-brand-mark"><Wrench size={19}/></div><div className="ma-title"><small>ADMINISTRATION · SERVICE CONTROLS</small><h1>Maintenance mode</h1><p>A dedicated control room that remains available when the public site is in maintenance.</p></div><button type="button" className="ma-refresh" onClick={()=>void load()} disabled={loading||saving} aria-label="Refresh maintenance status"><RefreshCw size={15}/></button></header>
  {loading?<section className="ma-panel ma-loading"><LoaderCircle className="ma-spin" size={22}/><b>Verifying administrator access</b><span>Loading live maintenance settings securely…</span></section>:authRequired?<section className="ma-panel ma-access"><span className="ma-access-icon"><LockKeyhole size={22}/></span><span className="ma-eyebrow">ADMIN SIGN-IN REQUIRED</span><h2>Sign in to control maintenance</h2><p>This page is separate from the public maintenance gate. Only the configured administrator account can view or change the service state.</p><a className="ma-primary" href="/profile?returnTo=%2Fadmin%2Fmaintenance">Sign in with Discord <ArrowLeft size={15}/></a><a className="ma-secondary-link" href="/">Return to public status</a></section>:denied?<section className="ma-panel ma-access"><span className="ma-access-icon ma-danger"><ShieldCheck size={22}/></span><span className="ma-eyebrow">ACCESS DENIED</span><h2>Administrator access only</h2><p>This Discord account is not authorized to manage maintenance mode. No settings were changed.</p><a className="ma-secondary-link" href="/profile">Switch account</a></section>:<>
   {error&&<div className="ma-alert ma-alert-error" role="alert"><AlertTriangle size={15}/><span>{error}</span></div>}
   {notice&&<div className="ma-alert ma-alert-ok" role="status"><CheckCircle2 size={15}/><span>{notice}</span></div>}
   <section className={"ma-status "+(state?.maintenance_enabled?"is-active":"is-online")} aria-live="polite"><div className="ma-status-icon">{state?.maintenance_enabled?<Wrench size={22}/>:<CheckCircle2 size={22}/>}</div><div className="ma-status-copy"><span className="ma-eyebrow">LIVE PRODUCTION STATE</span><h2>{state?.maintenance_enabled?"Maintenance is active":"Public site is online"}</h2><p>{state?.maintenance_enabled?"Visitors are seeing the maintenance screen. This admin page remains accessible.":"Maintenance is disabled. The public site can load normally."}</p></div><span className="ma-state-pill"><i/>{state?.maintenance_enabled?"MAINTENANCE":"ONLINE"}</span></section>
   <section className="ma-panel"><div className="ma-panel-head"><div><span className="ma-eyebrow">MAINTENANCE CONFIGURATION</span><h2>Control the public site</h2></div><span className="ma-lock"><ShieldCheck size={13}/> Server-authorized</span></div>
    <label className="ma-field"><span>Visitor message</span><textarea value={message} onChange={e=>setMessage(e.target.value)} maxLength={500} rows={4} placeholder="Explain why the site is temporarily unavailable."/><small>{message.length}/500 characters · Shown on the public maintenance screen</small></label>
    <label className="ma-field"><span>Automatic end time <em>Optional</em></span><input type="datetime-local" value={endsAt} onChange={e=>setEndsAt(e.target.value)}/><small>Leave blank to keep maintenance active until an administrator disables it. The app automatically restores the site when this time passes.</small></label>
    <div className="ma-current-grid"><div><small>LAST UPDATED</small><b>{date(state?.updated_at)}</b></div><div><small>ESTIMATED RETURN</small><b>{state?.maintenance_enabled?date(state.ends_at):"Not applicable"}</b></div></div>
    <div className="ma-actions"><button type="button" className="ma-secondary" onClick={()=>void load()} disabled={saving||loading}><RefreshCw size={14}/> Reload settings</button>{state?.maintenance_enabled?<button type="button" className="ma-danger-button" onClick={()=>void save(false)} disabled={saving}><Power size={15}/>{saving?"Saving…":"Disable maintenance"}</button>:<button type="button" className="ma-primary" onClick={()=>void save(true)} disabled={saving}><Wrench size={15}/>{saving?"Enabling…":"Enable maintenance"}</button>}</div>
   </section>
   <section className="ma-safety-note"><ShieldCheck size={16}/><p><b>Protected control path</b><span>Every read and change is checked by the server against the authorized Discord administrator session. The public maintenance page cannot be used to change these settings.</span></p></section>
  </>}
  <footer className="ma-footer"><a href="/profile">Profile</a><span>·</span><a href="/admin/players">Player administration</a><span>·</span><a href="/">Public site</a></footer>
 </div></main>
}
