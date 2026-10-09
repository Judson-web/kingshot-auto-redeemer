export interface GiftCodeRow { code: string; expiresAt: number | null; createdAt: number | null; source?: string; sources?: string[]; adminAdded?: boolean; confidence?: number; confidenceTier?: string; firstSeenAt?: string | null; }
export interface GiftCodeApiData { data?: { giftCodes?: Array<{ code?: unknown; expiresAt?: string | null; createdAt?: string | null }>; activeCount?: number } }
const KNOWN_MIXED_CASE_CODES = new Set(["Kingshot888"]);
export function isLikelyGiftCode(value: unknown): boolean {
 const code=String(value ?? "").trim();
 if(!code || code.length<6 || code.length>32) return false;
 if(!/^[A-Za-z0-9]+$/.test(code) && !KNOWN_MIXED_CASE_CODES.has(code)) return false;
 if(/^u00[0-9a-f]+/i.test(code)) return false;
 const blocked=new Set(["ACTIVE","EXPIRED","CONTINUE","COPYCODE","SIGNINTOREDEEM","SHARELINK","GIFTCODES","REDEEMGIFTCODE","GIFTCODE","LOADING","COMMUNITY","FEATURES","LATEST","CURRENT","POPULAR","PROFILE","PLAYER","KINGDOM","SERVER","MESSAGE","SETTINGS"]);
 return !blocked.has(code.toUpperCase());
}
export function normalizeCodes(data: GiftCodeApiData | null | undefined): GiftCodeRow[] {
 const rows=Array.isArray(data?.data?.giftCodes)?data.data.giftCodes:[]; const now=Date.now(); const seen=new Set<string>();
 return rows.map((row): GiftCodeRow | null => { const code=String(row?.code??"").trim(); const expiresAt=row?.expiresAt?Date.parse(row.expiresAt):null; const createdAt=row?.createdAt?Date.parse(row.createdAt):null; if(!isLikelyGiftCode(code)|| (expiresAt && !Number.isNaN(expiresAt) && expiresAt<=now)||seen.has(code.toUpperCase())) return null; seen.add(code.toUpperCase()); return {code,expiresAt,createdAt}; }).filter((row): row is GiftCodeRow=>row!==null).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}
