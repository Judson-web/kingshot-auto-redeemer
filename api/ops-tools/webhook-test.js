export default async function handler(req,res){
 if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
 if(req.query?.token!=="KSTEST_7f4c2a91e6d84b13")return res.status(404).json({error:"Not found"});
 const webhook=process.env.DISCORD_KINGSHOT_WEBHOOK_URL||process.env.DISCORD_SCRAPER_WEBHOOK_URL;
 if(!webhook)return res.status(503).json({error:"Discord webhook is not configured"});
 const payload={username:"Kingshot Auto Redeem",allowed_mentions:{parse:[]},embeds:[{title:"🧪 Discord Webhook Test",description:"This is a one-time webhook delivery test from the production Kingshot Auto Redeemer.",color:0x5865F2,fields:[{name:"Status",value:"Webhook delivery requested successfully.",inline:false},{name:"Purpose",value:"Verify the configured Discord alert channel.",inline:false}],timestamp:new Date().toISOString(),footer:{text:"Kingshot Auto Redeem • Webhook Test"}}]};
 try{
  const r=await fetch(webhook,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(7000)});
  return res.status(r.ok?200:502).json({ok:r.ok,status:r.status});
 }catch(e){return res.status(502).json({ok:false,error:e?.message||"Webhook request failed"})}
}