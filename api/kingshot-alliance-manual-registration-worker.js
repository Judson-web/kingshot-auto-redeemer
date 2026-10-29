import { neon } from "@neondatabase/serverless";
import { fetchMightPulse } from "../lib/mightpulse-key-pool.js";
import { normalizeRegistrationInput, registerPlayer } from "../internal/kingshot/register.js";
const LEASE_SECONDS=120, MAX_PLAYERS_PER_TICK=5;
function authorized(req){const expected=process.env.ALLIANCE_SYNC_CRON_SECRET||process.env.CRON_SECRET;const auth=String(req.headers.authorization||"").trim();const provided=auth.startsWith("Bearer ")?auth.slice(7).trim():"";return Boolean(expected&&provided&&provided.length===expected.length&&Buffer.from(provided).equals(Buffer.from(expected)));}
function rosterMap(raw,kid){const map=new Map();for(const m of raw){const id=String(m?.governor_id??m?.fid??m?.player_id??m?.playerId??m?.id??"").trim(),kingdom=String(m?.kid??m?.kingdom_id??kid);if(/^[0-9]{5,20}$/.test(id)&&kingdom===String(kid)&&!map.has(id))map.set(id,m);}return map;}
async function getRoster(job){const r=await fetchMightPulse("https://api.mightpulse.com/v1/alliances/"+encodeURIComponent(job.kingdom_id)+"/"+encodeURIComponent(job.alliance_tag)+"?include=info,roster",{headers:{Accept:"application/json"}},{timeoutMs:20000});const rawData=await r.json().catch(()=>null),p=rawData?.data&&typeof rawData.data==="object"?rawData.data:rawData,a=p?.alliance||p,raw=Array.isArray(p?.members)?p.members:Array.isArray(p?.roster)?p.roster:Array.isArray(a?.members)?a.members:null;if(!r.ok||!p||p.fresh===false||p.stale===true||!raw?.length)throw Error("Fresh roster validation failed; no player registrations were changed.");return rosterMap(raw,job.kingdom_id);}
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 if(!authorized(req))return res.status(401).json({error:"Invalid worker authorization."});
 if(!process.env.ALLIANCE_SYNC_DATABASE_URL)return res.status(503).json({error:"Alliance sync database is not configured."});
 try{const sql=neon(process.env.ALLIANCE_SYNC_DATABASE_URL),summary={claimed:0,processed:0,succeeded:0,failed:0,idle:false};
 for(let tick=0;tick<3&&summary.processed<MAX_PLAYERS_PER_TICK;tick++){
  const found=await sql.query("select j.id,j.config_id,j.owner_user_id,j.status,j.selected_player_ids,j.total_count,j.processed_count,j.succeeded_count,j.failed_count,j.skipped_count,j.results,j.updated_at,c.kingdom_id,c.alliance_tag from public.alliance_manual_registration_jobs j join public.alliance_sync_config c on c.id=j.config_id where j.status='queued' or (j.status='running' and j.updated_at < now()-($1::text||' seconds')::interval) order by j.created_at asc limit 1",[LEASE_SECONDS]);
  if(!found.length){summary.idle=summary.claimed===0;break;}const j=found[0];
  const claim=await sql.query("update public.alliance_manual_registration_jobs set status='running',started_at=coalesce(started_at,now()),updated_at=now(),error_message=null where id=$1::uuid and updated_at=$2::timestamptz and (status='queued' or (status='running' and updated_at < now()-($3::text||' seconds')::interval)) returning id",[j.id,j.updated_at,LEASE_SECONDS]);
  if(!claim.length)continue;summary.claimed++;
  const ids=Array.isArray(j.selected_player_ids)?j.selected_player_ids:JSON.parse(String(j.selected_player_ids||"[]"));let map;
  try{map=await getRoster(j);}catch(e){await sql.query("update public.alliance_manual_registration_jobs set status='failed',error_message=$2,finished_at=now(),updated_at=now(),current_player_id=null where id=$1::uuid and status='running' and updated_at >= now()-interval '3 minutes'",[j.id,String(e?.message||"Roster validation failed.").slice(0,220)]);summary.failed++;continue;}
  let n=Number(j.processed_count||0),okCount=Number(j.succeeded_count||0),badCount=Number(j.failed_count||0),skipCount=Number(j.skipped_count||0);
  while(n<ids.length&&summary.processed<MAX_PLAYERS_PER_TICK){const playerId=String(ids[n]||"");let out;try{if(!/^[0-9]{5,20}$/.test(playerId))throw Error("Invalid Player ID in queued job.");const m=map.get(playerId);if(!m)throw Error("Player is no longer in the validated alliance roster.");const input=normalizeRegistrationInput({playerId,kingdomId:String(j.kingdom_id),playerName:String(m?.nick_name??m?.name??m?.nickname??"").slice(0,80),avatarUrl:String(m?.avatar_url??m?.avatarUrl??"")});const result=await registerPlayer(input);out={playerId,ok:true,alreadyRegistered:Boolean(result?.alreadyRegistered)};}catch(e){out={playerId,ok:false,error:String(e?.message||"Registration failed.").slice(0,180)};}
   const nn=n+1,so=okCount+(out.ok?1:0),fa=badCount+(out.ok?0:1),sk=skipCount+(out.alreadyRegistered?1:0);
   const updated=await sql.query("update public.alliance_manual_registration_jobs set processed_count=$2,succeeded_count=$3,failed_count=$4,skipped_count=$5,current_player_id=$6,results=coalesce(results,'[]'::jsonb)||$7::jsonb,updated_at=now() where id=$1::uuid and status='running' returning id",[j.id,nn,so,fa,sk,playerId,JSON.stringify([out])]);if(!updated.length)break;
   n=nn;okCount=so;badCount=fa;skipCount=sk;summary.processed++;summary.succeeded+=out.ok?1:0;summary.failed+=out.ok?0:1;
  }
  if(n>=Number(j.total_count)){await sql.query("update public.alliance_manual_registration_jobs set status=case when failed_count>0 then 'partial' else 'completed' end,finished_at=now(),updated_at=now(),current_player_id=null where id=$1::uuid and status='running'",[j.id]);}
  else{await sql.query("update public.alliance_manual_registration_jobs set status='queued',updated_at=now(),current_player_id=null where id=$1::uuid and status='running'",[j.id]);}
 }
 return res.status(200).json({ok:true,...summary,leaseSeconds:LEASE_SECONDS,maxPlayersPerTick:MAX_PLAYERS_PER_TICK});
 }catch(e){console.error("Durable alliance registration worker failed",e);return res.status(502).json({error:"Durable registration worker failed; queued progress remains available for recovery."});}
}