const esc = v => String(v ?? "—").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
const val = (v,n=28) => esc(String(v ?? "—").trim().slice(0,n) || "—");
const rect = (x,y,w,label,value) => '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="92" rx="16" fill="#30333f" stroke="#ffffff" stroke-opacity=".08"/><text x="'+(x+20)+'" y="'+(y+31)+'" fill="#aeb2bf" font-family="Arial" font-size="16">'+val(label.toUpperCase(),25)+'</text><text x="'+(x+20)+'" y="'+(y+68)+'" fill="#ffffff" font-family="Arial" font-size="26" font-weight="700">'+val(value,25)+'</text>';
function shell(body) {
 return '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#171923"/><stop offset="1" stop-color="#292b36"/></linearGradient><linearGradient id="gold"><stop stop-color="#f2d17c"/><stop offset="1" stop-color="#b8862e"/></linearGradient></defs><rect width="1200" height="675" rx="32" fill="url(#bg)"/><rect width="12" height="675" rx="6" fill="url(#gold)"/><circle cx="1080" cy="80" r="190" fill="#d6a84f" opacity=".06"/>'+body+'<text x="64" y="625" fill="#aeb2bf" font-family="Arial" font-size="18" letter-spacing="2">KINGSHOT AUTO REDEEMER  •  COMMUNITY TOOLS</text></svg>';
}
function player(d) {
 const online=String(d.online).toLowerCase()==="online";
 const body='<text x="64" y="65" fill="#d6a84f" font-family="Arial" font-size="18" letter-spacing="3">GOVERNOR PROFILE</text><text x="64" y="125" fill="#fff" font-family="Arial" font-size="44" font-weight="700">'+val(d.governor,32)+'</text><text x="66" y="160" fill="#aeb2bf" font-family="Arial" font-size="20">Kingdom '+val(d.kingdom,12)+'  •  Player ID '+val(d.playerId,22)+'</text><rect x="950" y="55" width="184" height="44" rx="22" fill="'+(online?"#174d3b":"#41434d")+'"/><circle cx="976" cy="77" r="7" fill="'+(online?"#4fe0a0":"#aeb2bf")+'"/><text x="994" y="84" fill="#fff" font-family="Arial" font-size="17">'+(online?"ONLINE":"OFFLINE")+'</text>'+
 rect(64,195,330,"Power",d.power)+rect(414,195,330,"Town Center",d.townCenter)+rect(764,195,330,"VIP",d.vip)+
 rect(64,310,505,"Alliance",d.alliance)+rect(589,310,505,"Alliance rank",d.rank)+
 rect(64,425,330,"Kills",d.kills)+rect(414,425,330,"Coordinates",d.coordinates)+rect(764,425,330,"Kingdom",d.kingdom);
 return shell(body);
}
function registration(d) {
 const body='<text x="64" y="85" fill="#d6a84f" font-family="Arial" font-size="18" letter-spacing="3">AUTO REDEMPTION ENROLLMENT</text><circle cx="600" cy="245" r="76" fill="#174d3b" stroke="#4fe0a0" stroke-width="3"/><path d="M560 246l27 27 55-61" fill="none" stroke="#8ff0c1" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/><text x="600" y="370" text-anchor="middle" fill="#fff" font-family="Arial" font-size="42" font-weight="700">'+val(d.status,34)+'</text><text x="600" y="414" text-anchor="middle" fill="#aeb2bf" font-family="Arial" font-size="22">'+val(d.governor,38)+'  •  Kingdom '+val(d.kingdom,12)+'</text><rect x="360" y="455" width="480" height="62" rx="18" fill="#30333f" stroke="#d6a84f" stroke-opacity=".45"/><text x="600" y="494" text-anchor="middle" fill="#fff" font-family="Arial" font-size="22">PLAYER ID  '+val(d.playerId,22)+'</text>';
 return shell(body);
}
export default async function handler(req,res) {
 res.setHeader("Cache-Control","no-store"); res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).end();}
 const u=new URL(req.url||"/","https://kingshot-autoredeemer.vercel.app"), kind=u.searchParams.get("kind"), encoded=u.searchParams.get("data")||"";
 if(!["player","registration"].includes(kind)||encoded.length>12000)return res.status(400).end();
 let d; try{d=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8"));}catch{return res.status(400).end();}
 if(!d||typeof d!=="object"||!/^\d{5,20}$/.test(String(d.playerId||"")))return res.status(400).end();
 const svg=kind==="player"?player(d):registration(d);
 res.setHeader("Content-Type","image/svg+xml; charset=utf-8"); res.setHeader("Content-Length",String(Buffer.byteLength(svg)));
 return res.status(200).send(svg);
}