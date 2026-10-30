import zlib from "node:zlib";

const WIDTH = 900;
const HEIGHT = 342;
const FONT = {
  A:"01110/10001/10001/11111/10001/10001/10001",B:"11110/10001/10001/11110/10001/10001/11110",
  C:"01111/10000/10000/10000/10000/10000/01111",D:"11110/10001/10001/10001/10001/10001/11110",
  E:"11111/10000/10000/11110/10000/10000/11111",F:"11111/10000/10000/11110/10000/10000/10000",
  G:"01111/10000/10000/10111/10001/10001/01111",H:"10001/10001/10001/11111/10001/10001/10001",
  I:"11111/00100/00100/00100/00100/00100/11111",J:"00111/00010/00010/00010/10010/10010/01100",
  K:"10001/10010/10100/11000/10100/10010/10001",L:"10000/10000/10000/10000/10000/10000/11111",
  M:"10001/11011/10101/10101/10001/10001/10001",N:"10001/11001/10101/10011/10001/10001/10001",
  O:"01110/10001/10001/10001/10001/10001/01110",P:"11110/10001/10001/11110/10000/10000/10000",
  Q:"01110/10001/10001/10001/10101/10010/01101",R:"11110/10001/10001/11110/10100/10010/10001",
  S:"01111/10000/10000/01110/00001/00001/11110",T:"11111/00100/00100/00100/00100/00100/00100",
  U:"10001/10001/10001/10001/10001/10001/01110",V:"10001/10001/10001/10001/10001/01010/00100",
  W:"10001/10001/10001/10101/10101/11011/10001",X:"10001/10001/01010/00100/01010/10001/10001",
  Y:"10001/10001/01010/00100/00100/00100/00100",Z:"11111/00001/00010/00100/01000/10000/11111",
  "0":"01110/10001/10011/10101/11001/10001/01110","1":"00100/01100/00100/00100/00100/00100/01110",
  "2":"01110/10001/00001/00010/00100/01000/11111","3":"11110/00001/00001/01110/00001/00001/11110",
  "4":"00010/00110/01010/10010/11111/00010/00010","5":"11111/10000/10000/11110/00001/00001/11110",
  "6":"01110/10000/10000/11110/10001/10001/01110","7":"11111/00001/00010/00100/01000/01000/01000",
  "8":"01110/10001/10001/01110/10001/10001/01110","9":"01110/10001/10001/01111/00001/00001/01110",
  ".":"00000/00000/00000/00000/00000/00110/00110",":":"00000/00110/00110/00000/00110/00110/00000",
  "/":"00001/00010/00010/00100/01000/01000/10000","-":"00000/00000/00000/11111/00000/00000/00000",
  "#":"01010/11111/01010/01010/11111/01010/00000","[":"01110/01000/01000/01000/01000/01000/01110",
  "]":"01110/00010/00010/00010/00010/00010/01110","(":"00010/00100/01000/01000/01000/00100/00010",
  ")":"01000/00100/00010/00010/00010/00100/01000","'":"00110/00110/00100/00000/00000/00000/00000",
  "·":"00000/00100/00100/00000/00100/00100/00000","_":"00000/00000/00000/00000/00000/00000/11111",
  "+":"00000/00100/00100/11111/00100/00100/00000"," ":"00000/00000/00000/00000/00000/00000/00000"
};
const COLORS = {
  bg:[15,8,20], panel:[29,14,34], border:[105,43,83], borderHi:[167,75,128],
  pink:[245,91,166], pinkSoft:[188,90,143], white:[250,245,250], muted:[164,155,177],
  faint:[85,64,91], gold:[224,174,76]
};
function chunk(type, data) {
  const t=Buffer.from(type), d=Buffer.from(data), out=Buffer.alloc(12+d.length);
  out.writeUInt32BE(d.length,0); t.copy(out,4); d.copy(out,8);
  let crc=0xffffffff;
  for(const byte of Buffer.concat([t,d])) { crc^=byte; for(let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  out.writeUInt32BE((crc^0xffffffff)>>>0,8+d.length);
  return out;
}
export function renderPlayerCardPng(data = {}) {
  const pixels=new Uint8Array(WIDTH*HEIGHT*3);
  const set=(x,y,color)=>{
    if(x<0||y<0||x>=WIDTH||y>=HEIGHT)return;
    const i=(y*WIDTH+x)*3; pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];
  };
  const rect=(x,y,w,h,color)=>{
    for(let yy=Math.max(0,y);yy<Math.min(HEIGHT,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(WIDTH,x+w);xx++)set(xx,yy,color);
  };
  const line=(x1,y1,x2,y2,color)=>{
    const n=Math.max(Math.abs(x2-x1),Math.abs(y2-y1));
    for(let i=0;i<=n;i++){const x=Math.round(x1+(x2-x1)*i/n),y=Math.round(y1+(y2-y1)*i/n);set(x,y,color);}
  };
  const rounded=(x,y,w,h,r,color)=>{
    for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){
      const px=xx+.5,py=yy+.5,cx=Math.max(x+r,Math.min(px,x+w-r)),cy=Math.max(y+r,Math.min(py,y+h-r));
      if((px-cx)**2+(py-cy)**2<=r*r)set(xx,yy,color);
    }
  };
  const text=(value,x,y,scale,color,maxChars=80)=>{
    const str=String(value??"—").normalize("NFKD").replace(/[^\x20-\x7E]/g," ").toUpperCase().slice(0,maxChars);
    let cursor=x;
    for(const char of str){
      const rows=(FONT[char]||FONT[" "]).split("/");
      for(let gy=0;gy<7;gy++)for(let gx=0;gx<5;gx++)if(rows[gy][gx]==="1")rect(cursor+gx*scale,y+gy*scale,scale,scale,color);
      cursor+=6*scale;
    }
    return cursor-x;
  };
  // Deep plum canvas with a restrained Oracle-inspired double frame.
  rect(0,0,WIDTH,HEIGHT,COLORS.bg);
  rounded(18,18,864,306,22,COLORS.border);
  rounded(21,21,858,300,19,COLORS.panel);
  rounded(25,25,850,292,16,COLORS.bg);
  rounded(28,28,844,286,14,COLORS.panel);
  for(let i=0;i<18;i++){
    line(520+i*24,30,790+i*24,300,COLORS.faint);
  }
  // Corner glints and thin inner rails.
  line(39,30,92,30,COLORS.borderHi); line(39,30,39,63,COLORS.borderHi);
  line(861,30,808,30,COLORS.borderHi); line(861,30,861,63,COLORS.borderHi);
  line(39,312,92,312,COLORS.borderHi); line(39,312,39,279,COLORS.borderHi);
  line(861,312,808,312,COLORS.borderHi); line(861,312,861,279,COLORS.borderHi);
  // Avatar medallion placeholder; the real portrait is also attached as the Discord embed thumbnail.
  rounded(39,39,100,100,50,[69,34,72]);
  rounded(43,43,92,92,46,COLORS.borderHi);
  const initials=String(data.governor||"K").trim().slice(0,1);
  text(initials,76,78,5,COLORS.white,1);
  // Identity header.
  const governor=String(data.governor||"KINGSHOT PLAYER").slice(0,28);
  text(governor,164,52,4,COLORS.white,28);
  const tag=String(data.tag||"").replace(/[\[\]]/g,"").slice(0,12);
  if(tag){rounded(164+Math.min(440,governor.length*24)+16,55,74,22,8,[80,22,59]);text("["+tag+"]",164+Math.min(440,governor.length*24)+25,62,2,COLORS.pink,12);}
  const meta=("GOVERNOR ID "+(data.playerId||"—")+"  ·  KINGDOM "+(data.kingdom||"—")+"  ·  "+(data.alliance||"NO ALLIANCE")+"  ·  "+(data.rank||"")).slice(0,100);
  text(meta,164,99,2,COLORS.muted,100);
  // Crown insignia.
  const crownX=826,crownY=48;
  line(crownX,crownY+23,crownX+32,crownY+23,COLORS.gold);
  line(crownX,crownY+23,crownX+4,crownY+4,COLORS.gold);
  line(crownX+4,crownY+4,crownX+12,crownY+14,COLORS.gold);
  line(crownX+12,crownY+14,crownX+17,crownY,COLORS.gold);
  line(crownX+17,crownY,crownX+23,crownY+14,COLORS.gold);
  line(crownX+23,crownY+14,crownX+30,crownY+4,COLORS.gold);
  line(crownX+30,crownY+4,crownX+32,crownY+23,COLORS.gold);
  line(crownX+3,crownY+29,crownX+29,crownY+29,COLORS.gold);
  line(39,151,861,151,COLORS.faint);
  const stats=[
    ["POWER",data.power],["KILLS",data.kills],["TOWN CENTER",data.townCenter],["VIP",data.vip],["ALLIANCE RANK",data.rank]
  ];
  const left=40, col=164;
  stats.forEach(([label,value],index)=>{
    const x=left+index*col;
    text(label,x,174,2,COLORS.muted,18);
    text(value,x,202,4,index===0?COLORS.pink:COLORS.white,16);
    if(index<4)line(x+col-12,170,x+col-12,258,COLORS.faint);
  });
  line(39,270,861,270,COLORS.faint);
  const bottom=("COORDINATES "+(data.coordinates||"—")+"  ·  STATUS "+(data.online||"UNKNOWN")+"  ·  MIGHTPULSE LIVE PLAYER PROFILE").slice(0,100);
  text(bottom,40,285,2,COLORS.muted,100);
  text("KINGSHOT ORACLE-STYLE PLAYER PROFILE",40,307,1,COLORS.pinkSoft,80);
  const raw=Buffer.alloc((WIDTH*3+1)*HEIGHT);
  for(let y=0;y<HEIGHT;y++){raw[y*(WIDTH*3+1)]=0;Buffer.from(pixels.buffer,pixels.byteOffset+y*WIDTH*3,WIDTH*3).copy(raw,y*(WIDTH*3+1)+1);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(WIDTH,0);ihdr.writeUInt32BE(HEIGHT,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw,{level:7})),chunk("IEND",[])]);
}
