import { Buffer } from "node:buffer";
import autoRedeemHandler from "../api/kingshot-auto.js";
import playerHandler from "../api/kingshot-player.ts";
import adminToolsHandler from "../api/admin-tools/[...path].js";
import discordToolsHandler from "../api/discord-tools/[...path].js";
import kingshotToolsHandler from "../api/kingshot-tools/[...path].js";
import opsToolsHandler from "../api/ops-tools/[...path].js";
import customMessageHandler from "../api/custom-message.js";
import supportHandler from "../api/kingshot-support.js";
import supportChatHandler from "../api/kingshot-support-chat.js";
import ogHandler from "../api/og.js";

type Handler = (req: any, res: any) => unknown | Promise<unknown>;
type RuntimeContext = { waitUntil?: (promise: Promise<unknown>) => void; env?: any };

const MAX_API_BODY_BYTES = 8 * 1024 * 1024;
const JSON_TYPE = "application/json; charset=utf-8";

function queryObject(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    const previous = query[key];
    if (previous === undefined) query[key] = value;
    else if (Array.isArray(previous)) previous.push(value);
    else query[key] = [previous, value];
  }
  return query;
}

function cookieObject(value: string | null): Record<string, string> {
  const cookies: Record<string, string> = Object.create(null);
  for (const item of String(value || "").split(";")) {
    const index = item.indexOf("=");
    if (index <= 0) continue;
    const key = item.slice(0, index).trim();
    if (!key) continue;
    try { cookies[key] = decodeURIComponent(item.slice(index + 1).trim()); }
    catch { cookies[key] = item.slice(index + 1).trim(); }
  }
  return cookies;
}

function routeFor(url: URL): { handler: Handler; queryPath?: string[]; developerPath?: string; queryId?: string; rewritePath?: string } | null {
  const path = url.pathname;
  const v3PlayerMatch = /^\/api\/v3\/players\/([^/]+)$/.exec(path);
  if (v3PlayerMatch) return { handler: playerHandler, developerPath: "v3-player", queryId: v3PlayerMatch[1] };
  if (path === "/api/v3/redemptions") return { handler: playerHandler, developerPath: "v3-redemptions" };
  if (path.startsWith("/api/v1/player/")) return { handler: playerHandler, developerPath: "player" };
  if (path === "/api/v1/redeem") return { handler: playerHandler, developerPath: "redeem" };
  if (path === "/api/kingshot-auto") return { handler: autoRedeemHandler };
  if (path === "/api/kingshot-player") return { handler: playerHandler };
  // The public app and admin control room use this stable alias. Vercel rewrote
  // it to /api/admin-tools/data; preserve that contract in the native Worker.
  if (path === "/api/kingshot-admin-data") return {
    handler: adminToolsHandler, queryPath: ["data"], rewritePath: "/api/admin-tools/data",
  };
  if (path === "/api/kingshot-alliance-sync") return { handler: playerHandler, developerPath: "alliance-sync" };
  if (path === "/api/kingshot-alliance-sync-worker") return { handler: playerHandler, developerPath: "alliance-sync-worker" };
  if (path === "/api/discord-interactions") return { handler: discordToolsHandler, queryPath: ["interactions"] };
  if (path.startsWith("/api/admin-tools/")) return { handler: adminToolsHandler, queryPath: path.slice("/api/admin-tools/".length).split("/").filter(Boolean) };
  if (path === "/api/admin-tools") return { handler: adminToolsHandler, queryPath: [] };
  if (path.startsWith("/api/discord-tools/")) return { handler: discordToolsHandler, queryPath: path.slice("/api/discord-tools/".length).split("/").filter(Boolean) };
  if (path === "/api/discord-tools") return { handler: discordToolsHandler, queryPath: [] };
  if (path.startsWith("/api/kingshot-tools/")) return { handler: kingshotToolsHandler, queryPath: path.slice("/api/kingshot-tools/".length).split("/").filter(Boolean) };
  if (path === "/api/kingshot-tools") return { handler: kingshotToolsHandler, queryPath: [] };
  if (path.startsWith("/api/ops-tools/") && path !== "/api/ops-tools/health" && path !== "/api/ops-tools/visitor") return { handler: opsToolsHandler };
  if (path === "/api/ops-tools") return { handler: opsToolsHandler };
  if (path === "/api/kingshot-support") return { handler: supportHandler };
  if (path === "/api/kingshot-support-chat") return { handler: supportChatHandler };
  if (path === "/api/custom-message") return { handler: customMessageHandler };
  if (path === "/api/og") return { handler: ogHandler };
  if (path === "/api/kingshot-health") return { handler: opsToolsHandler, rewritePath: "/api/ops-tools/health" };
  return null;
}

