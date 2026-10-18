import React,{useState}from"react";

type Props={value:unknown;className?:string};
function tierFor(value:unknown):number|null{
 const raw=String(value??"").trim().toUpperCase();
 const match=/^TG\s*([1-8])$/.exec(raw);
 if(match)return Number(match[1]);
 const numeric=Number(raw);
 if(raw!==""&&Number.isInteger(numeric)&&numeric>=31&&numeric<=38)return numeric-30;
 return null;
}
export default function TownCenterLevel({value,className=""}:Props){
 const tier=tierFor(value),[imageFailed,setImageFailed]=useState(false);
 if(value===null||value===undefined||String(value).trim()==="")return <span className={className||undefined}>—</span>;
 if(!tier)return <span className={className||undefined}>{String(value)}</span>;
 return <span className={("tc-level "+className).trim()} aria-label={"Town Center Truegold level TG"+tier} title={"Town Center · TG"+tier}>
  {!imageFailed?<img src={"https://v2.kingshot.net/images/truegold/truegold_level_"+tier+".png"} alt={"TG"+tier} loading="lazy" decoding="async" onError={()=>setImageFailed(true)}/>:<span className="tc-level-fallback">TG{tier}</span>}
  <span className="tc-level-sr">TG{tier}</span>
 </span>;
}