export function decodeHtml(value: unknown): string { return String(value??"").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">"); }
export function cleanPageLines(html: unknown): string[] { const text=decodeHtml(String(html??"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<\/(?:p|div|section|article|li|h[1-6]|button|a|br|tr|td|header|footer)>/gi,"\n").replace(/<[^>]+>/g," ")); return text.split(/\r?\n/).map(line=>line.replace(/\s+/g," ").trim()).filter(Boolean); }
export function parseExternalExpiry(value: unknown): number | null { const raw=String(value??"").replace(/(\d)(st|nd|rd|th)\b/gi,"$1").replace(/,/g,"").trim(); const parsed=Date.parse(raw+" 23:59:59 UTC"); return Number.isNaN(parsed)?null:parsed; }
export function extractPageCodes(html: unknown): GiftCodeRow[] {
 const source=String(html??""); const seen=new Set<string>(); const rows:GiftCodeRow[]=[];
 const add=(value:unknown,expiresAt:number|null=null)=>{const code=decodeHtml(value).trim();const key=code.toUpperCase();if(!isLikelyGiftCode(code)||seen.has(key)||(expiresAt&&!Number.isNaN(expiresAt)&&expiresAt<=Date.now()))return;seen.add(key);rows.push({code,expiresAt,createdAt:0,source:"page"});};
 for(const match of source.matchAll(/(?:data-code|data-gift-code|giftCode|gift_code|["']code["'])\s*[:=]\s*["']([A-Za-z0-9_-]{4,64})["']/gi)) add(match[1]);
 for(const match of source.matchAll(/\/gift-codes\/redeem\?code=([A-Za-z0-9_-]{4,64})/gi)) add(match[1]);
 const lines=cleanPageLines(source); const start=lines.findIndex(line=>/^Active Gift Codes$/i.test(line)); const end=lines.findIndex((line,index)=>index>start&&/^Expired Gift Codes$/i.test(line));
 if(start>=0){const stop=end>start?end:lines.length;for(let i=start+1;i<stop;i++){if(!/^Active$/i.test(lines[i]))continue;const codeLine=lines[i+1];if(!codeLine)continue;const expiryMatch=(lines[i+2]||"").match(/^Expires:\s*(\d{1,2}\/\d{1,2}\/\d{4})$/i);add(codeLine,expiryMatch?Date.parse(expiryMatch[1]+" 23:59:59 UTC"):null);}}
 return rows;
}
export function extractPublicSourceCodes(html: unknown, sourceName: string): GiftCodeRow[] {
 const lines=cleanPageLines(html);const rows:GiftCodeRow[]=[];const seen=new Set<string>();
 const add=(value:unknown,expiresAt:number|null=null)=>{const code=decodeHtml(value).trim();const key=code.toUpperCase();if(!isLikelyGiftCode(code)||seen.has(key)||(expiresAt&&!Number.isNaN(expiresAt)&&expiresAt<=Date.now()))return;seen.add(key);rows.push({code,expiresAt,createdAt:0,source:sourceName});};
 const startPatterns=[/^Active Gift Codes:?$/i,/^Active Giftcodes:?$/i,/^All Kingshot codes:?$/i,/^New valid gift codes for Kingshot:?$/i,/^Active Codes:?$/i,/^Kingshot Gift Codes:?$/i,/^Working Gift Codes:?$/i,/^Current Gift Codes:?$/i,/^Latest Gift Codes:?$/i,/^Valid Gift Codes:?$/i,/^Gift Codes:?$/i,/^Working Kingshot Codes are:?$/i,/^Working Kingshot Codes:?$/i,/^Active Kingshot codes:?$/i,/^Active Kingshot Gift Codes and Redeem Tool:?$/i,/^All New Kingshot Codes:?$/i];
 const start=lines.findIndex(line=>startPatterns.some(p=>p.test(line)));
 for(const match of String(html??"").matchAll(/(?:data-(?:gift-)?code|(?:gift_?code|code))\s*[:=]\s*["']([A-Za-z0-9_-]{6,32})["']/gi)) add(match[1]);
 // Do not infer codes from words near generic “copy” or “redeem” text. This
 // heuristic treated nearby page copy/CTA text as codes and generated false alerts.
 if(start<0)return rows;
 const endPatterns=[/^Expired Kingshot codes:?$/i,/^Expired Gift Codes:?$/i,/^Expired Codes:?$/i,/^Unavailable or Archived Codes:?$/i,/^How to Redeem/i,/^How to claim/i,/^How to use/i];let stop=lines.length;for(let i=start+1;i<lines.length;i++){if(endPatterns.some(p=>p.test(lines[i]))){stop=i;break;}}
 const activeLines=lines.slice(start+1,stop);
 for(let i=0;i<activeLines.length;i++){const line=activeLines[i].replace(/^[•*·▪-]\s*/,"").replace(/^[`]|[`]$/g,"").trim();const row=line.match(/^([A-Za-z0-9]{6,32})(?:\s+[–—-]\s+|\s+)(.*)$/);if(row&&isLikelyGiftCode(row[1])){const expiry=(row[2]||"").match(/expires?[^0-9]*(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i);add(row[1],expiry?parseExternalExpiry(expiry[1]):null);continue;}const token=line.match(/^(?:`)?([A-Za-z][A-Za-z0-9]{5,31})(?:`)?$/);if(token&&isLikelyGiftCode(token[1])){const next=(activeLines[i+1]||"")+" "+(activeLines[i+2]||"");const expiry=next.match(/expires?[^0-9]*(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i);add(token[1],expiry?parseExternalExpiry(expiry[1]):null);}}
 if(!rows.length){const segment=activeLines.join("\n");for(const match of segment.matchAll(/(?:^|\n|>)[\s*•·▪-]*([A-Za-z][A-Za-z0-9]{5,31})(?=\s*(?:–|—|-|\b(?:new|active|copy|redeem|expires)\b))/gi)){add(match[1]);}}
 return rows;
}
export function mergeCodes(sources: GiftCodeRow[][]): GiftCodeRow[] { const map=new Map<string,GiftCodeRow>(); for(const row of sources.flat()){const key=row.code.toUpperCase();const existing=map.get(key);if(existing){const sourceSet=new Set([...(existing.sources||[existing.source||"unknown"]),row.source||"unknown"]);map.set(key,{...existing,expiresAt:existing.expiresAt||row.expiresAt,createdAt:existing.createdAt||row.createdAt,source:sourceSet.size>1?"multiple":existing.source,sources:[...sourceSet]});}else map.set(key,{...row,sources:[row.source||"unknown"]});} return [...map.values()].filter(row=>!row.expiresAt||Number.isNaN(row.expiresAt)||row.expiresAt>Date.now()).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); }