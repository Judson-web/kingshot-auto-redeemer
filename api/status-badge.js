import React from "react";
const BASE_URL="https://kingshot-autoredeemer.vercel.app";
function svg(status){
 const meta={RUNNING:["RUNNING","#71b287","#102017","#294333"],MAINTENANCE:["MAINTENANCE","#d1a85f","#21190d","#4b3d2a"],OFFLINE:["OFFLINE","#c87582","#201215","#493137"]}[status]||["OFFLINE","#c87582","#201215","#493137"];
 const label=meta[0],fill=meta[1],bg=meta[2],border=meta[3],width=132;
 return '<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="28" viewBox="0 0 '+width+' 28" role="img" aria-label="Website status: '+label+'"><rect x=".5" y=".5" width="'+(width-1)+'" height="27" rx="14" fill="#0d1015" stroke="#292d36"/><rect x="1" y="1" width="'+(width-2)+'" height="26" rx="13" fill="'+bg+'" stroke="'+border+'"/><circle cx="14" cy="14" r="4" fill="'+fill+'"/><circle cx="14" cy="14" r="7" fill="none" stroke="'+fill+'" stroke-opacity=".12"/><text x="27" y="17.5" fill="#b9bec8" font-family="Arial,Helvetica,sans-serif" font-size="9" font-weight="700" letter-spacing=".7">WEBSITE</text><text x="79" y="17.5" fill="'+fill+'" font-family="Arial,Helvetica,sans-serif" font-size="9" font-weight="800" letter-spacing=".45">'+label+'</text></svg>';
}
export default async function handler(req,res){
 if(req.method!=="GET")return res.status(405).setHeader("Allow","GET").end();
 try{
  const [mr,hr]=await Promise.all([fetch(BASE_URL+"/api/kingshot-admin-data?public=maintenance",{headers:{accept:"application/json"},signal:AbortSignal.timeout(5000)}),fetch(BASE_URL+"/api/kingshot-health",{headers:{accept:"application/json"},signal:AbortSignal.timeout(5000)})]);
  const maintenance=mr.ok?await mr.json().catch(()=>null):null;const health=await hr.json().catch(()=>null);
  const status=maintenance?.maintenanceEnabled?"MAINTENANCE":hr.ok&&health?.healthy===true?"RUNNING":"OFFLINE";
  res.setHeader("Cache-Control","public, max-age=30, s-maxage=30, stale-while-revalidate=60");res.setHeader("Content-Type","image/svg+xml; charset=utf-8");
  return res.status(200).send(svg(status));
 }catch{res.setHeader("Cache-Control","public, max-age=15, s-maxage=15");res.setHeader("Content-Type","image/svg+xml; charset=utf-8");return res.status(200).send(svg("OFFLINE"));}
}
