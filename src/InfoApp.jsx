import React,{useEffect,useState} from "react";
import {ArrowLeft,ArrowRight,Clock3,Database,History,LockKeyhole,RefreshCw,Zap,Menu,X,ShieldCheck} from "lucide-react";
import "./how-it-works-redesign.css";
import MobileNavDrawer from "./components/MobileNavDrawer.jsx";
import PublicSiteHeader from "./components/PublicSiteHeader.jsx";
import { useTranslations } from "./locales/useTranslations.js";
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
 {icon:Zap,titleKey:"feature.auto.title",textKey:"feature.auto.text"},
 {icon:History,titleKey:"feature.older.title",textKey:"feature.older.text"},
 {icon:Database,titleKey:"feature.history.title",textKey:"feature.history.text"},
 {icon:RefreshCw,titleKey:"feature.discovery.title",textKey:"feature.discovery.text"},
 {icon:ShieldCheck,titleKey:"feature.secure.title",textKey:"feature.secure.text"},
 {icon:LockKeyhole,titleKey:"feature.password.title",textKey:"feature.password.text"},
];

function InfoApp(){
 const t=useTranslations();
 return <div className="app ks-app info-app">
  <a className="skip-link" href="#main-content">{t("skip")}</a>
  <PublicSiteHeader current="info" />
  <main id="main-content">
   <section className="info-hero"><a className="info-back" href="/auto"><ArrowLeft size={14}/> {t("back")}</a><div className="eyebrow"><span/>{t("eyebrow")}</div><h1>{t("title")}</h1><p className="hero-copy">{t("hero")}</p></section>
   <section className="info-flow"><div className="section-title"><span>01</span><h2>{t("flow.title")}</h2></div><div className="info-steps"><article><b>01</b><div><strong>{t("flow.1.title")}</strong><p>{t("flow.1.text")}</p></div></article><article><b>02</b><div><strong>{t("flow.2.title")}</strong><p>{t("flow.2.text")}</p></div></article><article><b>03</b><div><strong>{t("flow.3.title")}</strong><p>{t("flow.3.text")}</p></div></article><article><b>04</b><div><strong>{t("flow.4.title")}</strong><p>{t("flow.4.text")}</p></div></article></div></section>
   <section className="info-features"><div className="section-title"><span>02</span><h2>{t("features.title")}</h2></div><div className="info-grid">{sections.map(({icon:Icon,titleKey,textKey})=><article key={titleKey}><div className="info-icon"><Icon size={18}/></div><div><h3>{t(titleKey)}</h3><p>{t(textKey)}</p></div></article>)}</div></section>
   
   <section className="info-failures"><div className="section-title"><span>03</span><h2>{t("failures.title")}</h2></div><div className="info-grid"><article><div className="info-icon"><Clock3 size={18}/></div><div><h3>{t("failure.expired.title")}</h3><p>{t("failure.expired.text")}</p></div></article><article><div className="info-icon"><RefreshCw size={18}/></div><div><h3>{t("failure.limits.title")}</h3><p>{t("failure.limits.text")}</p></div></article><article><div className="info-icon"><ShieldCheck size={18}/></div><div><h3>{t("failure.mismatch.title")}</h3><p>{t("failure.mismatch.text")}</p></div></article></div></section>
   <section className="info-cta"><div className="info-cta-copy"><span className="info-cta-kicker">{t("cta.kicker")}</span><h2>{t("cta.title")}</h2><p>{t("cta.text")}</p></div><div className="info-cta-links"><a href="/auto">{t("cta.auto")} <ArrowRight size={14}/></a><a href="/manual">{t("cta.manual")} <ArrowRight size={14}/></a></div></section>
  </main>
  <footer><KsLogo/><span>{t("footer.independent")}</span><span><a href="https://discord.com/users/871756466900598815" target="_blank" rel="noopener noreferrer">{t("footer.contact")}</a> · <a href="/info">{t("footer.info")}</a> · <a href="/terms?service=kingshot-auto">{t("footer.terms")}</a> · <a href="/privacy?service=kingshot-auto">{t("footer.privacy")}</a></span></footer>
 </div>
}
export default InfoApp;
