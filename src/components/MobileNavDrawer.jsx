import React,{useEffect,useRef} from "react";
import {Activity,ArrowRight,Gift,Info,LifeBuoy,ShieldCheck,UserRound,X} from "lucide-react";
import { translate as t } from "../shared/translate.js";

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
  {id:"auto",href:"/auto",label:t("nav.auto"),description:"Hands-off gift-code processing",Icon:Activity},
  {id:"manual",href:"/manual",label:t("nav.manual"),description:"Submit a specific gift code",Icon:Gift},
  {id:"info",href:"/info",label:t("nav.info"),description:"Registration, checks, and results",Icon:Info},
  {id:"developer",href:"/developer",label:t("nav.developer"),description:"Build with the public API",Icon:ShieldCheck},
  {id:"profile",href:"/profile",label:t("nav.profile"),description:"Developer and admin account",Icon:UserRound}
 ];
 const close=()=>closeRef.current?.();
 const title=current==="info"?"How it works":current==="terms"?"Terms of use":current==="privacy"?"Privacy notice":current==="developer"?"Developer API":current==="profile"?"Your profile":current==="manual"?"Manual Redeem":"Auto Redeem";
 return <>
  <button className="ks-nav-scrim" type="button" aria-label="Close navigation" onClick={close}/>
  <aside ref={drawerRef} id="ks-nav-drawer" className="ks-nav-drawer" role="dialog" aria-modal="true" aria-labelledby="ks-nav-title">
   <div className="ks-nav-drawer-head">
    <div><span className="ks-nav-drawer-kicker">{current==="profile"?(t("nav.profile")+" / "+t("nav.support")):t("nav.support")}</span><h2 id="ks-nav-title">{current==="profile"?t("nav.profile"):t("nav.info")}</h2></div>
    <button ref={closeButtonRef} type="button" onClick={close} aria-label="Close navigation menu"><X size={21}/></button>
   </div>
   <nav aria-label="Site sections">
    {links.slice(0,3).map(item=><a key={item.id} className={"ks-nav-drawer-link"+(item.id===current?" is-current":"")} href={item.href} aria-current={item.id===current?"page":undefined}><span className="ks-nav-drawer-icon"><item.Icon size={18} aria-hidden="true"/></span><span className="ks-nav-drawer-copy"><b>{item.label}</b><small>{item.description}</small></span><ArrowRight className="ks-nav-drawer-arrow" size={16} aria-hidden="true"/></a>)}
    <button className="ks-nav-drawer-support" type="button" onClick={()=>{restoreFocusRef.current=null;close();window.dispatchEvent(new CustomEvent("ks-support-open",{detail:{topic:"Other",subject:current==="info"?"How it works question":current==="terms"||current==="privacy"?"Legal page question":current==="profile"?"Profile & sign-in question":"Support request",pageTitle:document.title}}))}}>
     <span className="ks-nav-drawer-support-icon"><LifeBuoy size={19} aria-hidden="true"/></span><span className="ks-nav-drawer-support-copy"><b>{t("nav.support")}</b><small>{t("nav.support.description")}</small></span><ArrowRight className="ks-nav-drawer-arrow" size={16} aria-hidden="true"/>
    </button>
    {links.slice(3).map(item=><a key={item.id} className={"ks-nav-drawer-link"+(item.id===current?" is-current":"")} href={item.href} aria-current={item.id===current?"page":undefined}><span className="ks-nav-drawer-icon"><item.Icon size={18} aria-hidden="true"/></span><span className="ks-nav-drawer-copy"><b>{item.label}</b><small>{item.description}</small></span><ArrowRight className="ks-nav-drawer-arrow" size={16} aria-hidden="true"/></a>)}
   </nav>
   <div className="ks-nav-drawer-footer"><ShieldCheck size={14}/><span>{t("nav.password")}</span></div>
  </aside>
 </>;
}
