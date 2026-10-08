/**
 * In-process request rate limiter.
 * @param {{headers: Record<string, string|string[]|undefined>}} req
 * @param {{setHeader(name: string, value: string): void}} res
 * @param {string} scope
 * @param {number} [limit]
 * @param {number} [windowMs]
 * @returns {boolean}
 */
export function rateLimit(req,res,scope,limit=20,windowMs=60000){
 const now=Date.now();
 const forwarded=String(req.headers["x-forwarded-for"]||"").split(",")[0].trim();
 const ip=forwarded||String(req.headers["x-real-ip"]||"").trim()||"unknown";
 const key=scope+":"+ip;
 if(!globalThis.__ksRateLimitBuckets)globalThis.__ksRateLimitBuckets=new Map();
 const buckets=globalThis.__ksRateLimitBuckets;
 let bucket=buckets.get(key);
 if(!bucket||bucket.resetAt<=now)bucket={count:0,resetAt:now+windowMs};
 bucket.count++;
 buckets.set(key,bucket);
 if(buckets.size>5000){
  for(const [entryKey,value] of buckets)if(value.resetAt<=now)buckets.delete(entryKey);
 }
 res.setHeader("X-RateLimit-Limit",String(limit));
 res.setHeader("X-RateLimit-Remaining",String(Math.max(0,limit-bucket.count)));
 if(bucket.count>limit){
  const retry=Math.max(1,Math.ceil((bucket.resetAt-now)/1000));
  res.setHeader("Retry-After",String(retry));
  res.setHeader("Cache-Control","no-store");
  return false;
 }
 return true;
}
