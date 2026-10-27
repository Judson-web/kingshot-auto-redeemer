import { useCallback, useEffect, useState } from "react";
const KEY="ks-site-language", CHANGE_EVENT="ks-language-change";
export const LANGUAGE_OPTIONS=[{id:"EN",code:"en",flag:"🇺🇸",label:"English"},{id:"KO",code:"ko",flag:"🇰🇷",label:"한국어"}];
export function getSiteLanguage(){try{const saved=localStorage.getItem(KEY);if(saved==="ko"||saved==="en")return saved}catch{}return "en"}
export function setSiteLanguage(language){const next=language==="ko"?"ko":"en";try{localStorage.setItem(KEY,next)}catch{}if(typeof document!=="undefined")document.documentElement.lang=next;if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent(CHANGE_EVENT,{detail:next}));return next}
export function useSiteLanguage(){const [language,setLanguage]=useState(getSiteLanguage);useEffect(()=>{const sync=event=>setLanguage(event?.detail||getSiteLanguage());window.addEventListener(CHANGE_EVENT,sync);document.documentElement.lang=language;return()=>window.removeEventListener(CHANGE_EVENT,sync)},[language]);const changeLanguage=useCallback(next=>setSiteLanguage(next),[]);return {language,changeLanguage,isKorean:language==="ko"}}
