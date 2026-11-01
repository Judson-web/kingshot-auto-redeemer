import React,{useEffect,useState}from"react";
import{createPortal}from"react-dom";
import"./SeasonalHalloweenOverlay.css";

const SEASON_END=Date.parse("2026-11-02T18:30:00Z");
const HALLOWEEN_MARK='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="n" x2="0" y2="1"><stop stop-color="#ffd98a"/><stop offset="1" stop-color="#e87532"/></linearGradient><radialGradient id="g"><stop stop-color="#9a54c8"/><stop offset="1" stop-color="#20102e"/></radialGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><path d="M32 10c-3 6-12 8-15 18-4 13 4 25 15 25s19-12 15-25c-3-10-12-12-15-18Z" fill="url(#n)" stroke="#ffe2a6" stroke-width="1.5"/><path d="M31 12c-1-5 3-8 8-9-1 5-3 8-8 9Z" fill="#79a56b"/><path d="m22 29 7 4-7 3Zm20 0-7 4 7 3Z" fill="#25142c"/><path d="M27 43q5 5 10 0" fill="none" stroke="#25142c" stroke-width="2.5" stroke-linecap="round"/><path d="M9 12 13 8m38 4 4-4M7 48l5-2m40 2 5 2" stroke="#f6b85c" stroke-width="2" stroke-linecap="round"/></svg>';
const HALLOWEEN_ICON="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(HALLOWEEN_MARK);

