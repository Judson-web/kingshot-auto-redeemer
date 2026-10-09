import player from"../../internal/kingshot/player.js";import register from"../../internal/kingshot/register.js";

function routePath(req){
 const q=req.query?.path;
 if(Array.isArray(q)&&q.length)return q.join("/").replace(/^\/+|\/+$/g,"");
 if(typeof q==="string"&&q)return q.replace(/^\/+|\/+$/g,"");
 const pathname=new URL(req.url||"/","http://localhost").pathname;
 const marker="/api/kingshot-tools/";
 if(pathname.startsWith(marker))return pathname.slice(marker.length).replace(/^\/+|\/+$/g,"");
 return "";
}

export default async function handler(req,res){
 const p=routePath(req);
 if(p==="player")return player(req,res);
 if(p==="register")return register(req,res);
 return res.status(404).json({error:"Kingshot endpoint not found.",route:p||null});
}
