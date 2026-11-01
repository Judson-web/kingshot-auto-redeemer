import zlib from "node:zlib";
import { fetchMightPulse } from "../lib/mightpulse-key-pool.js";

const W=1200,H=630;
const rgb=(r,g,b)=>[r,g,b];
const clamp=n=>Math.max(0,Math.min(255,n));
function pngChunk(type,data){
 const t=Buffer.from(type),d=Buffer.from(data),buf=Buffer.alloc(8+d.length+4);
 buf.writeUInt32BE(d.length,0);t.copy(buf,4);d.copy(buf,8);
 let crc=0xffffffff;
 for(const x of Buffer.concat([t,d])){crc^=x;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
 buf.writeUInt32BE((crc^0xffffffff)>>>0,8+d.length);
 return buf;
}
function makePng(route="auto",overrideCard=null){
 const pixels=new Uint8Array(W*H*3);
 const set=(x,y,c)=>{if(x<0||y<0||x>=W||y>=H)return;const i=(y*W+x)*3;pixels[i]=c[0];pixels[i+1]=c[1];pixels[i+2]=c[2]};
 const rect=(x,y,w,h,c)=>{for(let yy=Math.max(0,y);yy<Math.min(H,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(W,x+w);xx++)set(xx,yy,c)};
 const line=(x1,y1,x2,y2,t,c)=>{const dx=x2-x1,dy=y2-y1,n=Math.max(Math.abs(dx),Math.abs(dy));for(let i=0;i<=n;i++){const x=Math.round(x1+dx*i/n),y=Math.round(y1+dy*i/n);for(let a=-Math.floor(t/2);a<=Math.floor(t/2);a++)for(let b=-Math.floor(t/2);b<=Math.floor(t/2);b++)set(x+a,y+b,c)}};
 const roundedRect=(x,y,w,h,r,colorAt)=>{
  for(let yy=Math.max(0,y);yy<Math.min(H,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(W,x+w);xx++){
   const px=xx+0.5,py=yy+0.5,cx=Math.max(x+r,Math.min(px,x+w-r)),cy=Math.max(y+r,Math.min(py,y+h-r));
   if((px-cx)*(px-cx)+(py-cy)*(py-cy)<=r*r)set(xx,yy,typeof colorAt==="function"?colorAt(px,py):colorAt);
  }
 };
 const fillPolygon=(points,colorAt)=>{
  const minY=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1])))),maxY=Math.min(H-1,Math.ceil(Math.max(...points.map(p=>p[1]))));
  for(let yy=minY;yy<=maxY;yy++){
   const scan=yy+0.5,xs=[];
   for(let i=0;i<points.length;i++){
    const [x1,y1]=points[i],[x2,y2]=points[(i+1)%points.length];
    if((y1<=scan&&y2>scan)||(y2<=scan&&y1>scan))xs.push(x1+(scan-y1)*(x2-x1)/(y2-y1));
   }
   xs.sort((a,b)=>a-b);
   for(let i=0;i+1<xs.length;i+=2){
    const left=Math.max(0,Math.ceil(xs[i]-0.5)),right=Math.min(W-1,Math.floor(xs[i+1]-0.5));
    for(let xx=left;xx<=right;xx++)set(xx,yy,typeof colorAt==="function"?colorAt(xx+0.5,scan):colorAt);
   }
  }
 };
 const palettes={
 home:[[10,11,9],[17,18,15],[51,52,45],[181,156,106],[230,211,163]],
 "alliance-registration":[[9,12,13],[17,22,23],[48,59,56],[183,163,112],[235,220,177]],
 auto:[[10,11,9],[18,19,16],[55,54,46],[190,164,112],[239,220,173]],
 redeem:[[10,11,9],[21,19,15],[61,51,36],[187,145,72],[243,212,149]],
 info:[[10,11,9],[17,18,15],[51,52,45],[181,156,106],[230,211,163]],
 developer:[[10,11,9],[17,18,15],[51,52,45],[192,166,111],[238,219,171]],
 profile:[[10,11,9],[17,18,15],[48,48,40],[181,156,106],[230,211,163]],
 player:[[8,9,14],[18,19,28],[55,49,67],[201,170,105],[242,222,173]],
 support:[[10,11,9],[17,18,15],[51,52,45],[192,166,111],[238,219,171]],
 message:[[10,11,9],[17,18,15],[51,52,45],[192,166,111],[238,219,171]],
 push:[[10,11,9],[17,18,15],[51,52,45],[181,156,106],[230,211,163]],
 codes:[[12,10,7],[22,18,11],[62,48,27],[193,145,56],[245,205,113]],
 terms:[[10,11,9],[17,18,15],[51,52,45],[181,156,106],[230,211,163]],
 privacy:[[10,11,9],[17,18,15],[51,52,45],[181,156,106],[230,211,163]]
};
 const pal=palettes[String(route)]||palettes.home;
 const bg=pal[0],panel=pal[1],edge=pal[2],accent=pal[3],light=pal[4],white=rgb(245,245,248),muted=rgb(164,166,180);
 // Premium share-card composition: layered midnight canvas, inset frame and warm metallic accents.
 rect(0,0,W,H,bg);
 for(let y=0;y<H;y++){const t=y/H;const col=[Math.round(bg[0]+(panel[0]-bg[0])*t),Math.round(bg[1]+(panel[1]-bg[1])*t),Math.round(bg[2]+(panel[2]-bg[2])*t)];rect(0,y,W,1,col)}
 rect(24,24,W-48,H-48,edge);rect(27,27,W-54,H-54,panel);
 // Soft architectural bands and fine grid marks add depth without cluttering small previews.
 rect(28,28,5,H-56,accent);rect(33,28,2,H-56,light);
 for(let i=0;i<9;i++){rect(710+i*48,64,1,502,edge);rect(690,82+i*54,465,1,edge)}
 rect(72,112,340,386,rgb(24,22,17));rect(84,124,316,362,rgb(12,13,19));
 rect(91,131,302,348,edge);rect(96,136,292,338,rgb(12,13,19));
 // Gold corner details frame the emblem like a premium game insignia.
 line(108,151,150,151,3,light);line(108,151,108,193,3,light);line(376,151,334,151,3,light);line(376,151,376,193,3,light);
 line(108,459,150,459,3,light);line(108,459,108,417,3,light);line(376,459,334,459,3,light);line(376,459,376,417,3,light);
 for(let i=0;i<5;i++){line(125+i*2,185,375+i*2,185,2,[91+i*9,78+i*8,52+i*5])}
 const glyphs={
 "A":["01110","10001","10001","11111","10001","10001","10001"],"B":["11110","10001","10001","11110","10001","10001","11110"],
 "C":["01111","10000","10000","10000","10000","10000","01111"],"D":["11110","10001","10001","10001","10001","10001","11110"],
 "E":["11111","10000","10000","11110","10000","10000","11111"],"F":["11111","10000","10000","11110","10000","10000","10000"],
 "G":["01111","10000","10000","10111","10001","10001","01111"],"H":["10001","10001","10001","11111","10001","10001","10001"],
 "I":["11111","00100","00100","00100","00100","00100","11111"],"J":["00111","00010","00010","00010","10010","10010","01100"],
 "K":["10001","10010","10100","11000","10100","10010","10001"],"L":["10000","10000","10000","10000","10000","10000","11111"],
 "M":["10001","11011","10101","10101","10001","10001","10001"],"N":["10001","11001","10101","10011","10001","10001","10001"],
 "O":["01110","10001","10001","10001","10001","10001","01110"],"P":["11110","10001","10001","11110","10000","10000","10000"],
 "Q":["01110","10001","10001","10001","10101","10010","01101"],"R":["11110","10001","10001","11110","10100","10010","10001"],
 "S":["01111","10000","10000","01110","00001","00001","11110"],"T":["11111","00100","00100","00100","00100","00100","00100"],
 "U":["10001","10001","10001","10001","10001","10001","01110"],"V":["10001","10001","10001","10001","10001","01010","00100"],
 "W":["10001","10001","10001","10101","10101","11011","10001"],"X":["10001","10001","01010","00100","01010","10001","10001"],
 "Y":["10001","10001","01010","00100","00100","00100","00100"],"Z":["11111","00001","00010","00100","01000","10000","11111"],
 "0":["01110","10001","10011","10101","11001","10001","01110"],"1":["00100","01100","00100","00100","00100","00100","01110"],
 "2":["01110","10001","00001","00010","00100","01000","11111"],"3":["11110","00001","00001","01110","00001","00001","11110"],
 "4":["00010","00110","01010","10010","11111","00010","00010"],"5":["11111","10000","10000","11110","00001","00001","11110"],
 "6":["01110","10000","10000","11110","10001","10001","01110"],"7":["11111","00001","00010","00100","01000","01000","01000"],
 "8":["01110","10001","10001","01110","10001","10001","01110"],"9":["01110","10001","10001","01111","00001","00001","01110"]
 };
 const text=(str,x,y,s,c)=>{let cx=x;for(const ch of str){if(ch===" "){cx+=s*4;continue}const g=glyphs[ch]||glyphs["0"];for(let yy=0;yy<7;yy++)for(let xx=0;xx<5;xx++)if(g[yy][xx]==="1")rect(cx+xx*s,y+yy*s,s,s,c);cx+=s*6}};
 const cards={
 home:["KINGSHOT","REDEEMER","GIFT CODES MADE SIMPLE"],
 "alliance-registration":["ALLIANCE","REGISTRATION","UP TO 4 ALLIANCES PER KINGDOM"],
 auto:["KINGSHOT","AUTO REDEEMER","AUTOMATIC GIFT CODE CHECKS"],
 redeem:["KINGSHOT","MANUAL REDEEMER","REDEEM A CODE FOR YOUR PLAYER"],
 info:["HOW IT","WORKS","AUTOMATION EXPLAINED"],
 developer:["DEVELOPER","API DOCS","BUILD WITH THE REDEEMER API"],
 profile:["YOUR","PROFILE","ACCOUNT AND PLAYER SETTINGS"],
 support:["DEVELOPER","SUPPORT","HELP FOR YOUR INTEGRATION"],
 message:["MESSAGE","STUDIO","CREATE A CUSTOM KINGSHOT MESSAGE"],
 push:["PUSH","NOTIFICATIONS","STAY UPDATED ON YOUR DEVICE"],
 codes:["GIFT","CODES","KINGSHOT CODE INFORMATION"],
 terms:["TERMS OF","SERVICE","RESPONSIBLE USE AND SERVICE RULES"],
 privacy:["YOUR","PRIVACY","DATA HANDLING EXPLAINED"]
};
 const card=Array.isArray(overrideCard)?overrideCard:(cards[String(route)]||cards.auto);
 // Typography is deliberately oversized and left-aligned for legibility in Discord, WhatsApp and X.
 rect(462,120,7,12,light);rect(476,120,7,12,accent);
 text("KINGSHOT",462,151,5,muted);
 text(card[0],462,205,8,white);
 text(card[1],462,285,8,light);
 text(card[2],462,370,card[2].length>26?3:4,muted);
 rect(462,430,520,2,edge);rect(462,430,Math.min(250,card[2].length*8),4,accent);
 text("KINGSHOT AUTO REDEEMER",462,466,2,white);
 // Small status pill reinforces the product purpose without competing with the headline.
 rect(900,76,220,38,edge);rect(903,79,214,32,panel);rect(917,92,8,8,light);text("COMMUNITY TOOL",936,91,2,muted);
 // Reuse the website's current favicon mark on every share card, so previews match the live header.
 rect(104,200,280,220,rgb(12,13,19));
 const logoX=148,logoY=214,logoSize=192,logoScale=logoSize/64,logoRadius=34;
 roundedRect(logoX,logoY,logoSize,logoSize,logoRadius,(x,y)=>{
  const t=Math.max(0,Math.min(1,((x-logoX)+(y-logoY))/(logoSize*2)));
  return [Math.round(37+(9-37)*t),Math.round(32+(11-32)*t),Math.round(74+(22-74)*t)];
 });
 const logoPoints=[[14,13],[24,13],[24,28],[39,13],[52,13],[34,31],[53,51],[39,51],[24,35],[24,51],[14,51]]
  .map(([x,y])=>[logoX+x*logoScale,logoY+y*logoScale]);
 const logoGold=(x,y)=>{
  const t=Math.max(0,Math.min(1,((x-logoX)+(y-logoY))/(logoSize*2)));
  return [Math.round(255+(197-255)*t),Math.round(224+(138-224)*t),Math.round(160+(61-160)*t)];
 };
 fillPolygon(logoPoints,logoGold);
 const logoAccent=rgb(246,217,156);
 line(logoX+43*logoScale,logoY+12*logoScale,logoX+51*logoScale,logoY+12*logoScale,6,logoAccent);
 line(logoX+51*logoScale,logoY+12*logoScale,logoX+51*logoScale,logoY+20*logoScale,6,logoAccent);
 line(logoX+51*logoScale,logoY+12*logoScale,logoX+39*logoScale,logoY+24*logoScale,6,logoAccent);
 const raw=Buffer.alloc((W*3+1)*H);for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;Buffer.from(pixels.buffer,pixels.byteOffset+y*W*3,W*3).copy(raw,y*(W*3+1)+1)}
 const header=Buffer.alloc(13);header.writeUInt32BE(W,0);header.writeUInt32BE(H,4);header[8]=8;header[9]=2;header[10]=0;header[11]=0;header[12]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",header),pngChunk("IDAT",zlib.deflateSync(raw,{level:9})),pngChunk("IEND",[])]);
}

