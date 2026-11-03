import test from "node:test";
import assert from "node:assert/strict";
import { isPublicWebhookAddress } from "../lib/api-v4/webhooks.ts";
import webhookWorker from "../lib/api-v4/webhooks.ts";

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
