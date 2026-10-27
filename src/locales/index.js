import en from "./en.js";
import ko from "./ko.js";
export function translate(key, language = "en") {
  const catalog = language === "ko" ? ko : en;
  return catalog[key] ?? en[key] ?? key;
}
