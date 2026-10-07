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

test("admin router rejects unauthenticated data access", async () => {
  const {default:router}=await import("../api/admin-tools/[...path].js");
  const res=response();
  await router(req("data"),res);
  assert.equal(res.statusCode,401);
  assert.equal(res.body?.error,"Unauthorized");
});

test("admin router preserves public announcement access", async () => {
  const {default:router}=await import("../api/admin-tools/[...path].js");
  const res=response();
  await router({
    ...req("data"),
    query:{path:["data"],public:"announcements"}
  },res);
  assert.notEqual(res.statusCode,401);
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
