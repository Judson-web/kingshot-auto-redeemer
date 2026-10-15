import React,{useEffect,useState}from"react";
import{MessageCircle,X,Send,LoaderCircle,CheckCircle2,LifeBuoy,ArrowLeft,RefreshCw,ShieldCheck,Headset,UserRound,LockKeyhole,Paperclip,Image as ImageIcon}from"lucide-react";
const API="/api/kingshot-support-chat",STORAGE="ks-support-chat-v1",SEEN_PREFIX="ks-support-seen-v1:",NOTIFIED_PREFIX="ks-support-notified-v1:";
type Saved={conversationId:string;token:string;subject:string;supportTicketId?:string};
type Msg={id:number;sender:"user"|"admin";body:string;created_at:string;attachment_url?:string|null;attachment_name?:string|null;attachment_type?:string|null};
async function request(url:string,init:RequestInit={}){const r=await fetch(url,{...init,credentials:"same-origin",cache:"no-store",signal:init.signal||AbortSignal.timeout(12000),headers:{"content-type":"application/json",...(init.headers as Record<string,string>|undefined||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Could not contact support.");return d}
function saved():Saved|null{try{const x=JSON.parse(localStorage.getItem(STORAGE)||"null");return x&&typeof x.conversationId==="string"&&typeof x.token==="string"?x:null}catch{return null}}

type PageContext={title:string;topic:string;hint:string};
function getPageContext():PageContext{
 const path=typeof window==="undefined"?"/":window.location.pathname;
 if(path==="/developer")return{title:"Developer API",topic:"Developer API",hint:"Include the endpoint, request ID, and response status if relevant."};
 if(path==="/profile")return{title:"Profile & sign-in",topic:"Discord / profile login",hint:"Never include passwords, tokens, or sign-in codes."};
 if(path==="/manual"||path==="/redeem")return{title:"Manual redemption",topic:"Gift code redemption",hint:"Include the gift code and the exact result shown."};
 if(path==="/gift-codes")return{title:"Gift codes",topic:"Gift code redemption",hint:"Mention which code or listing looks incorrect."};
 if(path==="/auto"||path==="/")return{title:"Auto Redeem",topic:"Gift code redemption",hint:"Tell us which player or redemption step needs attention."};
 if(path==="/message")return{title:"Custom messages",topic:"Bug report",hint:"Describe the message workflow and what went wrong."};
 if(path==="/push")return{title:"Notifications",topic:"Bug report",hint:"Mention your device, browser, and notification behaviour."};
 if(path==="/info")return{title:"How it works",topic:"Other",hint:"Tell us which explanation or step needs clarification."};
 return{title:"Kingshot Redeemer",topic:"Account & registration",hint:"Share the steps to reproduce the issue, without secrets."};
}
const TOPICS=["Account & registration","Registration removal","Gift code redemption","Discord / profile login","Developer API","Bug report","Other"];

function maxAdminId(messages:Msg[]){return messages.reduce((max,m)=>m.sender==="admin"?Math.max(max,Number(m.id)||0):max,0)}
function storedId(key:string){try{const n=Number(localStorage.getItem(key));return Number.isFinite(n)&&n>0?n:0}catch{return 0}}
function saveId(key:string,id:number){try{localStorage.setItem(key,String(Math.max(0,id)))}catch{}}
function safeDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?null:date}
function dayKey(value:string){const date=safeDate(value);return date?date.toLocaleDateString():"unknown"}
function dayLabel(value:string){const date=safeDate(value);if(!date)return "Date unavailable";const today=new Date();if(date.toDateString()===today.toDateString())return "Today";const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);if(date.toDateString()===yesterday.toDateString())return "Yesterday";return date.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:date.getFullYear()===today.getFullYear()?undefined:"numeric"})}
function timeLabel(value:string){const date=safeDate(value);return date?date.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}):"Time unavailable"}

