import React,{useEffect,useState} from "react";
import {ArrowLeft,ArrowRight,Clock3,Database,History,LockKeyhole,RefreshCw,Zap,Menu,X,ShieldCheck} from "lucide-react";
import "./how-it-works-redesign.css";
import MobileNavDrawer from "./components/MobileNavDrawer.jsx";
import PublicSiteHeader from "./components/PublicSiteHeader.jsx";
import { useSiteLanguage } from "./shared/site-language.js";
const BRAND_ICON="/favicon.svg";
function KsLogo(){return <a className="brand ks-brand" href="/"><span className="brand-mark ks-brand-mark"><img src={BRAND_ICON} alt="Kingshot Redeemer"/></span><span>Kingshot Redeemer</span></a>}
const PROFILE_CHIP_CACHE="ks-profile-chip-v1";
function readCachedProfile(){try{const value=JSON.parse(sessionStorage.getItem(PROFILE_CHIP_CACHE)||"null");return value&&typeof value==="object"&&typeof value.username==="string"?value:null}catch{return null}}
function DiscordChip(){
 const [account,setAccount]=useState(()=>readCachedProfile());
 useEffect(()=>{let live=true,running=false;const load=async()=>{if(running)return;running=true;try{const [pr,dr]=await Promise.all([fetch("/api/kingshot-player?developer=account-auth",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"content-type":"application/json","cache-control":"no-cache"},body:JSON.stringify({action:"profile-check"})}),fetch("/api/kingshot-player?developer=account-auth",{credentials:"same-origin",cache:"no-store",headers:{"cache-control":"no-cache"}})]);const p=await pr.json().catch(()=>({})),d=await dr.json().catch(()=>({}));if(!live)return;if(p.authenticated&&p.user){const next={...p.user,kind:p.kind||p.user.kind||(p.role==="developer"?"developer":"user"),role:p.role||p.user.role||"user"};setAccount(next);try{sessionStorage.setItem(PROFILE_CHIP_CACHE,JSON.stringify(next))}catch{}}else if(d.authenticated&&d.user){const next={...d.user,kind:"developer",role:d.role||"developer"};setAccount(next);try{sessionStorage.setItem(PROFILE_CHIP_CACHE,JSON.stringify(next))}catch{}}else{setAccount(null);try{sessionStorage.removeItem(PROFILE_CHIP_CACHE)}catch{}}}catch{/* Preserve the shared cached profile during temporary network failures. */}finally{running=false}};void load();const refresh=()=>void load();window.addEventListener("focus",refresh);window.addEventListener("ks-profile-updated",refresh);const timer=window.setInterval(load,30000);return()=>{live=false;window.clearInterval(timer);window.removeEventListener("focus",refresh);window.removeEventListener("ks-profile-updated",refresh)}},[]);
 const avatar=account?.avatar_url||"https://cdn.discordapp.com/embed/avatars/0.png?size=64";
 if(!account)return <div className="site-account-wrap"><a className="site-account-chip site-login-chip site-account-icon-only" href="/profile" aria-label="Sign in with Discord" title="Sign in with Discord"><span>♙</span></a></div>;
 const isAdmin=account.role==="admin"||account.kind==="admin",isDeveloper=isAdmin||account.kind==="developer",isDev=isDeveloper&&!isAdmin;
 return <div className="site-account-wrap"><a className={"site-account-chip site-account-icon-only "+(isAdmin?"site-account-admin":isDev?"site-account-developer":"site-account-user")} href="/profile" aria-label={isAdmin?"Admin profile":isDev?"Developer profile":"User profile"} title={(account.username||account.email||"Profile")+" · "+(isAdmin?"Admin":isDev?"Developer":"User")}><span className="site-account-avatar-frame"><img src={avatar} alt="" onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src="https://cdn.discordapp.com/embed/avatars/0.png?size=64"}}/><span className="site-account-role-mark" aria-hidden="true">{isAdmin?"★":isDev?"⌘":"•"}</span></span></a></div>;
}

const sections=[
 {icon:Zap,title:t("info.automatic"),text:t("info.automaticText")},
 {icon:History,title:t("info.older"),text:t("info.olderText")},
 {icon:Database,title:t("info.history"),text:t("info.historyText")},
 {icon:RefreshCw,title:t("info.discovery"),text:t("info.discoveryText")},
 {icon:ShieldCheck,title:t("info.secure"),text:t("info.secureText")},
 {icon:LockKeyhole,title:t("info.noPassword"),text:t("info.noPasswordText")},
];

function InfoApp(){
 const {t}=useSiteLanguage();
 return <div className="app ks-app info-app">
  <a className="skip-link" href="#main-content">{t("info.skip")}</a>
  <PublicSiteHeader current="info" />
  <main id="main-content">
   <section className="info-hero"><a className="info-back" href="/auto"><ArrowLeft size={14}/> {t("info.back")}</a><div className="eyebrow"><span/>{t("info.eyebrow")}</div><h1>{t("info.title")}</h1><p className="hero-copy">{t("info.hero")}</p></section>
   <section className="info-flow"><div className="section-title"><span>01</span><h2>{t("info.basicFlow")}</h2></div><div className="info-steps"><article><b>01</b><div><strong>{t("info.register")}</strong><p>{t("info.registerText")}</p></div></article><article><b>02</b><div><strong>{t("info.pool")}</strong><p>{t("info.poolText")}</p></div></article><article><b>03</b><div><strong>{t("info.workers")}</strong><p>{t("info.workersText")}</p></div></article><article><b>04</b><div><strong>{t("info.results")}</strong><p>{t("info.resultsText")}</p></div></article></div></section>
   <section className="info-features"><div className="section-title"><span>02</span><h2>{t("info.features")}</h2></div><div className="info-grid">{sections.map(({icon:Icon,title,text})=><article key={title}><div className="info-icon"><Icon size={18}/></div><div><h3>{title}</h3><p>{text}</p></div></article>)}</div></section>
   
   <section className="info-failures"><div className="section-title"><span>03</span><h2>{t("info.failures")}</h2></div><div className="info-grid"><article><div className="info-icon"><Clock3 size={18}/></div><div><h3>{t("info.expired")}</h3><p>{t("info.expiredText")}</p></div></article><article><div className="info-icon"><RefreshCw size={18}/></div><div><h3>{t("info.limits")}</h3><p>{t("info.limitsText")}</p></div></article><article><div className="info-icon"><ShieldCheck size={18}/></div><div><h3>{t("info.mismatch")}</h3><p>{t("info.mismatchText")}</p></div></article></div></section>
   <section className="info-cta"><div className="info-cta-copy"><span className="info-cta-kicker">{t("info.ready")}</span><h2>{t("info.choose")}</h2><p>{t("info.chooseText")}</p></div><div className="info-cta-links"><a href="/auto">{t("info.automatic")} <ArrowRight size={14}/></a><a href="/manual">{t("info.manual")} <ArrowRight size={14}/></a></div></section>
  </main>
  <footer><KsLogo/><span>{t("info.independent")}</span><span><a href="https://discord.com/users/871756466900598815" target="_blank" rel="noopener noreferrer">{t("info.contact")}</a> · <a href="/info">{t("nav.info")}</a> · <a href="/terms?service=kingshot-auto">{t("info.terms")}</a> · <a href="/privacy?service=kingshot-auto">{t("info.privacy")}</a></span></footer>
 </div>
}
export default InfoApp;
