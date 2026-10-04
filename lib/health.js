const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;

if(!SUPABASE_KEY)throw Error("Supabase service key is not configured on the server.");

async function query(path){
 const response=await fetch(SUPABASE_URL+"/rest/v1/"+path,{
  headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY,accept:"application/json"},
  signal:AbortSignal.timeout(8000)
 });
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw Error(data?.message||"Supabase request failed");
 return data;
}

async function count(table){
 const response=await fetch(SUPABASE_URL+"/rest/v1/"+table+"?select=*&limit=1",{
  headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY,Prefer:"count=exact",Range:"0-0"},
  signal:AbortSignal.timeout(8000)
 });
 if(!response.ok)return null;
 const range=response.headers.get("content-range"),match=range?.match(/\/(\d+)$/);
 return match?Number(match[1]):null;
}

function safeWorker(row){
 const summary=row?.last_summary&&typeof row.last_summary==="object"?row.last_summary:{};
 return {slot:row?.slot??null,status:row?.last_status??null,startedAt:row?.last_started_at??null,finishedAt:row?.last_finished_at??null,error:row?.last_error?String(row.last_error).slice(0,200):null,summary:{players:Number(summary.players||0),attempted:Number(summary.attempted||0),success:Number(summary.success||0),alreadyReceived:Number(summary.alreadyReceived||0),alreadyHandled:Number(summary.alreadyHandled||0),skipped:Number(summary.skipped||0),stale:Number(summary.stale||0),errors:Number(summary.errors||0),deadlineSkipped:Number(summary.deadlineSkipped||0),codes:Number(summary.codes||0),cycleDurationMs:Number(summary.cycleDurationMs||0),sourceHealth:summary.sourceHealth||null,codeCounts:summary.codeCounts||{},redemptionFailures:Array.isArray(summary.redemptionFailures)?summary.redemptionFailures.length:0}};
}

function safeScraper(row){
 const empty=Number(row?.consecutive_empty_runs||0),errors=Number(row?.consecutive_error_runs||0);
 const score=Math.max(0,100-(Math.min(errors,5)*15)-(Math.min(empty,5)*8));
 const status=errors>=3?"FAILING":empty>=3?"DEGRADED":score>=80?"HEALTHY":"WATCH";
 return {source:row?.source??null,codeCount:Number(row?.last_code_count||0),consecutiveEmptyRuns:empty,consecutiveErrors:errors,lastSuccessAt:row?.last_success_at??null,alertState:row?.alert_state??null,healthScore:score,status,lastError:row?.last_error?String(row.last_error).slice(0,160):null};
}

async function logsResponse(res){
 const generatedAt=new Date().toISOString();
 const [workers,scrapers,recentRuns,players,giftCodes,redemptions,events,scraperRuns,supportTickets,announcements]=await Promise.all([
  query("kingshot_worker_slots?select=slot,last_status,last_started_at,last_finished_at,last_error,last_summary&order=slot"),
  query("kingshot_scraper_health?select=source,consecutive_empty_runs,consecutive_error_runs,last_code_count,last_success_at,last_error,alert_state&order=source"),
  query("kingshot_scraper_runs?select=source,checked_at,http_status,code_count,parse_ok,error_category,error_message&order=checked_at.desc&limit=20"),
  count("kingshot_autoredeem"),count("kingshot_gift_codes"),count("kingshot_redemptions"),count("kingshot_player_events"),count("kingshot_scraper_runs"),count("kingshot_support_tickets"),count("kingshot_announcements")
 ]);
 res.setHeader("Cache-Control","no-store");res.setHeader("Content-Type","application/json; charset=utf-8");
 return res.status(200).json({ok:true,service:"kingshot-auto-redeemer",generatedAt,workers:Array.isArray(workers)?workers.map(safeWorker):[],scrapers:Array.isArray(scrapers)?scrapers.map(safeScraper):[],recentScraperRuns:Array.isArray(recentRuns)?recentRuns.map(row=>({source:row?.source??null,checkedAt:row?.checked_at??null,httpStatus:row?.http_status??null,codeCount:Number(row?.code_count||0),parseOk:row?.parse_ok??null,errorCategory:row?.error_category??null,error:row?.error_message?String(row.error_message).slice(0,160):null})):[],counts:{players,giftCodes,redemptions,playerEvents:events,scraperRuns,supportTickets,announcements}});
}

export default async function handler(req,res){
 if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
 if(!SUPABASE_KEY)return res.status(503).json({healthy:false,error:"Health service is not configured."});
 try{
  if(String(req.query?.logs||"")==="1")return await logsResponse(res);
  const r=await fetch(SUPABASE_URL+"/rest/v1/kingshot_worker_state?select=last_started_at,last_finished_at,last_status,lock_until&id=eq.true&limit=1",{headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY},signal:AbortSignal.timeout(5000)});
  const rows=await r.json().catch(()=>[]);
  if(!r.ok||!Array.isArray(rows)||!rows[0])return res.status(503).json({healthy:false,error:"Worker state unavailable."});
  const state=rows[0],now=Date.now(),started=state.last_started_at?Date.parse(state.last_started_at):NaN,finished=state.last_finished_at?Date.parse(state.last_finished_at):NaN,ageMs=state.last_status==="RUNNING"&&Number.isFinite(started)?now-started:Number.isFinite(finished)?now-finished:Infinity,healthy=(state.last_status==="COMPLETED"||state.last_status==="RUNNING")&&ageMs<=12*60*1000;
  res.setHeader("Cache-Control","no-store");
  return res.status(healthy?200:503).json({healthy,status:String(state.last_status||"UNKNOWN"),lastCompletedAt:state.last_finished_at||null,runningSince:state.last_status==="RUNNING"?state.last_started_at:null,ageSeconds:Number.isFinite(ageMs)?Math.max(0,Math.round(ageMs/1000)):null,locked:Boolean(state.lock_until&&Date.parse(state.lock_until)>now)});
 }catch(error){
  console.error("Health/logs API failed:",error?.message||error);
  if(String(req.query?.logs||"")==="1")return res.status(502).json({ok:false,error:"Logs temporarily unavailable."});
  return res.status(503).json({healthy:false,error:"Worker health check failed."});
 }
}
