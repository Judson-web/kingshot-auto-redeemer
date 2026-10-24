import React,{useState} from "react";
import {Menu,X} from "lucide-react";
import MobileNavDrawer from "./MobileNavDrawer.jsx";
import PublicAccountChip from "./PublicAccountChip.jsx";

const links=[
 {id:"auto",href:"/auto",label:"Auto Redeem"},
 {id:"manual",href:"/manual",label:"Manual Redeem"},
 {id:"info",href:"/info",label:"How it works"},
 {id:"developer",href:"/developer",label:"Developer API"}
];

export default function PublicSiteHeader({current="auto"}){
 const [menuOpen,setMenuOpen]=useState(false);
 return <>
  <header className="public-site-header">
   <a className="brand ks-brand public-site-brand" href="/" aria-label="Kingshot Redeemer home">
    <span className="brand-mark ks-brand-mark"><img src="/favicon.svg" alt="" width="100%" height="100%" decoding="async"/></span>
    <span>Kingshot Redeemer</span>
   </a>
   <nav className="public-site-nav" aria-label="Primary navigation">
    {links.map(link=><a key={link.id} href={link.href} className={current===link.id?"is-active":undefined} aria-current={current===link.id?"page":undefined}>{link.label}</a>)}
   </nav>
   <div className="public-site-actions">
    <PublicAccountChip/>
    <button className="public-site-menu" type="button" onClick={()=>setMenuOpen(value=>!value)} aria-label={menuOpen?"Close navigation":"Open navigation"} aria-expanded={menuOpen} aria-controls="ks-nav-drawer" aria-haspopup="dialog">{menuOpen?<X size={18}/>:<Menu size={18}/>}</button>
   </div>
  </header>
  <MobileNavDrawer open={menuOpen} onClose={()=>setMenuOpen(false)} current={current}/>
 </>;
}
