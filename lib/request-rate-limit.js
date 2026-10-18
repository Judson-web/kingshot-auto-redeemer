import { isIP } from "node:net";
/** In-process abuse control within a warm instance, not a global quota. */
function trustedClientIp(req) {
 const raw=String(req.headers?.["x-real-ip"]||"").split(",")[0].trim();
 return raw.length<=64&&isIP(raw)?raw:"unknown";
}
export function rateLimit(req,res,scope,limit=20,windowMs=60000){
 const now=Date.now(),key=scope+":"+trustedClientIp(req);
 if(!globalThis.__ksRateLimitBuckets)globalThis.__ksRateLimitBuckets=new Map();
 const buckets=globalThis.__ksRateLimitBuckets;
 let bucket=buckets.get(key);
 if(!bucket||bucket.resetAt<=now)bucket={count:0,resetAt:now+windowMs};
 bucket.count++;
 buckets.set(key,bucket);
 if(buckets.size>5000){for(const [entryKey,value] of buckets)if(value.resetAt<=now)buckets.delete(entryKey)}
 res.setHeader("X-RateLimit-Limit",String(limit));
 res.setHeader("X-RateLimit-Remaining",String(Math.max(0,limit-bucket.count)));
 res.setHeader("X-RateLimit-Reset",String(Math.ceil(bucket.resetAt/1000)));
 if(bucket.count>limit){const retry=Math.max(1,Math.ceil((bucket.resetAt-now)/1000));res.setHeader("Retry-After",String(retry));res.setHeader("Cache-Control","no-store");return false}
 return true;
}
