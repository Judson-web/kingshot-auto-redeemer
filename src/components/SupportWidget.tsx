import React,{useEffect,useState}from"react";
import "../support-chat-polish.css";
import "../support-centre-redesign.css";
import{MessageCircle,X,Send,LoaderCircle,CheckCircle2,LifeBuoy,ArrowLeft,RefreshCw,ShieldCheck,Headset,UserRound,LockKeyhole,Paperclip,Image as ImageIcon,ChevronDown,Check,BellRing}from"lucide-react";
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
 if(path==="/terms"||path==="/privacy")return{title:"Legal & privacy",topic:"Other",hint:"Mention the policy section you have a question about."};
 if(path==="/dev")return{title:"Admin workspace",topic:"Bug report",hint:"Describe the admin action and the error shown; never share credentials."};
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

async function syncSupportPush(c:Saved,createIfMissing:boolean){
 if(!("serviceWorker"in navigator)||!("PushManager"in window))throw Error("This browser does not support background notifications.");
 const registration=await navigator.serviceWorker.ready;
 let subscription=await registration.pushManager.getSubscription();
 if(!subscription&&createIfMissing){
  if(typeof Notification==="undefined")throw Error("Notifications are not supported by this browser.");
  let permission=Notification.permission;
  if(permission==="default")permission=await Notification.requestPermission();
  if(permission!=="granted")throw Error("Allow notifications in your browser settings to receive support replies.");
  const keyData=await request("/api/custom-message",{method:"POST",body:JSON.stringify({action:"PUSH_PUBLIC_KEY"})});
  const encoded=String(keyData.publicKey||"").replace(/-/g,"+").replace(/_/g,"/");
  const padded=encoded+"=".repeat((4-encoded.length%4)%4);
  const raw=atob(padded),applicationServerKey=Uint8Array.from(raw,ch=>ch.charCodeAt(0));
  subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey});
 }
 if(!subscription)return false;
 await request(API,{method:"POST",body:JSON.stringify({action:"support-push-subscribe",conversationId:c.conversationId,token:c.token,subscription:subscription.toJSON()})});
 return true;
}
function notificationPreview(message:Msg){
 const body=String(message?.body||"").replace(/\\s+/g," ").trim();
 if(body&&body.toLowerCase()!=="photo attachment")return body.length>160?body.slice(0,157).trimEnd()+"…":body;
 const name=String(message?.attachment_name||"").replace(/[\\r\\n]+/g," ").trim().slice(0,90);
 return name?"Photo attached: "+name:message?.attachment_url?"Support attached an image.":"Support sent a new reply.";
}
function notifyReply(c:Saved,message:Msg){
 if(typeof Notification==="undefined"||Notification.permission!=="granted")return;
 const subject=String(c.subject||"Support conversation").trim();
 const title=("Support replied · "+subject).slice(0,100);
 const ticket=String(c.supportTicketId||"").trim();
 const preview=notificationPreview(message);
 const body=(ticket?"Ticket "+ticket+" · ":"")+preview;
 const url="/?supportConversation="+encodeURIComponent(c.conversationId);
 const options:NotificationOptions & {image?:string;renotify?:boolean;timestamp?:number;actions?:Array<{action:string;title:string}>}={
  body:body.slice(0,220),
  icon:"/icons/icon-192.svg",
  badge:"/icons/icon-192.svg",
  tag:"support-reply-"+c.conversationId,
  renotify:true,
  timestamp:Date.parse(message?.created_at||"")||Date.now(),
  data:{url},
  actions:[{action:"open-support",title:"Open conversation"},{action:"dismiss",title:"Dismiss"}]
 };
 if(message?.attachment_url){try{const image=new URL(message.attachment_url);if(image.protocol==="https:"&&!image.username&&!image.password)options.image=image.href}catch{}}
 if("serviceWorker"in navigator){
  navigator.serviceWorker.getRegistration().then(reg=>{
   if(reg)void reg.showNotification(title,options).catch(()=>{});
   else new Notification(title,options);
  }).catch(()=>{});
 }else new Notification(title,options);
}
export default function SupportWidget({maintenanceMode=false}: {maintenanceMode?:boolean}){
 const[pushEnabled,setPushEnabled]=useState(false),[pushBusy,setPushBusy]=useState(false),[open,setOpen]=useState(false),[topicMenuOpen,setTopicMenuOpen]=useState(false),[playerId,setPlayerId]=useState(""),[subject,setSubject]=useState(""),[topic,setTopic]=useState(()=>getPageContext().topic),[pageContext,setPageContext]=useState<PageContext>(()=>getPageContext()),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[conversation,setConversation]=useState<Saved|null>(null),[messages,setMessages]=useState<Msg[]>([]),[unread,setUnread]=useState(0),[attachment,setAttachment]=useState<File|null>(null),[attachmentPreview,setAttachmentPreview]=useState(""),fileInput=React.useRef<HTMLInputElement>(null),messagesViewportRef=React.useRef<HTMLDivElement>(null),chatScrollStateRef=React.useRef({conversationId:"",count:0}),rootRef=React.useRef<HTMLDivElement>(null),triggerRef=React.useRef<HTMLButtonElement>(null),closeButtonRef=React.useRef<HTMLButtonElement>(null),panelRef=React.useRef<HTMLElement>(null),restoreFocusRef=React.useRef(false),supportReturnFocusRef=React.useRef<HTMLElement|null>(null),topicMenuRef=React.useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const current=saved();
  let shouldOpen=false;
  try{
   const url=new URL(window.location.href),requested=url.searchParams.get("supportConversation");
   if(current&&requested===current.conversationId){
    shouldOpen=true;
    url.searchParams.delete("supportConversation");
    window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);
   }
  }catch{}
  setConversation(current);
  if(shouldOpen)setOpen(true);
 },[]);
 useEffect(()=>{if(!open)return;const previous=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.body.style.overflow=previous}},[open]);
 useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(""),2800);return()=>window.clearTimeout(timer)},[notice]);
 useEffect(()=>{const openRemoval=(event:Event)=>{const detail=(event as CustomEvent<{playerId?:string}>).detail||{};setPageContext(getPageContext());setOpen(true);setConversation(null);setMessages([]);try{localStorage.removeItem(STORAGE)}catch{}setTopic("Registration removal");setSubject("Registration removal request");setPlayerId(String(detail.playerId||"").replace(/\D/g,"").slice(0,20));setMessage("");setAttachment(null);setAttachmentPreview("");setError("");setNotice("");setUnread(0)};const openGeneral=(event:Event)=>{const base=getPageContext(),detail=(event as CustomEvent<{topic?:string;subject?:string;pageTitle?:string;returnFocus?:HTMLElement}>).detail||{};supportReturnFocusRef.current=detail.returnFocus instanceof HTMLElement?detail.returnFocus:null;const next={...base,title:typeof detail.pageTitle==="string"?detail.pageTitle:base.title,topic:TOPICS.includes(String(detail.topic))?String(detail.topic):base.topic};setPageContext(next);setTopic(next.topic);if(typeof detail.subject==="string")setSubject(detail.subject.slice(0,120));setOpen(true);setError("");setNotice("")};window.addEventListener("ks-support-registration-removal",openRemoval);window.addEventListener("ks-support-open",openGeneral);return()=>{window.removeEventListener("ks-support-registration-removal",openRemoval);window.removeEventListener("ks-support-open",openGeneral)}},[]);
 useEffect(()=>{
  if(!open)return;
  const focusClose=window.setTimeout(()=>closeButtonRef.current?.focus(),0);
  const onKeyDown=(event:KeyboardEvent)=>{
   if(event.key==="Escape"){event.preventDefault();if(topicMenuOpen){setTopicMenuOpen(false);return}restoreFocusRef.current=true;setOpen(false);return}
   if(event.key!=="Tab")return;
   const panel=panelRef.current;if(!panel)return;
   const items=Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(el=>el.getClientRects().length>0);
   if(!items.length){event.preventDefault();return}
   const first=items[0],last=items[items.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  };
  const onPointerDown=(event:PointerEvent)=>{if(rootRef.current&&!rootRef.current.contains(event.target as Node)){restoreFocusRef.current=true;setOpen(false)}};
  document.addEventListener("keydown",onKeyDown);document.addEventListener("pointerdown",onPointerDown);
  return()=>{window.clearTimeout(focusClose);document.removeEventListener("keydown",onKeyDown);document.removeEventListener("pointerdown",onPointerDown);if(restoreFocusRef.current){restoreFocusRef.current=false;const target=supportReturnFocusRef.current||triggerRef.current;supportReturnFocusRef.current=null;window.setTimeout(()=>{if(target?.isConnected)target.focus()},0)}};
 },[open,topicMenuOpen]);
 useEffect(()=>{
  const viewport=messagesViewportRef.current;
  if(!open||!conversation||!viewport)return;
  const sameConversation=chatScrollStateRef.current.conversationId===conversation.conversationId;
  const wasNearBottom=viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight<120;
  if(!sameConversation||chatScrollStateRef.current.count===0||wasNearBottom){
   window.requestAnimationFrame(()=>{if(messagesViewportRef.current)messagesViewportRef.current.scrollTop=messagesViewportRef.current.scrollHeight});
  }
  chatScrollStateRef.current={conversationId:conversation.conversationId,count:messages.length};
 },[open,conversation?.conversationId,messages.length]);
 useEffect(()=>{
  if(!conversation){setPushEnabled(false);return}
  let live=true;
  void syncSupportPush(conversation,false).then(enabled=>{if(live)setPushEnabled(enabled)}).catch(()=>{if(live)setPushEnabled(false)});
  return()=>{live=false};
 },[conversation?.conversationId,conversation?.token]);
 async function enableReplyNotifications(){
  if(!conversation)return;
  setPushBusy(true);setError("");setNotice("");
  try{await syncSupportPush(conversation,true);setPushEnabled(true);setNotice("Notifications enabled for replies in this conversation.");}
  catch(e){setError(e instanceof Error?e.message:"Could not enable reply notifications.")}
  finally{setPushBusy(false)}
 }
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
      notifyReply(conversation,newest);saveId(notifiedKey,Number(newest.id));
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
   setMessages(v=>[...v,d.message].filter(Boolean));setMessage("");setAttachment(null);setAttachmentPreview("");setNotice("");setUnread(0);
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
   setConversation(c);setMessages(d.messages||[]);setMessage("");setAttachment(null);setAttachmentPreview("");setUnread(0);setNotice("");
  }
 }catch(e){setError(e instanceof Error?e.message:"Support is unavailable right now.")}finally{setBusy(false)}}
 function newConversation(){const next=getPageContext();setPageContext(next);setConversation(null);setMessages([]);setMessage("");setAttachment(null);if(attachmentPreview)URL.revokeObjectURL(attachmentPreview);setAttachmentPreview("");setSubject("");setTopic(next.topic);setPlayerId("");setError("");setNotice("");setUnread(0);if(fileInput.current)fileInput.current.value="";try{localStorage.removeItem(STORAGE)}catch{}}
 return <div className="support-float-root" ref={rootRef}>
  {!open&&!maintenanceMode&&<button ref={triggerRef} className="support-float-trigger" type="button" aria-label={"Open support chat"+(unread?" ("+unread+" unread replies)": "")} aria-expanded={false} onClick={()=>{const context=getPageContext();setPageContext(context);if(!conversation&&topic===pageContext.topic)setTopic(context.topic);setNotice("");setOpen(true)}}>
   <MessageCircle size={21}/>
   {unread>0&&<span className="support-unread-badge" aria-label={unread+" unread support replies"}>{unread>9?"9+":unread}</span>}
   <span className="support-float-trigger-label">Support</span>
  </button>}
  {open&&<><div className="support-float-backdrop" aria-hidden="true" onClick={event=>{if(event.target===event.currentTarget){restoreFocusRef.current=true;setOpen(false)}}}/><section ref={panelRef} className={"support-float-panel support-chat-panel "+(conversation?"support-chat-panel-thread"+(messages.length<=3?" support-chat-panel-thread-compact":""):"support-chat-panel-new")} role="dialog" aria-modal="true" aria-labelledby="support-dialog-title" aria-describedby="support-dialog-description">
   <header className="support-float-head"><span className="support-float-icon"><LifeBuoy size={18}/></span><div className="support-head-copy"><b id="support-dialog-title">{conversation?(conversation.subject||"Support conversation"):"Support centre"}</b><small id="support-dialog-description"><i className="support-live-dot" aria-hidden="true"/>{conversation?(conversation.supportTicketId?"REMOVAL · "+conversation.supportTicketId.slice(0,8).toUpperCase():"PRIVATE SUPPORT"):"PRIVATE SUPPORT"}</small></div><button ref={closeButtonRef} className="support-drawer-close" type="button" aria-label="Close support chat" title="Close support chat" onClick={()=>{restoreFocusRef.current=true;setOpen(false)}}><X size={17}/></button></header>
   {conversation&&<div className="support-chat-toolbar" role="group" aria-label="Conversation controls"><div className="support-chat-toolbar-status"><span className="support-thread-state"><i/>{messages.length&&messages[messages.length-1]?.sender==="admin"?"Support replied":"In progress"}</span><span className="support-chat-message-total">{messages.length} {messages.length===1?"message":"messages"}</span></div><div className="support-chat-toolbar-actions"><button type="button" disabled={refreshing} onClick={refresh} aria-label="Refresh conversation" title="Refresh conversation">{refreshing?<LoaderCircle size={17} className="support-float-spin"/>:<RefreshCw size={17}/>}</button>{!pushEnabled&&<button type="button" className="support-push-enable" disabled={pushBusy} onClick={enableReplyNotifications} aria-label="Enable reply notifications" title="Enable reply notifications">{pushBusy?<LoaderCircle size={17} className="support-float-spin"/>:<BellRing size={17}/>}</button>}{pushEnabled&&<span className="support-push-enabled" title="Reply notifications are enabled" aria-label="Reply notifications enabled"><BellRing size={16}/></span>}<button type="button" onClick={newConversation} aria-label="Start a new conversation" title="New conversation"><ArrowLeft size={17}/><span>New chat</span></button></div></div>}
   <div className={"support-float-body"+(conversation?" support-chat-active":"")}>
    

    {!conversation&&<div className="support-centre-intro"><span className="support-centre-kicker">NEW CONVERSATION</span><h2>How can we help?</h2><p>Choose a topic and describe what happened. Replies will stay in this conversation.</p><small>{pageContext.hint}</small></div>}
    {conversation&&<div className="support-chat-messages" ref={messagesViewportRef} role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions text" aria-atomic="false">{messages.map((m,index)=><React.Fragment key={m.id}>{(index===0||dayKey(messages[index-1].created_at)!==dayKey(m.created_at))&&<div className="support-chat-day"><span>{dayLabel(m.created_at)}</span></div>}<article className={"support-chat-message "+(m.sender==="admin"?"support-chat-from-admin":"support-chat-from-user")} aria-label={(m.sender==="admin"?"Message from support":"Your message")+", "+(safeDate(m.created_at)?.toLocaleString()||"date unavailable")}><div className="support-chat-author"><span className={"support-chat-avatar "+(m.sender==="admin"?"support-chat-avatar-staff":"support-chat-avatar-user")}>{m.sender==="admin"?<Headset size={13}/>:<UserRound size={13}/>}</span><b>{m.sender==="admin"?"Support team":"You"}</b>{m.sender==="admin"&&<span className="support-staff-badge"><ShieldCheck size={10}/> STAFF</span>}{m.sender==="user"&&<span className="support-user-badge">YOU</span>}</div><p>{m.body}</p>{m.attachment_url&&<a className="support-chat-attachment" href={m.attachment_url} target="_blank" rel="noreferrer"><img src={m.attachment_url} alt={m.attachment_name||"Attached image"} loading="lazy"/><span><ImageIcon size={12}/>{m.attachment_name||"Attached image"} <small>View full image ↗</small></span></a>}<time dateTime={m.created_at} title={safeDate(m.created_at)?.toLocaleString()||"Date unavailable"}>{timeLabel(m.created_at)}</time></article></React.Fragment>)}{!messages.length&&<p className="support-chat-empty">Your conversation is ready. Send a message to get started.</p>}</div>}
    <form onSubmit={submit}>
     {!conversation&&<><div className="support-topic-field"><span className="support-topic-label" id="support-topic-label">TOPIC</span><div className="support-topic-picker" ref={topicMenuRef}><button type="button" className={"support-topic-trigger"+(topicMenuOpen?" is-expanded":"")} aria-label={"Request category: " + topic} aria-haspopup="listbox" aria-expanded={topicMenuOpen} aria-controls="support-topic-options" onKeyDown={e=>{if(["ArrowDown","ArrowUp","Enter"," "].includes(e.key)){e.preventDefault();setTopicMenuOpen(true);window.setTimeout(()=>topicMenuRef.current?.querySelector<HTMLButtonElement>("[role=option][aria-selected=true]")?.focus(),0)}}} onClick={e=>{e.preventDefault();e.stopPropagation();setTopicMenuOpen(v=>!v)}}><span className="support-topic-selected"><small id="support-topic-selected-label">REQUEST CATEGORY</small><b id="support-topic-selected-value">{topic}</b></span><ChevronDown size={17} aria-hidden="true"/></button>{topicMenuOpen&&<div id="support-topic-options" className="support-topic-menu" role="listbox" aria-label="Support topic" tabIndex={-1} onKeyDown={e=>{if(["ArrowDown","ArrowUp","Home","End","Escape"].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==="Escape"){setTopicMenuOpen(false);topicMenuRef.current?.querySelector<HTMLButtonElement>(".support-topic-trigger")?.focus();return}const options=Array.from(topicMenuRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]")||[]);if(!options.length)return;const current=options.indexOf(document.activeElement as HTMLButtonElement);const next=e.key==="Home"?0:e.key==="End"?options.length-1:e.key==="ArrowDown"?(current+1+options.length)%options.length:(current-1+options.length)%options.length;options[next]?.focus()}}}>{TOPICS.map((value,index)=><button key={value} type="button" role="option" tabIndex={topic===value?0:-1} aria-selected={topic===value} className={"support-topic-option"+(topic===value?" is-selected":"")} onClick={e=>{e.preventDefault();e.stopPropagation();setTopic(value);setTopicMenuOpen(false);topicMenuRef.current?.querySelector<HTMLButtonElement>(".support-topic-trigger")?.focus()}}><span className="support-topic-option-icon">{["◎","↗","✦","◉","⌘","⚑","…"][index]}</span><span><b>{value}</b><small>{["Registration and account access","Remove an existing player registration","Code errors and redemption results","Discord sign-in and profile issues","API keys, requests and integration","Unexpected behaviour or broken features","Anything else we should know"][index]}</small></span>{topic===value&&<Check size={17} aria-hidden="true"/>}</button>)}</div>}</div></div>{topic==="Registration removal"&&<label htmlFor="support-player-id">PLAYER ID <span>(required)</span><input id="support-player-id" inputMode="numeric" required={topic==="Registration removal"} value={playerId} onChange={e=>setPlayerId(e.target.value.replace(/\D/g,"").slice(0,20))} placeholder={topic==="Registration removal"?"Enrolled Player ID":"Digits only"} maxLength={20}/>{topic==="Registration removal"&&<small className="support-removal-hint">This creates a review ticket. It does not remove the registration immediately.</small>}</label>}</>}
     <div className={"support-message-field"+(conversation?" is-chat":"")}><label className="support-message-label" htmlFor="support-message-input">{conversation?"YOUR MESSAGE":topic==="Registration removal"?"REASON FOR REMOVAL":"MESSAGE"}</label><div className="support-composer"><textarea id="support-message-input" value={message} onChange={e=>setMessage(e.target.value.slice(0,3000))} placeholder={topic==="Registration removal"&&!conversation?"Explain why this registration should be removed…":"Write your message…"} required={!attachment} minLength={!conversation&&topic==="Registration removal"?5:conversation?1:3} maxLength={3000} rows={conversation?3:4} aria-label={conversation?"Your message":topic==="Registration removal"?"Reason for removal":"Message"}/><div className="support-composer-toolbar"><input ref={fileInput} type="file" className="support-file-input" tabIndex={-1} aria-hidden="true" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Attach an image" onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>2*1024*1024){setError("Images must be 2 MB or smaller.");e.currentTarget.value="";return}if(attachmentPreview)URL.revokeObjectURL(attachmentPreview);setAttachment(f);setAttachmentPreview(URL.createObjectURL(f));setError("");setNotice("")}}/><button className="support-attach-button" type="button" onClick={()=>fileInput.current?.click()} disabled={busy} aria-label="Attach photo" title="Attach photo"><Paperclip size={17}/></button><span className="support-composer-hint">{attachment?"Photo attached":"Attach a photo · JPG, PNG, WebP or GIF · 2 MB max"}</span><span className="support-message-count" aria-live="polite">{message.length}/3000</span><button className="support-composer-send" type="submit" disabled={busy||(!message.trim()&&!attachment)||(!conversation&&!!message.trim()&&message.trim().length<3)} aria-label={busy?"Sending":conversation?"Send reply":topic==="Registration removal"?"Submit removal request":"Create support ticket"} title={conversation?"Send reply":"Send message"}>{busy?<LoaderCircle size={17} className="support-float-spin"/>:<Send size={17}/>}</button></div></div></div>{attachmentPreview&&<div className="support-attachment-preview"><img src={attachmentPreview} alt="Selected attachment preview"/><span>{attachment?.name}</span><button type="button" onClick={()=>{setAttachment(null);if(attachmentPreview)URL.revokeObjectURL(attachmentPreview);setAttachmentPreview("");if(fileInput.current)fileInput.current.value=""}}>Remove</button></div>}
     {error&&<div className="support-float-error" role="alert" aria-live="assertive">{error}</div>}{notice&&<div className="support-chat-notice" role="status" aria-live="polite"><CheckCircle2 size={14}/>{notice}</div>}

    </form>
   </div>
   <footer className="support-float-foot"><ShieldCheck size={13}/><span>Saved on this device. Never share passwords or sign-in codes.</span></footer>
  </section></>}
 </div>
}