const previewPlayerCache=new Map();
async function getPreviewPlayer(playerId){
 if(!/^\d{5,20}$/.test(playerId))return null;
 const cached=previewPlayerCache.get(playerId);
 if(cached&&cached.expiresAt>Date.now())return cached.player;
 try{
  const url="https://api.mightpulse.com/v1/players/"+encodeURIComponent(playerId)+"?include=base";
  const response=await fetchMightPulse(url,{headers:{Accept:"application/json"}},{timeoutMs:6000,totalTimeoutMs:8500,fastPath:true,maxAttempts:1});
  if(!response.ok)return null;
  const body=await response.json().catch(()=>({}));
  const player=body.player&&typeof body.player==="object"?body.player:null;
  if(!player||String(player.governor_id??player.fid??"")!==playerId)return null;
  previewPlayerCache.set(playerId,{player,expiresAt:Date.now()+5*60_000});
  return player;
 }catch{return null}
}
function escapeHtml(value){
 return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function safeCardText(value,max=24){
 return String(value??"").normalize("NFKD").toUpperCase().replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim().slice(0,max)||"PLAYER PROFILE";
}
function compactCardPower(value){
 const n=Number(value);if(!Number.isFinite(n))return"UNKNOWN";
 if(n>=1e9)return Math.round(n/1e9)+"B";
 if(n>=1e6)return Math.round(n/1e6)+"M";
 if(n>=1e3)return Math.round(n/1e3)+"K";
 return String(Math.round(n));
}
function deploymentOrigin(){
 const host=process.env.VERCEL_ENV==="production"&&process.env.VERCEL_PROJECT_PRODUCTION_URL
  ?process.env.VERCEL_PROJECT_PRODUCTION_URL
  :process.env.VERCEL_URL||"kingshot-autoredeemer.vercel.app";
 return "https://"+String(host).replace(/^https?:\/\//i,"").replace(/\/.*$/,"");
}
function removeMeta(html,attribute,value){
 const needle=('<meta '+attribute+'="'+value+'"').toLowerCase();
 const index=html.toLowerCase().indexOf(needle);
 if(index<0)return html;
 const end=html.indexOf(">",index);
 return end<0?html:html.slice(0,index)+html.slice(end+1);
}
async function handlePlayerPage(req,res,requestUrl){
 if(req.method&&req.method.toUpperCase()!=="GET"){res.setHeader("Allow","GET");res.status(405).end("Method not allowed");return}
 const id=requestUrl.searchParams.get("id")||"";
 if(!/^\d{5,20}$/.test(id)){res.status(400).end("Invalid Kingshot Governor ID");return}
 const origin=deploymentOrigin(),canonical=origin+"/user/"+encodeURIComponent(id);
 let player=null,html="";
 try{
  const [loadedPlayer,template]=await Promise.all([
   getPreviewPlayer(id),
   fetch(origin+"/index.html",{headers:{Accept:"text/html"},signal:AbortSignal.timeout(5000)})
  ]);
  player=loadedPlayer;
  if(!template.ok)throw new Error("Could not load the application shell.");
  html=await template.text();
  if(html.length>500_000)throw new Error("Application shell is unexpectedly large.");
 }catch{
  res.setHeader("Cache-Control","no-store");
  res.status(503).end("Player profile is temporarily unavailable.");
  return;
 }
 const displayName=String(player?.nick_name||"Kingshot Player").slice(0,80);
 const name=safeCardText(displayName,40);
 const kingdom=player?.kid==null?"Unknown":String(player.kid);
 const power=player?.power==null?"Not available":compactCardPower(player.power);
 const alliance=player?.alliance?.abbr?(" ["+safeCardText(player.alliance.abbr,12)+"]"):"";
 const title=(player?.nick_name?String(player.nick_name).slice(0,60):"Kingshot Player")+" · Kingdom "+kingdom+" | Kingshot Profile";
 const description=player
  ?displayName+" · Kingdom "+kingdom+" · Power "+power+alliance+". View public Kingshot player stats, arena defence, equipment, alliance standing and kingdom context."
  :"View the public Kingshot player profile for Governor ID "+id+". Player stats, arena defence, equipment and rankings are shown when available.";
 const imageUrl=origin+"/api/og?route=player&id="+encodeURIComponent(id)+"&v=1";
 html=html.replace(/<title>[\s\S]*?<\/title>/i,"<title>"+escapeHtml(title)+"</title>");
 html=html.replace(/<link\s+rel=["']canonical["'][^>]*>/i,"");
 const metas=[
  ["name","description",description],
  ["name","robots","index,follow"],
  ["property","og:type","profile"],
  ["property","og:url",canonical],
  ["property","og:title",title],
  ["property","og:description",description],
  ["property","og:site_name","Kingshot Auto Redeem"],
  ["property","og:image",imageUrl],
  ["property","og:image:secure_url",imageUrl],
  ["property","og:image:width","1200"],
  ["property","og:image:height","630"],
  ["property","og:image:type","image/png"],
  ["property","og:image:alt","Kingshot player profile for "+displayName],
  ["name","twitter:card","summary_large_image"],
  ["name","twitter:title",title],
  ["name","twitter:description",description],
  ["name","twitter:image",imageUrl],
  ["name","twitter:image:alt","Kingshot player profile for "+name]
 ];
 for(const [attr,key] of metas)html=removeMeta(html,attr,key);
 const metaHtml=metas.map(([attr,key,value])=>'<meta '+attr+'="'+escapeHtml(key)+'" content="'+escapeHtml(value)+'"/>').join("");
 const canonicalHtml='<link rel="canonical" href="'+escapeHtml(canonical)+'"/>';
 const schema={"@context":"https://schema.org","@type":"ProfilePage","name":title,"url":canonical,"description":description,"mainEntity":{"@type":"Person","name":player?.nick_name||"Kingshot Player","identifier":id}};
 html=html.replace("</head>",metaHtml+canonicalHtml+'<script type="application/ld+json">'+JSON.stringify(schema).replace(/</g,"\\\\u003c")+"</script></head>");
 res.setHeader("Content-Type","text/html; charset=utf-8");
 res.setHeader("Cache-Control","public, max-age=60, s-maxage=300, stale-while-revalidate=600");
 res.setHeader("X-Content-Type-Options","nosniff");
 res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
 res.status(200).end(html);
}
async function handlePlayerImage(req,res,requestUrl){
 const id=requestUrl.searchParams.get("id")||"";
 const player=await getPreviewPlayer(id);
 const safeName=safeCardText(player?.nick_name,13);
 const name=safeName==="PLAYER PROFILE"?safeCardText("PLAYER "+id,13):safeName;
 const kingdom=player?.kid==null?"UNKNOWN":String(player.kid);
 const power=player?.power==null?"UNKNOWN":compactCardPower(player.power);
 const line3=safeCardText("KINGDOM "+kingdom+" POWER "+power,26);
 res.setHeader("Content-Type","image/png");
 res.setHeader("Cache-Control","public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
 res.setHeader("X-Content-Type-Options","nosniff");
 res.status(200).end(makePng("player",["KINGSHOT PLAYER",name,line3]));
}

export default async function handler(req,res){
 const requestUrl=new URL(req.url||"/","http://localhost");
 const route=requestUrl.searchParams.get("route")||"auto";
 if(route==="player-page"){await handlePlayerPage(req,res,requestUrl);return}
 if(route==="player"){await handlePlayerImage(req,res,requestUrl);return}
 res.setHeader("Content-Type","image/png");res.setHeader("Cache-Control","public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800");
 res.setHeader("X-Content-Type-Options","nosniff");
 res.status(200).end(makePng(route));
}