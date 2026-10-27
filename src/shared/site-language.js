import { useCallback, useEffect, useState } from "react";
import en from "../locales/en.js";
import ko from "../locales/ko.js";
const KEY="ks-site-language",CHANGE_EVENT="ks-language-change";
export const LANGUAGE_OPTIONS=[{id:"EN",code:"en",flag:"🇺🇸",label:"English"},{id:"KO",code:"ko",flag:"🇰🇷",label:"한국어"}];
export function getSiteLanguage(){try{const saved=localStorage.getItem(KEY);if(saved==="ko"||saved==="en")return saved}catch{}return "en"}
export function setSiteLanguage(language){const next=language==="ko"?"ko":"en";try{localStorage.setItem(KEY,next)}catch{}if(typeof document!=="undefined")document.documentElement.lang=next;if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent(CHANGE_EVENT,{detail:next}));return next}
export function translate(key,language=getSiteLanguage()){const dictionary=language==="ko"?ko:en;return dictionary[key]||key}
export function useSiteLanguage(){const [language,setLanguage]=useState(getSiteLanguage);useEffect(()=>{const sync=event=>setLanguage(event?.detail||getSiteLanguage());window.addEventListener(CHANGE_EVENT,sync);document.documentElement.lang=language;return()=>window.removeEventListener(CHANGE_EVENT,sync)},[language]);const changeLanguage=useCallback(next=>setSiteLanguage(next),[]);const t=useCallback(key=>translate(key,language),[language]);return {language,changeLanguage,isKorean:language==="ko",t}}