function restoreBrand(){
 document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"],link[rel="mask-icon"]').forEach(el=>{if(el.dataset.ksSeasonalOriginal!==undefined){el.href=el.dataset.ksSeasonalOriginal;delete el.dataset.ksSeasonalOriginal}});
 document.querySelectorAll('img[data-ks-seasonal-original]').forEach(el=>{el.src=el.dataset.ksSeasonalOriginal;delete el.dataset.ksSeasonalOriginal});
 const theme=document.querySelector('meta[name="theme-color"]');if(theme?.dataset.ksSeasonalOriginal!==undefined){theme.content=theme.dataset.ksSeasonalOriginal;delete theme.dataset.ksSeasonalOriginal}
}
function applyBrand(){
 document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"],link[rel="mask-icon"]').forEach(el=>{if(el.dataset.ksSeasonalOriginal===undefined)el.dataset.ksSeasonalOriginal=el.href;el.href=HALLOWEEN_ICON});
 const swap=()=>document.querySelectorAll('img[src$="/favicon.svg"],img[src="/favicon.svg"],img[src$="/icons/icon-192.svg"]').forEach(el=>{if(el.dataset.ksSeasonalOriginal===undefined)el.dataset.ksSeasonalOriginal=el.getAttribute("src")||"/favicon.svg";el.src=HALLOWEEN_ICON});
 swap();
 const observer=new MutationObserver(swap);observer.observe(document.documentElement,{subtree:true,childList:true});
 const theme=document.querySelector('meta[name="theme-color"]');if(theme){if(theme.dataset.ksSeasonalOriginal===undefined)theme.dataset.ksSeasonalOriginal=theme.content;theme.content="#1b1024"}
 return()=>{observer.disconnect();restoreBrand()};
}
function MilestoneBoard(){
 const [count,setCount]=useState(null),[position,setPosition]=useState({x:0,y:0}),[tilt,setTilt]=useState({x:0,y:0}),drag=React.useRef(null);
 useEffect(()=>{let alive=true;const load=()=>fetch("/api/kingshot-player?milestone=count",{headers:{Accept:"application/json"},cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{if(alive&&Number.isFinite(Number(d?.registeredIds)))setCount(Number(d.registeredIds))}).catch(()=>{});load();const timer=window.setInterval(load,60000);return()=>{alive=false;window.clearInterval(timer)}},[]);
 const remaining=count===null?null:Math.max(0,1000-count);
 const down=e=>{if(e.button!==0&&e.pointerType==="mouse")return;drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,px:position.x,py:position.y};e.currentTarget.setPointerCapture?.(e.pointerId);};
 const move=e=>{if(!drag.current||drag.current.id!==e.pointerId)return;const dx=e.clientX-drag.current.x,dy=e.clientY-drag.current.y;setPosition({x:Math.max(-window.innerWidth/2+130,Math.min(window.innerWidth/2-130,drag.current.px+dx)),y:Math.max(-window.innerHeight+100,Math.min(window.innerHeight-90,drag.current.py+dy))});setTilt({x:Math.max(-13,Math.min(13,-dy*.18)),y:Math.max(-16,Math.min(16,dx*.18))});};
 const up=()=>{drag.current=null;setTilt({x:0,y:0})};
 return <div className="ks-milestone-stage" aria-label="Draggable community registration countdown"><div className="ks-milestone-cable ks-milestone-cable-left"/><div className="ks-milestone-cable ks-milestone-cable-right"/><section className={"ks-milestone-board"+(drag.current?" is-dragging":"")} style={{"--board-x":position.x+"px","--board-y":position.y+"px","--board-tilt-x":tilt.x+"deg","--board-tilt-y":tilt.y+"deg"}} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} role="group" aria-label="Drag to reposition the registration countdown"><div className="ks-milestone-grip" aria-hidden="true">⠿ DRAG TO MOVE</div><div className="ks-milestone-eyebrow"><i/> COMMUNITY MILESTONE <i/></div><strong className="ks-milestone-count">{count===null?"—":count.toLocaleString()}</strong><span className="ks-milestone-caption">REGISTERED PLAYER IDS</span><div className="ks-milestone-progress"><span style={{width:count===null?"0%":Math.min(100,count/10)+"%"}}/></div><div className="ks-milestone-foot">{count===null?"COUNT LOADING":remaining===0?"1,000 MILESTONE REACHED":remaining.toLocaleString()+" TO THE 1,000 MILESTONE"}</div></section></div>
}
function Bat({className=""}){return <svg className={className} viewBox="0 0 100 48" aria-hidden="true"><path d="M50 21C43 8 34 4 26 2c3 7 3 12-2 17C17 11 9 10 2 11c7 7 9 14 6 24 11-7 20-6 28 5 3-7 8-10 14-11 6 1 11 4 14 11 8-11 17-12 28-5-3-10-1-17 6-24-7-1-15 0-22 8-5-5-5-10-2-17-8 2-17 6-24 19Z" fill="currentColor"/><circle cx="46" cy="23" r="1.6" fill="#ffdc92"/><circle cx="54" cy="23" r="1.6" fill="#ffdc92"/></svg>}
function Ghost({className=""}){return <svg className={className} viewBox="0 0 64 76" aria-hidden="true"><path d="M32 3C15 3 7 17 7 35v31l9-6 8 7 8-7 8 7 8-7 9 5V35C57 17 49 3 32 3Z" fill="currentColor" stroke="#fff" strokeOpacity=".55" strokeWidth="1.5"/><path d="m20 30 7 3-7 4Zm24 0-7 3 7 4Z" fill="#28162f"/><path d="M27 47q5-8 10 0" fill="none" stroke="#28162f" strokeWidth="3" strokeLinecap="round"/><path d="M18 16q5-7 12-7" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round"/></svg>}
function Pumpkin({className=""}){return <svg className={className} viewBox="0 0 100 88" aria-hidden="true"><path d="M50 16c-8-11-2-16 9-14-1 7-3 11-9 14Z" fill="#78935b"/><path d="M50 17C35 5 12 19 10 43 7 68 24 82 50 80c26 2 43-12 40-37C88 19 65 5 50 17Z" fill="#e77d32" stroke="#ffbd68" stroke-width="2"/><path d="M50 18c-8 9-10 24-9 37 1 14 4 22 9 25 5-3 8-11 9-25 1-13-1-28-9-37Z" fill="#c65c2e" opacity=".6"/><path d="m25 39 16 7-16 6Zm50 0-16 7 16 6Z" fill="#2a1730"/><path d="M38 61 44 65 49 59 54 65 62 60 59 72 42 72Z" fill="#2a1730"/><path d="M16 34q4-12 14-15M84 34q-4-12-14-15" fill="none" stroke="#ffc47a" stroke-width="2" stroke-linecap="round" opacity=".8"/></svg>}


export default function SeasonalHalloweenOverlay(){
 const[now,setNow]=useState(()=>Date.now());
 useEffect(()=>{
  if(Date.now()>=SEASON_END){restoreBrand();return}
  const cleanup=applyBrand();
  const timer=window.setInterval(()=>{const value=Date.now();setNow(value);if(value>=SEASON_END){window.clearInterval(timer);cleanup()}},1000);
  return()=>{window.clearInterval(timer);cleanup()};
 },[]);
 if(typeof document==="undefined")return null;
 const halloweenActive=now<SEASON_END;
 return createPortal(<><MilestoneBoard/>{halloweenActive&&<div className="ks-halloween-overlay" aria-label="Halloween seasonal decorations">
  <div className="ks-halloween-atmosphere" aria-hidden="true"/>

  <div className="ks-halloween-moon" aria-hidden="true"><i/></div>
  <div className="ks-halloween-hanging ks-halloween-hanging-left" aria-hidden="true"><span/><Pumpkin/></div>
  <div className="ks-halloween-hanging ks-halloween-hanging-right" aria-hidden="true"><span/><svg viewBox="0 0 54 70"><path d="M27 2C12 2 6 16 6 34v29l10-6 11 7 11-7 10 6V34C48 16 42 2 27 2Z" fill="currentColor"/><ellipse cx="20" cy="31" rx="3" ry="5" fill="#26182f"/><ellipse cx="34" cy="31" rx="3" ry="5" fill="#26182f"/><path d="M23 43q4 4 8 0" fill="none" stroke="#26182f" strokeWidth="2" strokeLinecap="round"/></svg></div>
  <div className="ks-halloween-hanging ks-halloween-hanging-mid" aria-hidden="true"><span/><Pumpkin/></div>
  <Bat className="ks-halloween-bat ks-halloween-bat-a"/><Bat className="ks-halloween-bat ks-halloween-bat-b"/><Bat className="ks-halloween-bat ks-halloween-bat-c"/>
  <Ghost className="ks-halloween-ghost ks-halloween-ghost-a"/><Ghost className="ks-halloween-ghost ks-halloween-ghost-b"/>
  <div className="ks-halloween-fireflies" aria-hidden="true">{Array.from({length:18},(_,i)=><i key={i}/>)}</div>
  <div className="ks-halloween-ground-mist" aria-hidden="true"/>
  <Pumpkin className="ks-halloween-corner-pumpkin ks-halloween-corner-pumpkin-left"/><Pumpkin className="ks-halloween-corner-pumpkin ks-halloween-corner-pumpkin-right"/>
 </div>}</>,document.body);
}
