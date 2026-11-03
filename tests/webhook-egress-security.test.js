import test from "node:test";
import assert from "node:assert/strict";
import { isPublicWebhookAddress } from "../lib/api-v4/webhooks.ts";
import webhookWorker from "../lib/api-v4/webhooks.ts";
import gatewayRelay from "../workers/webhook-egress/src/index.ts";

test("webhook egress rejects IPv4 special-use and private destinations",()=>{
 for(const address of ["0.0.0.0","10.1.2.3","100.64.0.1","127.0.0.1","169.254.169.254","172.16.0.1","192.0.2.1","192.168.1.1","198.18.0.1","198.51.100.2","203.0.113.4","224.0.0.1","240.0.0.1"])
  assert.equal(isPublicWebhookAddress(address),false,address);
});

test("webhook egress rejects IPv6 special-use and transition addresses",()=>{
 for(const address of ["::","::1","::ffff:127.0.0.1","64:ff9b:1::1","100::1","2001:db8::1","2002::1","fc00::1","fe80::1","fec0::1","ff02::1"])
  assert.equal(isPublicWebhookAddress(address),false,address);
});

test("webhook egress permits ordinary public addresses",()=>{
 for(const address of ["1.1.1.1","8.8.8.8","2606:4700:4700::1111","2001:4860:4860::8888"])
  assert.equal(isPublicWebhookAddress(address),true,address);
});

test("delivery worker remains closed unless explicitly enabled",async()=>{
 const previous=process.env.V4_WEBHOOK_DELIVERY_ENABLED;
 delete process.env.V4_WEBHOOK_DELIVERY_ENABLED;
 let status=0,payload;
 const res={status(code){status=code;return this},json(value){payload=value;return this},setHeader(){}};
 await webhookWorker({method:"POST",headers:{}},res);
 assert.equal(status,503);
 assert.deepEqual(payload,{ok:false,error:"webhook_delivery_disabled"});
 if(previous===undefined)delete process.env.V4_WEBHOOK_DELIVERY_ENABLED;else process.env.V4_WEBHOOK_DELIVERY_ENABLED=previous;
});

test("delivery remains disabled if the Gateway relay configuration is missing",async()=>{
 const previous={enabled:process.env.V4_WEBHOOK_DELIVERY_ENABLED,url:process.env.V4_WEBHOOK_EGRESS_URL,secret:process.env.V4_WEBHOOK_EGRESS_SECRET};
 process.env.V4_WEBHOOK_DELIVERY_ENABLED="true";
 delete process.env.V4_WEBHOOK_EGRESS_URL;
 delete process.env.V4_WEBHOOK_EGRESS_SECRET;
 let status=0,payload;
 const res={status(code){status=code;return this},json(value){payload=value;return this},setHeader(){}};
 await webhookWorker({method:"POST",headers:{}},res);
 assert.equal(status,503);
 assert.deepEqual(payload,{ok:false,error:"webhook_delivery_disabled"});
 for(const [key,value] of Object.entries({V4_WEBHOOK_DELIVERY_ENABLED:previous.enabled,V4_WEBHOOK_EGRESS_URL:previous.url,V4_WEBHOOK_EGRESS_SECRET:previous.secret})){
  if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});

test("Gateway relay rejects unauthenticated and private-address requests",async()=>{
 const env={RELAY_SECRET:"test-secret",EGRESS:{fetch:async()=>{throw new Error("must not be called")}}};
 const unauthorized=await gatewayRelay.fetch(new Request("https://relay.example/deliver",{method:"POST",body:"{}"}),env);
 assert.equal(unauthorized.status,401);
 const privateTarget=await gatewayRelay.fetch(new Request("https://relay.example/deliver",{method:"POST",headers:{authorization:"Bearer test-secret","content-type":"application/json"},body:JSON.stringify({url:"https://127.0.0.1/admin",headers:{"content-type":"application/json","x-kingshot-event-id":"evt","x-kingshot-signature":"sha256=x","x-kingshot-timestamp":"1"},body:"{}"})}),env);
 assert.equal(privateTarget.status,400);
});

test("Gateway relay routes only through the EGRESS binding",async()=>{
 let requestedUrl="",requestedInit;
 const env={RELAY_SECRET:"test-secret",EGRESS:{fetch:async(url,init)=>{requestedUrl=String(url);requestedInit=init;return new Response(null,{status:204})}}};
 const response=await gatewayRelay.fetch(new Request("https://relay.example/deliver",{method:"POST",headers:{authorization:"Bearer test-secret","content-type":"application/json"},body:JSON.stringify({url:"https://receiver.example/hook",headers:{"content-type":"application/json","X-Kingshot-Event-Id":"evt-1","X-Kingshot-Signature":"sha256=abc","X-Kingshot-Timestamp":"123"},body:"{}"})}),env);
 assert.equal(response.status,200);
 assert.equal((await response.json()).status,204);
 assert.equal(requestedUrl,"https://receiver.example/hook");
 assert.equal(requestedInit.redirect,"manual");
 assert.equal(requestedInit.method,"POST");
});
