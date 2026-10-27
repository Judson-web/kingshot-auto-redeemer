import { useSiteLanguage } from "../shared/site-language.js";
import en from "./en.js";
import ko from "./ko.js";
export function useTranslations(){const {language}=useSiteLanguage();const dictionary=language==="ko"?ko:en;return key=>dictionary[key]??en[key]??key}
