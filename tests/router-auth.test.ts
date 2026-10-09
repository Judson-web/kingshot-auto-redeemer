import test from "node:test";
import assert from "node:assert/strict";

function response() {
  const headers = new Map();
  return {
    statusCode: 200, body: undefined, headers,
    setHeader(name, value) { headers.set(name, value); return this; },
    getHeader(name) { return headers.get(name); },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
}

const req = (path, method="GET", body={}) => ({
  method,
  query: { path: Array.isArray(path) ? path : [path] },
  headers: {} as Record<string, string>,
  body
});

test("admin data endpoint rejects unauthenticated access", async () => {
  const {default:handler}=await import("../api/admin-tools/data.ts");
  const res=response();
  await handler(req("data"),res);
  assert.equal(res.statusCode,401);
  assert.equal(res.body?.error,"Unauthorized");
});

test("admin login endpoint rejects missing access keys", async () => {
  const {default:handler}=await import("../api/admin-tools/login.ts");
  const res=response();
  await handler(req("", "POST"),res);
  assert.equal(res.statusCode,400);
  assert.equal(res.body?.error,"Admin access key is required.");
});

test("custom message endpoint rejects unauthenticated destination access", async () => {
  const {default:handler}=await import("../api/custom-message.ts");
  const res=response();
  await handler(req("", "POST", {action:"DESTINATIONS"}),res);
  assert.equal(res.statusCode,401);
  assert.equal(res.body?.error,"Unauthorized.");
});

test("custom message endpoint rejects unauthenticated sends", async () => {
  const {default:handler}=await import("../api/custom-message.ts");
  const res=response();
  await handler(req("", "POST", {action:"SEND",target:"test",message:"hello"}),res);
  assert.equal(res.statusCode,401);
  assert.equal(res.body?.error,"Unauthorized.");
});

test("custom message treats a malformed session cookie as unauthenticated", async () => {
  const {default:handler}=await import("../api/custom-message.ts");
  const res=response();
  const request=req("", "POST", {action:"CHECK"});
  request.headers.cookie="__Host-ks_message_session=%E0%A4%A";
  await handler(request,res);
  assert.equal(res.statusCode,401);
  assert.equal(res.body?.ok,false);
});

test("admin data treats a malformed session cookie as unauthenticated", async () => {
  const {default:handler}=await import("../api/admin-tools/data.ts");
  const res=response();
  const request=req("data");
  request.headers.cookie="__Host-ks_admin_session=%E0%A4%A";
  await handler(request,res);
  assert.equal(res.statusCode,401);
  assert.equal(res.body?.error,"Unauthorized");
});

test("admin logout clears a malformed session cookie", async () => {
  const {default:handler}=await import("../api/admin-tools/login.ts");
  const res=response();
  const request=req("", "DELETE");
  request.headers.cookie="__Host-ks_admin_session=%E0%A4%A";
  await handler(request,res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(res.getHeader("Set-Cookie"),[
    "__Host-ks_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict",
    "ks_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax"
  ]);
});