function createResponseAdapter() {
  let statusCode = 200;
  let body: BodyInit | null = null;
  let committed = false;
  const headers = new Headers();

  const adapter: any = {
    status(code: number) { statusCode = Number(code) || 200; return adapter; },
    setHeader(name: string, value: string | number | readonly string[]) {
      if (Array.isArray(value)) {
        headers.delete(name);
        for (const entry of value) headers.append(name, String(entry));
      } else headers.set(name, String(value));
      return adapter;
    },
    appendHeader(name: string, value: string | number) { headers.append(name, String(value)); return adapter; },
    getHeader(name: string) { return headers.get(name) ?? undefined; },
    hasHeader(name: string) { return headers.has(name); },
    removeHeader(name: string) { headers.delete(name); },
    json(value: unknown) {
      if (!headers.has("content-type")) headers.set("content-type", JSON_TYPE);
      body = JSON.stringify(value === undefined ? null : value);
      committed = true;
      return adapter;
    },
    send(value?: unknown) {
      if (value === undefined || value === null) body = null;
      else if (typeof value === "string" || value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Blob) body = value as BodyInit;
      else {
        if (!headers.has("content-type")) headers.set("content-type", JSON_TYPE);
        body = JSON.stringify(value);
      }
      committed = true;
      return adapter;
    },
    end(value?: unknown) {
      if (value !== undefined) adapter.send(value);
      else { body = null; committed = true; }
      return adapter;
    },
    redirect(statusOrUrl: number | string, maybeUrl?: string) {
      const status = typeof statusOrUrl === "number" ? statusOrUrl : 302;
      const location = typeof statusOrUrl === "string" ? statusOrUrl : String(maybeUrl || "/");
      statusCode = status;
      headers.set("Location", location);
      body = null;
      committed = true;
      return adapter;
    },
    writeHead(code: number, responseHeaders?: Record<string, string | string[]>) {
      statusCode = code;
      for (const [name, value] of Object.entries(responseHeaders || {})) adapter.setHeader(name, value);
      return adapter;
    },
    get statusCode() { return statusCode; },
    set statusCode(value: number) { statusCode = Number(value) || 200; },
    get headersSent() { return committed; },
    get writableEnded() { return committed; },
    get finished() { return committed; },
  };

  return {
    adapter,
    response(): Response {
      if (!committed) {
        statusCode = statusCode || 204;
        body = null;
      }
      if (statusCode === 204 || statusCode === 304) body = null;
      if (!headers.has("x-content-type-options")) headers.set("x-content-type-options", "nosniff");
      return new Response(body, { status: statusCode, headers });
    },
  };
}

export async function dispatchLegacyApi(
  request: Request,
  context: RuntimeContext = {},
): Promise<Response | null> {
  const incoming = new URL(request.url);
  const route = routeFor(incoming);
  if (!route) return null;

  let bytes = new Uint8Array();
  if (request.method !== "GET" && request.method !== "HEAD") {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > MAX_API_BODY_BYTES) {
      return Response.json({ error: "Request body is too large." }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    bytes = new Uint8Array(raw);
  }
  const rawBody = new TextDecoder().decode(bytes);
  const headers: Record<string, string> = Object.create(null);
  request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  headers.host ||= incoming.host;
  const query = queryObject(incoming);
  if (route.queryPath) query.path = route.queryPath;
  if (route.developerPath) query.developerPath = route.developerPath;
  if (route.queryId) query.id = route.queryId;

  let parsedBody: unknown;
  const contentType = request.headers.get("content-type") || "";
  if (bytes.byteLength && /application\/json/i.test(contentType)) {
    try { parsedBody = JSON.parse(rawBody); }
    catch { return Response.json({ error: "Invalid JSON request body." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  }

  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  const req: any = {
    method: request.method,
    url: (route.rewritePath || incoming.pathname) + incoming.search,
    headers,
    query,
    body: parsedBody,
    rawBody,
    cookies: cookieObject(request.headers.get("cookie")),
    ip,
    socket: { remoteAddress: ip },
    connection: { remoteAddress: ip },
    workerEnv: context.env,
    waitUntil(promise: Promise<unknown>) {
      if (typeof context.waitUntil === "function") context.waitUntil(Promise.resolve(promise).catch(error => {
        console.error("Background API task failed:", error instanceof Error ? error.message : "unknown error");
      }));
      else void Promise.resolve(promise).catch(error => console.error("Background API task failed:", error));
    },
    on(event: string, callback: (chunk?: Buffer) => void) {
      if (event === "data" && bytes.byteLength) queueMicrotask(() => callback(Buffer.from(bytes)));
      else if (event === "end") queueMicrotask(() => callback());
      return req;
    },
  };

  const response = createResponseAdapter();
  try {
    const result = await route.handler(req, response.adapter);
    if (result instanceof Response) return result;
    return response.response();
  } catch (error) {
    console.error("Cloudflare API adapter failed:", {
      path: incoming.pathname,
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message.slice(0, 240) : "Unhandled API error",
    });
    return Response.json({ error: "The API request could not be completed." }, {
      status: 500,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
}