function notifyReply(c:Saved){if(typeof Notification==="undefined"||Notification.permission!=="granted")return;const options={body:"You have a new reply in your support conversation.",tag:"support-reply-"+c.conversationId,data:{url:"/"}};if("serviceWorker"in navigator){navigator.serviceWorker.getRegistration().then(reg=>{if(reg)reg.showNotification("Kingshot support replied",options);else new Notification("Kingshot support replied",options)}).catch(()=>{})}else new Notification("Kingshot support replied",options)}
export default function SupportWidget(){
 const[open,setOpen]=useState(false),[playerId,setPlayerId]=useState(""),[subject,setSubject]=useState(""),[topic,setTopic]=useState(()=>getPageContext().topic),[pageContext,setPageContext]=useState<PageContext>(()=>getPageContext()),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[conversation,setConversation]=useState<Saved|null>(null),[messages,setMessages]=useState<Msg[]>([]),[unread,setUnread]=useState(0),[attachment,setAttachment]=useState<File|null>(null),[attachmentPreview,setAttachmentPreview]=useState(""),fileInput=React.useRef<HTMLInputElement>(null),rootRef=React.useRef<HTMLDivElement>(null),triggerRef=React.useRef<HTMLButtonElement>(null),closeButtonRef=React.useRef<HTMLButtonElement>(null),panelRef=React.useRef<HTMLElement>(null);
 useEffect(()=>{setConversation(saved())},[]);
 useEffect(()=>{const openRemoval=(event:Event)=>{const detail=(event as CustomEvent<{playerId?:string}>).detail||{};setPageContext(getPageContext());setOpen(true);setConversation(null);setMessages([]);try{localStorage.removeItem(STORAGE)}catch{}setTopic("Registration removal");setSubject("Registration removal request");setPlayerId(String(detail.playerId||"").replace(/\D/g,"").slice(0,20));setMessage("");setAttachment(null);setAttachmentPreview("");setError("");setNotice("");setUnread(0)};const openGeneral=(event:Event)=>{const base=getPageContext(),detail=(event as CustomEvent<{topic?:string;subject?:string;pageTitle?:string}>).detail||{},next={...base,title:typeof detail.pageTitle==="string"?detail.pageTitle:base.title,topic:TOPICS.includes(String(detail.topic))?String(detail.topic):base.topic};setPageContext(next);setTopic(next.topic);if(typeof detail.subject==="string")setSubject(detail.subject.slice(0,120));setOpen(true);setError("");setNotice("")};window.addEventListener("ks-support-registration-removal",openRemoval);window.addEventListener("ks-support-open",openGeneral);return()=>{window.removeEventListener("ks-support-registration-removal",openRemoval);window.removeEventListener("ks-support-open",openGeneral)}},[]);
 useEffect(()=>{
  if(!open)return;
  const focusClose=window.setTimeout(()=>closeButtonRef.current?.focus(),0);
  const onKeyDown=(event:KeyboardEvent)=>{
   if(event.key==="Escape"){event.preventDefault();setOpen(false);return}
   if(event.key!=="Tab")return;
   const panel=panelRef.current;if(!panel)return;
   const items=Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(el=>el.offsetParent!==null);
   if(!items.length){event.preventDefault();return}
   const first=items[0],last=items[items.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  };
  const onPointerDown=(event:PointerEvent)=>{if(rootRef.current&&!rootRef.current.contains(event.target as Node))setOpen(false)};
  document.addEventListener("keydown",onKeyDown);document.addEventListener("pointerdown",onPointerDown);
  return()=>{window.clearTimeout(focusClose);document.removeEventListener("keydown",onKeyDown);document.removeEventListener("pointerdown",onPointerDown);window.setTimeout(()=>triggerRef.current?.focus(),0)};
 },[open]);
 useEffect(()=>{
  if(!conversation)return;
  let live=true,busyPoll=false;
  const poll=async()=>{
   if(busyPoll)return;busyPoll=true;
   try{
    const d=await request(API+"?conversationId="+encodeURIComponent(conversation.conversationId)+"&token="+encodeURIComponent(conversation.token));
    if(!live)return;
    const next=(Array.isArray(d.messages)?d.messages:[]) as Msg[],latest=maxAdminId(next),seenKey=SEEN_PREFIX+conversation.conversationId,notifiedKey=NOTIFIED_PREFIX+conversation.conversationId;
    let seen=storedId(seenKey);
    try{if(localStorage.getItem(seenKey)===null){seen=latest;saveId(seenKey,seen)}}catch{}
    if(open){seen=latest;saveId(seenKey,seen);saveId(notifiedKey,latest);setUnread(0)}
    else{
     const count=next.filter(m=>m.sender==="admin"&&Number(m.id)>seen).length;
     setUnread(count);
     const lastNotified=storedId(notifiedKey),newest=next.filter(m=>m.sender==="admin").reduce<Msg|null>((a,m)=>!a||m.id>a.id?m:a,null);
     if(newest&&Number(newest.id)>seen&&Number(newest.id)>lastNotified&&typeof Notification!=="undefined"&&Notification.permission==="granted"){
      notifyReply(conversation);saveId(notifiedKey,Number(newest.id));
     }
    }
    setMessages(next);setError("");
   }catch(e){if(live&&open)setError(e instanceof Error?e.message:"Could not load your conversation.")}
   finally{busyPoll=false;if(live)setRefreshing(false)}
  };
  void poll();const timer=window.setInterval(poll,open?12000:30000);
  return()=>{live=false;window.clearInterval(timer)};
 },[conversation?.conversationId,conversation?.token,open]);
 async function refresh(){if(!conversation)return;setRefreshing(true);try{const d=await request(API+"?conversationId="+encodeURIComponent(conversation.conversationId)+"&token="+encodeURIComponent(conversation.token));const next=(Array.isArray(d.messages)?d.messages:[]) as Msg[];setMessages(next);if(open){const latest=maxAdminId(next);saveId(SEEN_PREFIX+conversation.conversationId,latest);saveId(NOTIFIED_PREFIX+conversation.conversationId,latest);setUnread(0)}setError("");setNotice("")}catch(e){setError(e instanceof Error?e.message:"Could not load your conversation.")}finally{setRefreshing(false)}}
 async function submit(e:React.FormEvent){e.preventDefault();if(!message.trim()&&!attachment){setError("Write a message or attach a photo.");return}setBusy(true);setError("");setNotice("");try{
  let image:string|undefined;if(attachment)image=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>reject(Error("Could not read image."));reader.readAsDataURL(attachment)});
  if(conversation){
   const d=await request(API,{method:"POST",body:JSON.stringify({action:"message",conversationId:conversation.conversationId,token:conversation.token,message,attachment:image,attachmentName:attachment?.name})});
   setMessages(v=>[...v,d.message].filter(Boolean));setMessage("");setAttachment(null);setAttachmentPreview("");setNotice("Message sent.");setUnread(0);
  }else{
   let ticketId:string|undefined;
   if(topic==="Registration removal"){
    if(!/^[0-9]{5,20}$/.test(playerId))throw Error("Enter the enrolled Player ID (5–20 digits) for this removal request.");
    if(message.trim().length<5)throw Error("Please explain why this registration should be removed (at least 5 characters).");
    const ticketResponse=await request("/api/kingshot-support",{method:"POST",body:JSON.stringify({playerId,reason:message.trim()})});ticketId=String(ticketResponse.ticket?.id||"");if(!ticketId)throw Error("The removal request could not be confirmed. Please retry.");
   }
   let d;
   try{d=await request(API,{method:"POST",body:JSON.stringify({action:"start",playerId,subject:(subject.trim()||topic).slice(0,120),message,attachment:image,attachmentName:attachment?.name,supportTicketId:ticketId})})}
   catch(err){if(ticketId){setNotice("Your removal request was recorded as ticket "+ticketId+". The chat thread could not be opened, but the request is safely queued for review.");throw Error("Removal request saved; chat setup failed. Your request remains queued for review.")}throw err}
   const c={conversationId:d.conversation.id,token:d.token,subject:d.conversation.subject,supportTicketId:d.conversation.support_ticket_id||ticketId};
   localStorage.setItem(STORAGE,JSON.stringify(c));saveId(SEEN_PREFIX+c.conversationId,maxAdminId(d.messages||[]));saveId(NOTIFIED_PREFIX+c.conversationId,maxAdminId(d.messages||[]));
   setConversation(c);setMessages(d.messages||[]);setMessage("");setAttachment(null);setAttachmentPreview("");setUnread(0);setNotice("Conversation created. Replies will appear here, with an unread badge when you return.");
  }
 }catch(e){setError(e instanceof Error?e.message:"Support is unavailable right now.")}finally{setBusy(false)}}
 function newConversation(){const next=getPageContext();setPageContext(next);setConversation(null);setMessages([]);setMessage("");setAttachment(null);if(attachmentPreview)URL.revokeObjectURL(attachmentPreview);setAttachmentPreview("");setSubject("");setTopic(next.topic);setPlayerId("");setError("");setNotice("");setUnread(0);if(fileInput.current)fileInput.current.value="";try{localStorage.removeItem(STORAGE)}catch{}}
 return <div className="support-float-root" ref={rootRef}>
  <button ref={triggerRef} className={"support-float-trigger "+(open?"is-open":"")} type="button" aria-label={open?"Close support":"Open support chat"+(unread?" ("+unread+" unread replies)": "")} aria-expanded={open} onClick={()=>{setOpen(v=>!v);if(!open)setNotice("")}}>
   {open?<X size={20}/>:<MessageCircle size={21}/>}
   {!open&&unread>0&&<span className="support-unread-badge" aria-label={unread+" unread support replies"}>{unread>9?"9+":unread}</span>}
   <span className="support-float-ping"/><span className="support-float-trigger-label">{open?"Close":"Support"}</span>
  </button>
  {open&&<section ref={panelRef} className="support-float-panel support-chat-panel" role="dialog" aria-modal="true" aria-label="Kingshot support chat">
   <header className="support-float-head"><span className="support-float-icon"><LifeBuoy size={18}/></span><div className="support-head-copy"><b>{conversation?(conversation.subject||"Support conversation"):"Support centre"}</b><small><i className="support-live-dot"/>{conversation?(conversation.supportTicketId?"REMOVAL REQUEST · TICKET "+conversation.supportTicketId.slice(0,8).toUpperCase():"PRIVATE TICKET · REPLIES IN THIS THREAD"):"PRIVATE HELP · PRIVATE REPLIES"}</small></div><button ref={closeButtonRef} className="support-drawer-close" type="button" aria-label="Close support chat" title="Close support chat" onClick={()=>setOpen(false)}><X size={17}/></button></header>
   {conversation&&<div className="support-chat-toolbar"><span><MessageCircle size={13}/> {messages.length} messages</span><span className="support-thread-state"><i/> {messages.length&&messages[messages.length-1]?.sender==="admin"?"Support replied":"In progress"}</span><button type="button" disabled={refreshing} onClick={refresh}>{refreshing?<LoaderCircle size={12} className="support-float-spin"/>:<RefreshCw size={12}/>} Refresh</button><button type="button" onClick={newConversation}><ArrowLeft size={13}/> New chat</button></div>}
   <div className="support-float-body">
    <div className="support-context-strip"><span className="support-context-mark"><MessageCircle size={13}/></span><span><b>{pageContext.title}</b><small>{conversation?"Current page · your existing private thread is preserved":pageContext.hint}</small></span><button type="button" onClick={()=>{const next=getPageContext();setPageContext(next);if(!conversation)setTopic(next.topic)}} aria-label="Refresh page context" title="Refresh page context"><RefreshCw size={12}/></button></div>
    {!conversation&&<><div className="support-form-section"><span className="support-form-step">01</span><div><b>What do you need help with?</b><small>Choose a topic so we can route your request.</small></div></div></>}
    {conversation&&<div className="support-chat-messages">{messages.map((m,index)=><React.Fragment key={m.id}>{(index===0||dayKey(messages[index-1].created_at)!==dayKey(m.created_at))&&<div className="support-chat-day"><span>{dayLabel(m.created_at)}</span></div>}<article className={"support-chat-message "+(m.sender==="admin"?"support-chat-from-admin":"support-chat-from-user")} aria-label={(m.sender==="admin"?"Message from support":"Your message")+", "+(safeDate(m.created_at)?.toLocaleString()||"date unavailable")}><div className="support-chat-author"><span className={"support-chat-avatar "+(m.sender==="admin"?"support-chat-avatar-staff":"support-chat-avatar-user")}>{m.sender==="admin"?<Headset size={13}/>:<UserRound size={13}/>}</span><b>{m.sender==="admin"?"Support team":"You"}</b>{m.sender==="admin"&&<span className="support-staff-badge"><ShieldCheck size={10}/> STAFF</span>}{m.sender==="user"&&<span className="support-user-badge">YOU</span>}</div><p>{m.body}</p>{m.attachment_url&&<a className="support-chat-attachment" href={m.attachment_url} target="_blank" rel="noreferrer"><img src={m.attachment_url} alt={m.attachment_name||"Attached image"} loading="lazy"/><span><ImageIcon size={12}/>{m.attachment_name||"Attached image"} <small>View full image ↗</small></span></a>}<time dateTime={m.created_at} title={safeDate(m.created_at)?.toLocaleString()||"Date unavailable"}>{timeLabel(m.created_at)}</time></article></React.Fragment>)}{!messages.length&&<p className="support-chat-empty">Your conversation is ready. Send a message to get started.</p>}</div>}
    <form onSubmit={submit}>
     {!conversation&&<><label>TOPIC<select value={topic} onChange={e=>setTopic(e.target.value)}>{TOPICS.map(value=><option key={value}>{value}</option>)}</select></label><label>SUBJECT <span>(optional)</span><input value={subject} onChange={e=>setSubject(e.target.value.slice(0,120))} placeholder="One-line summary" maxLength={120}/></label><label>PLAYER ID <span>{topic==="Registration removal"?"(required)":"(optional)"}</span><input inputMode="numeric" required={topic==="Registration removal"} value={playerId} onChange={e=>setPlayerId(e.target.value.replace(/\D/g,"").slice(0,20))} placeholder={topic==="Registration removal"?"Enrolled Player ID":"Digits only"} maxLength={20}/>{topic==="Registration removal"&&<small className="support-removal-hint">This creates a review ticket. It does not remove the registration immediately.</small>}</label><div className="support-form-section"><span className="support-form-step">02</span><div><b>Describe the issue</b><small>Include what happened and what you expected.</small></div></div></>}
     <label className="support-message-label">{conversation?"YOUR MESSAGE":topic==="Registration removal"?"REASON FOR REMOVAL":"MESSAGE"}<div className="support-composer"><textarea value={message} onChange={e=>setMessage(e.target.value.slice(0,3000))} placeholder={topic==="Registration removal"&&!conversation?"Explain why this registration should be removed…":"Write your message…"} required={!attachment} minLength={!conversation&&topic==="Registration removal"?5:conversation?1:3} maxLength={3000} rows={conversation?3:4} aria-label={conversation?"Your message":topic==="Registration removal"?"Reason for removal":"Message"}/><div className="support-composer-toolbar"><input ref={fileInput} type="file" className="support-file-input" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Attach an image" onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>2*1024*1024){setError("Images must be 2 MB or smaller.");e.currentTarget.value="";return}if(attachmentPreview)URL.revokeObjectURL(attachmentPreview);setAttachment(f);setAttachmentPreview(URL.createObjectURL(f));setError("");setNotice("")}}/><button className="support-attach-button" type="button" onClick={()=>fileInput.current?.click()} disabled={busy} aria-label="Attach photo" title="Attach photo"><Paperclip size={17}/></button><span className="support-composer-hint">{attachment?"Photo attached":"Attach a photo · JPG, PNG, WebP or GIF · 2 MB max"}</span><span className="support-message-count" aria-live="polite">{message.length}/3000</span></div></div></label>{attachmentPreview&&<div className="support-attachment-preview"><img src={attachmentPreview} alt="Selected attachment preview"/><span>{attachment?.name}</span><button type="button" onClick={()=>{setAttachment(null);if(attachmentPreview)URL.revokeObjectURL(attachmentPreview);setAttachmentPreview("");if(fileInput.current)fileInput.current.value=""}}>Remove</button></div>}
     {error&&<div className="support-float-error" role="alert">{error}</div>}{notice&&<div className="support-chat-notice" role="status"><CheckCircle2 size={14}/>{notice}</div>}
     <button className="support-float-submit" type="submit" disabled={busy||(!message.trim()&&!attachment)||(!conversation&&!!message.trim()&&message.trim().length<3)}>{busy?<LoaderCircle size={16} className="support-float-spin"/>:<Send size={15}/>} {busy?"Sending…":conversation?"Send reply":topic==="Registration removal"?"Submit removal request":"Create support ticket"} <span>↗</span></button>
    </form>
   </div>
   <footer className="support-float-foot"><ShieldCheck size={13}/><span>Private to this device. Never share sign-in codes.</span></footer>
  </section>}
 </div>
}
