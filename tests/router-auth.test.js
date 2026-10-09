import test from "node:test";
import assert from "node:assert/strict";

function response() {
  const headers = new Map();
  return {
    statusCode: 200, body: undefined, headers,
    setHeader(name, value) { headers.set(name, value); },
    getHeader(name) { return headers.get(name); },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
}

const req = (path, method="GET", body={}) => ({
  method,
  query: { path: Array.isArray(path) ? path : [path] },
  headers: {},
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
  const {default:handler}=await import("../api/custom-message.js");
  const res=response();
  await handler(req("", "POST", {action:"DESTINATIONS"}),res);
  assert.equal(res.statusCode,401);
  assert.equal(res.body?.error,"Unauthorized.");
});

test("custom message endpoint rejects unauthenticated sends", async () => {
  const {default:handler}=await import("../api/custom-message.js");
  const res=response();
  await handler(req("", "POST", {action:"SEND",target:"test",message:"hello"}),res);
  assert.equal(res.statusCode,401);
  assert.equal(res.body?.error,"Unauthorized.");
});
