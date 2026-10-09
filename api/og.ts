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
 const bg=rgb(8,9,13),panel=rgb(13,15,21),edge=rgb(38,40,52),purple=rgb(116,88,220),light=rgb(177,157,255),white=rgb(245,245,248),muted=rgb(164,166,180);
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
 const cards={auto:["KINGSHOT","AUTO REDEEMER","AUTOMATIC GIFT CODE REDEMPTION"],redeem:["KINGSHOT","GIFT REDEEMER","MANUAL GIFT CODE REDEMPTION"]};
 const card=cards[String(route)]||cards.auto;
 text(card[0],480,190,8,white);text(card[1],480,270,8,light);text(card[2],480,370,4,muted);
 const raw=Buffer.alloc((W*3+1)*H);for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;Buffer.from(pixels.buffer,pixels.byteOffset+y*W*3,W*3).copy(raw,y*(W*3+1)+1)}
 const header=Buffer.alloc(13);header.writeUInt32BE(W,0);header.writeUInt32BE(H,4);header[8]=8;header[9]=2;header[10]=0;header[11]=0;header[12]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",header),pngChunk("IDAT",zlib.deflateSync(raw,{level:9})),pngChunk("IEND",[])]);
}
export default function handler(req,res){
 res.setHeader("Content-Type","image/png");res.setHeader("Cache-Control","public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800");
 const route=new URL(req.url,"http://localhost").searchParams.get("route")||"auto";
 res.status(200).end(makePng(route));
}