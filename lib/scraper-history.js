const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const BUCKET="kingshot-scraper-archive";
const ARCHIVE_PREFIX="archive/scraper-runs/";

if(!SUPABASE_KEY)throw Error("Supabase service key is not configured on the server.");

async function storageFetch(path,options={}){
 const response=await fetch(SUPABASE_URL+"/storage/v1/"+path,{
  ...options,
  headers:{
   apikey:SUPABASE_KEY,
   authorization:"Bearer "+SUPABASE_KEY,
   ...(options.headers||{})
  },
  signal:AbortSignal.timeout(10000)
 });
 if(!response.ok){
  const body=await response.text().catch(()=> "");
  throw Error("Supabase Storage request failed ("+response.status+"): "+body.slice(0,200));
 }
 return response;
}

export async function readArchiveState(){
 const response=await storageFetch("object/"+BUCKET+"/state/scraper-runs.json");
 return response.json();
}

export async function countScraperHistory(liveCount){
 try{
  const state=await readArchiveState();
  const deletedRows=Number(state?.deletedRows||0);
  if(!Number.isSafeInteger(deletedRows)||deletedRows<0)throw Error("Archive state has an invalid deletedRows value.");
  return Number(liveCount||0)+deletedRows;
 }catch(error){
  console.warn("Scraper archive count unavailable; using live Supabase count:",error?.message||error);
  return Number(liveCount||0);
 }
}

export async function listArchiveFiles(){
 const response=await storageFetch("object/list/"+BUCKET,{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({prefix:ARCHIVE_PREFIX,limit:1000,offset:0,sortBy:{column:"name",order:"asc"}})
 });
 const rows=await response.json();
 if(!Array.isArray(rows))throw Error("Supabase Storage returned an invalid archive listing.");
 return rows.filter(row=>typeof row?.name==="string"&&row.name.endsWith(".jsonl")).map(row=>ARCHIVE_PREFIX+row.name);
}

async function readJsonl(path){
 const response=await storageFetch("object/"+BUCKET+"/"+path);
 const text=await response.text();
 return text.split("\n").filter(Boolean).map((line)=>JSON.parse(line));
}

export async function readArchivedScraperRuns({after=null,before=null,source=null,limit=100}={}){
 const boundedLimit=Math.min(Math.max(Number(limit)||100,1),500);
 const files=await listArchiveFiles();
 const rows=[];
 for(const path of files){
  const batch=await readJsonl(path);
  for(const row of batch){
   const checkedAt=Date.parse(row?.checked_at||"");
   if(!Number.isFinite(checkedAt))continue;
   if(after&&checkedAt<=Date.parse(after))continue;
   if(before&&checkedAt>=Date.parse(before))continue;
   if(source&&row?.source!==source)continue;
   rows.push(row);
  }
 }
 rows.sort((a,b)=>{
  const time=Date.parse(b.checked_at)-Date.parse(a.checked_at);
  return time||String(b.id||"").localeCompare(String(a.id||""));
 });
 return rows.slice(0,boundedLimit);
}
