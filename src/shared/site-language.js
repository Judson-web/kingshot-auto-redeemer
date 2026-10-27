import { useCallback, useEffect, useState } from "react";
import en from "./translations/en.js";
import ko from "./translations/ko.js";
const KEY="ks-site-language", CHANGE_EVENT="ks-language-change";
export const LANGUAGE_OPTIONS=[{id:"EN",code:"en",flag:"🇺🇸",label:"English"},{id:"KO",code:"ko",flag:"🇰🇷",label:"한국어"}];
export const TRANSLATIONS={en,ko};
let languageSelectionVersion=0;
let localeDetectionPromise=null;
export function getSavedSiteLanguage(){try{const saved=localStorage.getItem(KEY);if(saved==="ko"||saved==="en")return saved}catch{}return null}
export function getSiteLanguage(){return getSavedSiteLanguage()||"en"}
export function setSiteLanguage(language){const next=language==="ko"?"ko":"en";languageSelectionVersion++;try{localStorage.setItem(KEY,next)}catch{}if(typeof document!=="undefined")document.documentElement.lang=next;if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent(CHANGE_EVENT,{detail:next}));return next}
function detectDefaultLanguage(){
 if(!localeDetectionPromise){
  localeDetectionPromise=fetch("/api/site-locale",{method:"GET",credentials:"same-origin",cache:"no-store",headers:{accept:"application/json"}})
   .then(response=>{if(!response.ok)throw new Error("Locale detection unavailable");return response.json()})
   .then(data=>String(data?.countryCode||"").toUpperCase()==="KR"?"ko":"en")
   .catch(()=> "en");
 }
 return localeDetectionPromise;
}
export function translate(language,key,fallback){return (TRANSLATIONS[language]||en)[key]??en[key]??fallback??key}
function syncDocumentMetadata(language){
 if(typeof document==="undefined"||typeof window==="undefined")return;
 const path=window.location.pathname;
 const routes={
  "/":["meta.autoTitle","meta.autoDescription"],"/auto":["meta.autoTitle","meta.autoDescription"],
  "/manual":["meta.manualTitle","meta.manualDescription"],"/redeem":["meta.manualTitle","meta.manualDescription"],
  "/info":["meta.infoTitle","meta.infoDescription"],"/developer":["meta.developerTitle","meta.developerDescription"],
  "/profile":["meta.profileTitle","meta.profileDescription"],"/privacy":["meta.privacyTitle","meta.privacyDescription"],
  "/terms":["meta.termsTitle","meta.termsDescription"]
 };
 const keys=routes[path];if(!keys)return;
 const title=translate(language,keys[0]),description=translate(language,keys[1]);
 document.title=title;
 const set=(selector,content)=>document.querySelector(selector)?.setAttribute("content",content);
 set('meta[name="description"]',description);set('meta[property="og:title"]',title);set('meta[property="og:description"]',description);
 set('meta[name="twitter:title"]',title);set('meta[name="twitter:description"]',description);set('meta[property="og:locale"]',language==="ko"?"ko_KR":"en_US");
}
export function useSiteLanguage(){
 const [language,setLanguage]=useState(getSiteLanguage);
 useEffect(()=>{
  const sync=event=>setLanguage(event?.detail||getSiteLanguage());
  window.addEventListener(CHANGE_EVENT,sync);
  document.documentElement.lang=language;
  syncDocumentMetadata(language);
  return()=>window.removeEventListener(CHANGE_EVENT,sync)
 },[language]);
 useEffect(()=>{
  if(getSavedSiteLanguage())return;
  const selectionVersion=languageSelectionVersion;
  let active=true;
  detectDefaultLanguage().then(detected=>{
   if(!active||getSavedSiteLanguage()||selectionVersion!==languageSelectionVersion)return;
   setLanguage(detected);
  });
  return()=>{active=false};
 },[language]);
 const changeLanguage=useCallback(next=>setSiteLanguage(next),[]);
 const t=useCallback((key,fallback)=>translate(language,key,fallback),[language]);
 return {language,changeLanguage,isKorean:language==="ko",t}
}
