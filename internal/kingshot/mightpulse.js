const MIGHTPULSE_BASE_URL="https://api.mightpulse.com/v1/players/";

function getKey(){
 const key=process.env.MIGHTPULSE_API_KEY||process.env.KSS_API_KEY;
 if(!key)throw Error("MightPulse API key is not configured on the server.");
 return key;
}

async function fetchPlayer(playerId){
 const key=getKey();
 const r=await fetch(MIGHTPULSE_BASE_URL+encodeURIComponent(playerId)+"?include=base",{
  headers:{Authorization:"Bearer "+key},
  signal:AbortSignal.timeout(15000)
 });
 const d=await r.json().catch(()=>({}));
 return {response:r,data:d};
}

export async function getPlayer(playerId){
 const {response,data}=await fetchPlayer(playerId);
 if(!response.ok){
  const error=Error(data?.message||data?.error||"MightPulse could not find this player.");
  error.status=response.status;
  throw error;
 }
 return data.player||data;
}

export async function verifyKingdom(playerId){
 const {response,data}=await fetchPlayer(playerId);
 if(response.status===404)return {notFound:true};
 if(!response.ok)throw Error(data?.message||data?.error||"Could not verify the player kingdom.");
 const p=data.player||data;
 const kingdomId=String(p.kid??p.kingdom_id??"").replace(/\D/g,"");
 if(!kingdomId)throw Error("Kingdom verification returned no kingdom.");
 return {kingdomId,name:p.nick_name||p.name||p.nickname||null,avatarUrl:p.avatar_url||p.avatar||p.avatarUrl||null};
}
