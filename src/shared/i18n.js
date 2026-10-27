import en from "../locales/en.json";
import ko from "../locales/ko.json";
import { useSiteLanguage } from "./site-language.js";
const dictionaries={en,ko};
export function translate(language,key,fallback){return dictionaries[language]?.[key]??fallback??dictionaries.en[key]??key}
export function useTranslation(){const {language,isKorean,changeLanguage}=useSiteLanguage();return {language,isKorean,changeLanguage,t:(key,fallback)=>translate(language,key,fallback)}}
