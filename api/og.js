import zlib from "node:zlib";

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
function makePng(route="auto"){
 const pixels=new Uint8Array(W*H*3);
 const set=(x,y,c)=>{if(x<0||y<0||x>=W||y>=H)return;const i=(y*W+x)*3;pixels[i]=c[0];pixels[i+1]=c[1];pixels[i+2]=c[2]};
 const rect=(x,y,w,h,c)=>{for(let yy=Math.max(0,y);yy<Math.min(H,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(W,x+w);xx++)set(xx,yy,c)};
 const line=(x1,y1,x2,y2,t,c)=>{const dx=x2-x1,dy=y2-y1,n=Math.max(Math.abs(dx),Math.abs(dy));for(let i=0;i<=n;i++){const x=Math.round(x1+dx*i/n),y=Math.round(y1+dy*i/n);for(let a=-Math.floor(t/2);a<=Math.floor(t/2);a++)for(let b=-Math.floor(t/2);b<=Math.floor(t/2);b++)set(x+a,y+b,c)}};
 const palettes={
 home:[[8,9,13],[13,15,21],[38,40,52],[116,88,220],[213,168,92]],
 auto:[[8,9,13],[16,17,22],[52,43,31],[173,125,57],[238,194,115]],
 redeem:[[10,9,12],[20,15,16],[58,39,30],[195,111,54],[255,194,120]],
 info:[[7,11,15],[12,19,25],[33,53,64],[42,151,177],[141,224,238]],
 developer:[[9,8,15],[17,13,27],[49,39,74],[126,92,224],[190,168,255]],
 profile:[[8,12,11],[13,20,17],[35,60,47],[65,157,111],[153,226,179]],
 support:[[8,10,15],[13,17,26],[36,48,70],[65,122,226],[156,192,255]],
 message:[[13,8,14],[23,13,23],[64,34,60],[191,82,161],[247,160,218]],
 push:[[7,10,15],[12,17,26],[32,49,68],[63,145,211],[153,215,255]],
 codes:[[12,10,7],[22,18,11],[62,48,27],[193,145,56],[245,205,113]],
 terms:[[9,10,13],[15,17,21],[42,46,55],[116,129,153],[197,204,219]],
 privacy:[[7,12,12],[12,20,19],[31,57,51],[54,155,133],[145,226,203]]
};
 const pal=palettes[String(route)]||palettes.home;
 const bg=pal[0],panel=pal[1],edge=pal[2],purple=pal[3],light=pal[4],white=rgb(245,245,248),muted=rgb(164,166,180);
 rect(0,0,W,H,bg);rect(38,38,W-76,H-76,panel);
 rect(82,155,320,320,rgb(24,18,42));rect(96,169,292,292,rgb(12,13,19));
 for(let i=0;i<5;i++){line(125+i*2,185,375+i*2,185,2,[72+i*12,55+i*10,145+i*18])}
 // stylized K
 line(165,235,165,385,28,white);line(182,305,300,235,28,white);line(182,310,302,385,28,white);
 // magnifier mark
 for(let r=0;r<55;r++){const y=318+r,x=Math.round(300+Math.sqrt(Math.max(0,55*55-(r-27)*(r-27))));set(x,y,light)}
 line(350,380,390,420,18,light);
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
 const card=cards[String(route)]||cards.auto;
 text(card[0],480,180,8,white);text(card[1],480,255,8,light);text(card[2],480,355,card[2].length>26?3:4,muted);
 // A page-specific accent panel makes every share card distinguishable even in compact previews.
 rect(480,420,Math.min(450,card[2].length*20),4,purple);
 rect(480,432,170,2,edge);
 // Distinct page glyphs inside the brand tile, using the same vector-like line primitives.
 if(route==="info"){line(245,245,245,330,10,light);line(245,287,288,287,8,light);line(245,287,245,265,8,light)}
 else if(route==="developer"){line(190,270,160,305,10,light);line(160,305,190,340,10,light);line(280,270,310,305,10,light);line(310,305,280,340,10,light);line(205,345,265,265,7,light)}
 else if(route==="profile"){rect(218,235,44,36,light);rect(205,275,62,30,light);rect(190,315,92,44,light)}
 else if(route==="support"||route==="message"){rect(178,250,112,68,light);line(205,318,190,340,8,light);line(205,318,228,318,8,light);rect(195,270,12,5,bg);rect(218,270,12,5,bg);rect(241,270,12,5,bg)}
 else if(route==="push"){rect(205,250,76,72,light);rect(220,235,46,12,light);rect(225,330,36,9,light);line(235,220,250,220,6,light)}
 else if(route==="codes"){rect(190,270,100,65,light);line(190,270,240,245,8,light);line(290,270,240,245,8,light);line(240,245,240,335,8,light);line(220,340,260,340,7,light)}
 else if(route==="terms"){rect(195,235,88,112,light);line(215,265,260,265,5,bg);line(215,285,260,285,5,bg);line(215,305,250,305,5,bg)}
 else if(route==="privacy"){line(240,235,290,255,10,light);line(290,255,280,310,10,light);line(280,310,240,345,10,light);line(240,345,200,310,10,light);line(200,310,190,255,10,light);line(190,255,240,235,10,light)}
 else if(route==="redeem"){line(190,290,275,290,12,light);line(250,265,280,290,12,light);line(280,290,250,315,12,light)}
 else {rect(205,265,70,65,light);rect(220,245,40,20,light);line(205,265,240,290,7,bg);line(275,265,240,290,7,bg);line(240,290,240,330,7,bg)}
 const raw=Buffer.alloc((W*3+1)*H);for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;Buffer.from(pixels.buffer,pixels.byteOffset+y*W*3,W*3).copy(raw,y*(W*3+1)+1)}
 const header=Buffer.alloc(13);header.writeUInt32BE(W,0);header.writeUInt32BE(H,4);header[8]=8;header[9]=2;header[10]=0;header[11]=0;header[12]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",header),pngChunk("IDAT",zlib.deflateSync(raw,{level:9})),pngChunk("IEND",[])]);
}
export default function handler(req,res){
 res.setHeader("Content-Type","image/png");res.setHeader("Cache-Control","public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800");
 const route=new URL(req.url,"http://localhost").searchParams.get("route")||"auto";
 res.status(200).end(makePng(route));
}