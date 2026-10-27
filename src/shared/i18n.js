import en from "../locales/en.json";
import ko from "../locales/ko.json";
import { getSiteLanguage } from "./site-language.js";
const dictionaries={en,ko};
export function translate(key,language=getSiteLanguage(),fallback=""){
 const dictionary=dictionaries[language==="ko"?"ko":"en"];
 return dictionary[key] ?? dictionaries.en[key] ?? fallback ?? key;
}
export function useTranslation(){
 const language=getSiteLanguage();
 return (key,fallback="")=>translate(key,language,fallback);
}
