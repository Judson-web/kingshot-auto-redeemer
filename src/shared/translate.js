import en from "../locales/en.js";
import ko from "../locales/ko.js";
import { getSiteLanguage } from "./site-language.js";
const dictionaries={en,ko};
export function translate(key, fallback) {
 const language=getSiteLanguage();
 return dictionaries[language]?.[key] ?? dictionaries.en[key] ?? fallback ?? key;
}
