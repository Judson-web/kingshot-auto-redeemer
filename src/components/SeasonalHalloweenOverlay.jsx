import React,{useEffect,useState}from"react";
import{createPortal}from"react-dom";
import{Power}from"lucide-react";
import"./SeasonalHalloweenOverlay.css";

const SEASON_END=new Date("2026-11-03T00:00:00+05:30").getTime();
const DISMISS_KEY="ks-halloween-overlay-disabled-2026";

function Bat({className=""}) {
 return <svg className={className} viewBox="0 0 92 42" aria-hidden="true">
  <path d="M46 18 C40 7 34 4 26 2 C29 9 28 14 24 17 C17 10 9 8 2 9 C8 16 10 22 8 30 C18 24 26 25 33 34 C36 28 40 25 46 24 C52 25 56 28 59 34 C66 25 74 24 84 30 C82 22 84 16 90 9 C83 8 75 10 68 17 C64 14 63 9 66 2 C58 4 52 7 46 18Z" fill="currentColor"/>
  <circle cx="43" cy="19" r="1.4" fill="#ffcf78"/><circle cx="49" cy="19" r="1.4" fill="#ffcf78"/>
 </svg>;
}

function Web({side}) {
 return <div className={"ks-halloween-web ks-halloween-web-"+side} aria-hidden="true"><i/><i/><i/><i/><i/></div>;
}

export default function SeasonalHalloweenOverlay(){
 const[enabled,setEnabled]=useState(false);
 const[ready,setReady]=useState(false);
 useEffect(()=>{
  const now=Date.now();
  let dismissed=false;
  try{dismissed=localStorage.getItem(DISMISS_KEY)==="1"}catch{}
  setEnabled(now<SEASON_END&&!dismissed);
  setReady(true);
  const onStorage=event=>{if(event.key===DISMISS_KEY)setEnabled(event.newValue!=="1"&&Date.now()<SEASON_END)};
  window.addEventListener("storage",onStorage);
  return()=>window.removeEventListener("storage",onStorage);
 },[]);
 const toggle=()=>{
  const next=!enabled;
  setEnabled(next);
  try{if(next)localStorage.removeItem(DISMISS_KEY);else localStorage.setItem(DISMISS_KEY,"1")}catch{}
 };
 if(!ready||typeof document==="undefined"||Date.now()>=SEASON_END)return null;
 return createPortal(<>
  {enabled&&<div className="ks-halloween-overlay" aria-hidden="true">
   <Web side="left"/><Web side="right"/>
   <div className="ks-halloween-spider"><span/><svg viewBox="0 0 34 34"><path d="M17 0V10" stroke="currentColor" strokeWidth="1.5"/><ellipse cx="17" cy="18" rx="6" ry="8" fill="currentColor"/><circle cx="17" cy="10" r="4" fill="currentColor"/><path d="M12 14 5 10M11 19 3 19M12 23 6 28M22 14 29 10M23 19 31 19M22 23 28 28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></div>
   <Bat className="ks-halloween-bat ks-halloween-bat-one"/><Bat className="ks-halloween-bat ks-halloween-bat-two"/>
   <div className="ks-halloween-ghost"><svg viewBox="0 0 42 52"><path d="M21 2C9 2 3 12 3 24v23l9-5 9 6 9-6 9 5V24C39 12 33 2 21 2Z" fill="currentColor"/><ellipse cx="15" cy="23" rx="2.2" ry="3.5" fill="#20142c"/><ellipse cx="27" cy="23" rx="2.2" ry="3.5" fill="#20142c"/><path d="M18 31q3 3 6 0" fill="none" stroke="#20142c" strokeWidth="1.5" strokeLinecap="round"/></svg></div>
   <div className="ks-halloween-embers"><i/><i/><i/><i/><i/><i/><i/><i/></div>
   <div className="ks-halloween-bottom-glow"/>
  </div>}
  <button className="ks-halloween-toggle" type="button" onClick={toggle} aria-label={enabled?"Turn off Halloween decorations":"Turn on Halloween decorations"} title={enabled?"Turn off Halloween decorations":"Turn on Halloween decorations"}><span className="ks-halloween-toggle-icon">🎃</span><span>{enabled?"Halloween mode":"Halloween off"}</span><Power size={13}/></button>
 </>,document.body);
}
