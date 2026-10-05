const base=(process.env.PRODUCTION_URL||"https://kingshot-autoredeemer.vercel.app").replace(/\/$/,"");
const checks=[];

async function check(name,path,expected,options={}){
 const url=base+path;
 let lastError=null;
 for(let attempt=1;attempt<=18;attempt++){
  try{
   const controller=new AbortController();
   const timer=setTimeout(()=>controller.abort(),options.timeout||10000);
   const response=await fetch(url,{method:options.method||"GET",headers:options.headers,signal:controller.signal});
   clearTimeout(timer);
   const ok=typeof expected==="function"?expected(response):response.status===expected;
   if(ok||attempt===18){
    checks.push({name,ok,status:response.status});
    return;
   }
  }catch(error){
   lastError=error;
   if(attempt===18){
    checks.push({name,ok:false,error:error?.message||String(error)});
    return;
   }
  }
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 checks.push({name,ok:false,error:lastError?.message||"Timed out"});
}

await check("Production homepage", "/", response=>response.status>=200&&response.status<400);
if(process.env.GITHUB_EVENT_NAME!=="pull_request") await check("Production logs JSON API", "/api/kingshot-health?logs=1", response=>response.status===200);
await check("Admin data rejects unauthenticated access", "/api/kingshot-admin-data", 401);
await check("Registration endpoint rejects wrong HTTP method", "/api/kingshot-register", 405);
await check("Support endpoint rejects wrong HTTP method", "/api/kingshot-support", 405);
await check("Admin login rejects wrong HTTP method", "/api/admin-tools/login", 405);
await check("Worker endpoint rejects wrong HTTP method", "/api/kingshot-auto", response=>response.status===405||response.status===401);

for(const item of checks){
 const suffix=item.status?` [HTTP ${item.status}]`:item.error?` [${item.error}]`:"";
 console.log(`${item.ok?"PASS":"FAIL"}  ${item.name}${suffix}`);
}
const failed=checks.filter(item=>!item.ok);
if(failed.length){
 console.error(`\\nProduction smoke test failed: ${failed.length}/${checks.length}`);
 process.exit(1);
}
console.log(`\\nProduction smoke test passed: ${checks.length}/${checks.length}`);
