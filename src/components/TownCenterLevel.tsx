import React,{useState}from"react";
import{formatTownCenterLevel,townCenterTier}from"../../lib/town-center-level.js";
import"./town-center-level.css";

type Props={value:unknown;className?:string};
export default function TownCenterLevel({value,className=""}:Props){
 const tier=townCenterTier(value),label=formatTownCenterLevel(value),[imageFailed,setImageFailed]=useState(false);
 if(label==="—")return <span className={className||undefined}>—</span>;
 if(tier===null)return <span className={className||undefined}>{label}</span>;
 const raw=String(value??"").trim();
 const details=/^\\d+$/.test(raw)?label+" · level "+raw:label;
 return <span className={("tc-level "+className).trim()} aria-label={"Town Center "+details} title={"Town Center · "+details}>
  {!imageFailed?<img src={"https://v2.kingshot.net/images/truegold/truegold_level_"+tier+".png"} alt="" loading="eager" decoding="async" referrerPolicy="no-referrer" onError={()=>setImageFailed(true)}/>:<span className="tc-level-fallback">TG{tier}</span>}
  <span className="tc-level-sr">{details}</span>
 </span>;
}
