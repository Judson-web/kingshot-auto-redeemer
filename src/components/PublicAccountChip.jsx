import React,{useEffect,useState} from "react";
import {UserRound} from "lucide-react";

const PROFILE_CHIP_CACHE="ks-profile-chip-v1";
function readProfileChipCache(){
 try{
  const value=JSON.parse(sessionStorage.getItem(PROFILE_CHIP_CACHE)||"null");
  return value&&typeof value==="object"&&typeof value.username==="string"?value:null;
 }catch{return null}
}
function writeProfileChipCache(value){
 try{
  if(value)sessionStorage.setItem(PROFILE_CHIP_CACHE,JSON.stringify(value));
  else sessionStorage.removeItem(PROFILE_CHIP_CACHE);
 }catch{}
}

export default function PublicAccountChip(){
 const [account,setAccount]=useState(()=>readProfileChipCache());
 useEffect(()=>{
  let live=true,running=false;
  const load=async()=>{
   if(running)return;
   running=true;
   try{
    const [pr,dr]=await Promise.all([
     fetch("/api/kingshot-player?developer=account-auth",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"content-type":"application/json"},body:JSON.stringify({action:"profile-check"})}),
     fetch("/api/kingshot-player?developer=account-auth",{credentials:"same-origin",cache:"no-store"})
    ]);
    const p=await pr.json().catch(()=>({})),d=await dr.json().catch(()=>({}));
    if(!live)return;
    if(p.authenticated&&p.user){
     const next={...p.user,kind:p.kind||p.user.kind||(p.role==="developer"?"developer":"user"),role:p.role||p.user.role||"user"};
     setAccount(next);writeProfileChipCache(next);
    }else if(d.authenticated&&d.user){
     const next={...d.user,role:d.role,kind:"developer"};
     setAccount(next);writeProfileChipCache(next);
    }else{
     setAccount(null);writeProfileChipCache(null);
    }
   }catch{
    // Keep the last known chip visible during transient network failures.
   }finally{running=false}
  };
  void load();
  const refresh=()=>void load();
  window.addEventListener("focus",refresh);
  window.addEventListener("ks-profile-updated",refresh);
  const timer=window.setInterval(load,30000);
  return()=>{
   live=false;window.clearInterval(timer);
   window.removeEventListener("focus",refresh);
   window.removeEventListener("ks-profile-updated",refresh);
  };
 },[]);
 const avatar=account?.avatar_url||"https://cdn.discordapp.com/embed/avatars/0.png?size=64";
 if(!account)return <div className="site-account-wrap"><a className="site-account-chip site-login-chip site-account-icon-only" href="/profile" aria-label="Sign in with Discord" title="Sign in with Discord"><UserRound size={17}/></a></div>;
 const isAdmin=account.role==="admin"||account.kind==="admin";
 const isDeveloper=isAdmin||account.kind==="developer";
 const isDev=isDeveloper&&!isAdmin;
 return <div className="site-account-wrap"><a className={"site-account-chip site-account-icon-only "+(isAdmin?"site-account-admin":isDev?"site-account-developer":"site-account-user")} href="/profile" aria-label={isAdmin?"Admin profile":isDev?"Developer profile":"User profile"} title={(account.username||account.email||"Profile")+" · "+(isAdmin?"Admin":isDev?"Developer":"User")}><span className="site-account-avatar-frame"><img src={avatar} alt="" onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src="https://cdn.discordapp.com/embed/avatars/0.png?size=64"}}/><span className="site-account-role-mark" aria-hidden="true">{isAdmin?"★":isDev?"⌘":"•"}</span></span></a></div>;
}
