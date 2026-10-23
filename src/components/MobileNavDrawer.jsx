import React,{useEffect,useRef} from "react";
import {Activity,ArrowRight,Gift,Info,LifeBuoy,ShieldCheck,UserRound,X} from "lucide-react";

export default function MobileNavDrawer({open,onClose,current}) {
 const drawerRef=useRef(null);
 const closeButtonRef=useRef(null);
 const closeRef=useRef(onClose);
 const restoreFocusRef=useRef(null);
 closeRef.current=onClose;
 useEffect(()=>{
  if(!open)return;
  const previousOverflow=document.body.style.overflow;
  const active=document.activeElement;
  restoreFocusRef.current=active instanceof HTMLElement?active:null;
  document.body.style.overflow="hidden";
  closeButtonRef.current?.focus({preventScroll:true});
  const handleKeyDown=event=>{
   if(event.key==="Escape"){event.preventDefault();closeRef.current?.();return}
   if(event.key!=="Tab")return;
   const panel=drawerRef.current;
   if(!panel)return;
   const focusable=[...panel.querySelectorAll('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>!el.hasAttribute("hidden")&&el.getAttribute("aria-hidden")!=="true"&&getComputedStyle(el).visibility!=="hidden");
   if(!focusable.length){event.preventDefault();panel.focus();return}
   const first=focusable[0],last=focusable[focusable.length-1];
   if(event.shiftKey&&(document.activeElement===first||!panel.contains(document.activeElement))){event.preventDefault();last.focus()}
   else if(!event.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){event.preventDefault();first.focus()}
  };
  window.addEventListener("keydown",handleKeyDown);
  return()=>{
   document.body.style.overflow=previousOverflow;
   window.removeEventListener("keydown",handleKeyDown);
   const target=restoreFocusRef.current;
   restoreFocusRef.current=null;
   if(target?.isConnected)target.focus({preventScroll:true});
  };
 },[open]);
 if(!open)return null;
 const links=[
  {id:"auto",href:"/auto",label:"Auto Redeem",description:"Hands-off gift-code processing",Icon:Activity},
  {id:"manual",href:"/manual",label:"Manual Redeem",description:"Submit a specific gift code",Icon:Gift},
  {id:"info",href:"/info",label:"How it works",description:"Registration, checks, and results",Icon:Info},
  {id:"developer",href:"/developer",label:"Developer API",description:"Build with the public API",Icon:ShieldCheck},
  {id:"profile",href:"/profile",label:"Your profile",description:"Account and sign-in settings",Icon:UserRound}
 ];
 const close=()=>closeRef.current?.();
 const title=current==="info"?"How it works":current==="terms"?"Terms of use":current==="privacy"?"Privacy notice":current==="developer"?"Developer API":current==="profile"?"Your profile":current==="manual"?"Manual Redeem":"Auto Redeem";
 return <>
  <button className="ks-nav-scrim" type="button" aria-label="Close navigation" onClick={close}/>
  <aside ref={drawerRef} id="ks-nav-drawer" className="ks-nav-drawer" role="dialog" aria-modal="true" aria-labelledby="ks-nav-title">
   <div className="ks-nav-drawer-head">
    <div><span className="ks-nav-drawer-kicker">NAVIGATION</span><h2 id="ks-nav-title">Explore</h2></div>
    <button ref={closeButtonRef} type="button" onClick={close} aria-label="Close navigation menu"><X size={21}/></button>
   </div>
   <nav aria-label="Site sections">
    {links.slice(0,3).map(item=><a key={item.id} className={"ks-nav-drawer-link"+(item.id===current?" is-current":"")} href={item.href} aria-current={item.id===current?"page":undefined}><b>{item.label}</b><span>{item.description}</span></a>)}
    <button className="ks-nav-drawer-support" type="button" onClick={()=>{restoreFocusRef.current=null;close();window.dispatchEvent(new CustomEvent("ks-support-open",{detail:{topic:"Other",subject:current==="info"?"How it works question":current==="terms"||current==="privacy"?"Legal page question":"Support request",pageTitle:document.title}}))}}>
     <LifeBuoy size={28} aria-hidden="true"/><span className="ks-nav-drawer-support-copy"><b>Support</b><small>Get help or continue a private ticket</small></span><ArrowRight size={16} aria-hidden="true"/>
    </button>
    {links.slice(3).map(item=><a key={item.id} className={"ks-nav-drawer-link"+(item.id===current?" is-current":"")} href={item.href} aria-current={item.id===current?"page":undefined}><b>{item.label}</b><span>{item.description}</span></a>)}
   </nav>
   <div className="ks-nav-drawer-footer"><ShieldCheck size={14}/><span>Your game password is never requested.</span></div>
  </aside>
 </>;
}
